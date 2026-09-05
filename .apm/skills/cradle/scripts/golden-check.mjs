#!/usr/bin/env node
// golden-check — golden（モデルが吐いた入出力例）を CLI で再生し、いまのモデルの応答と突き合わせる。
// モデルを変えたとき「変えるつもりのなかった流れ」が変わっていないかを検知する回帰検査。
//
//   golden-check [--name N]... [--manifest file] [--update] [--build auto|always|never] [--json]
//
// golden/ の規約: <name>-init.json = {"cmd":"init",…} の応答そのもの、<name>-flow.json = {"cmd":"flow",…} の応答そのもの。
// 再生に要るリクエスト（scenario / viewer / actor / today）は <name>.request.json（Cradle の規約: {"init":{…},"flow":{…}}）から読む。
// 無ければ --manifest（{"<name>": {"scenario":…,"viewer":…,"today":…,"actor":…}}）で補い、flow の commands は trace から復元する。
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, callLean, parseArgs, diffJson, fail } from "./lib.mjs";

const opts = parseArgs(process.argv.slice(2), { update: "bool", json: "bool" });
const cfg = loadConfig();
const build = opts.build ?? "auto";
const goldenDir = join(cfg.root, cfg.lean.golden);
if (!existsSync(goldenDir)) fail(`golden ディレクトリがありません: ${goldenDir}`);

const manifest = opts.manifest ? JSON.parse(readFileSync(opts.manifest, "utf8")) : {};
const names = [...new Set(readdirSync(goldenDir).filter(f => /-(init|flow)\.json$/.test(f)).map(f => f.replace(/-(init|flow)\.json$/, "")))].sort();
const wanted = opts.name ? [].concat(opts.name) : names;

function requestsFor(name) {
  const sidecar = join(goldenDir, `${name}.request.json`);
  if (existsSync(sidecar)) return JSON.parse(readFileSync(sidecar, "utf8"));
  const m = manifest[name];
  if (!m) return null;
  const base = { scenario: m.scenario ?? "basic" };
  if (m.viewer !== undefined) base.viewer = m.viewer;
  if (m.today !== undefined) base.today = m.today;
  if (m.actor !== undefined) base.actor = m.actor;
  const flowFile = join(goldenDir, `${name}-flow.json`);
  let commands = [];
  if (existsSync(flowFile)) {
    const trace = JSON.parse(readFileSync(flowFile, "utf8")).ok?.trace ?? [];
    commands = trace.map(t => t.actor ? { actor: t.actor, command: t.command } : t.command);
  }
  return { init: { cmd: "init", ...base }, flow: { cmd: "flow", ...base, commands } };
}

const report = [];
let failed = 0;
for (const name of wanted) {
  for (const kind of ["init", "flow"]) {
    const file = join(goldenDir, `${name}-${kind}.json`);
    if (!existsSync(file)) { report.push({ name, kind, status: "error", reason: `${name}-${kind}.json が無い（golden は init / flow の 2 本 1 組）` }); failed++; continue; }
    let top; try { top = JSON.parse(readFileSync(file, "utf8")); } catch (e) { report.push({ name, kind, status: "error", reason: `JSON として読めない: ${e.message}` }); failed++; continue; }
    if (!top || typeof top !== "object" || !("ok" in top)) { report.push({ name, kind, status: "error", reason: "トップレベルが {\"ok\": …} ではない（CLI の応答そのものを置く）" }); failed++; }
  }
  if (!existsSync(join(goldenDir, `${name}.request.json`)) && !manifest[name]) report.push({ name, status: "skipped", reason: `${name}.request.json が無い（再生できない golden）— モックアップで採り直すか --manifest で補う` });
  const reqs = requestsFor(name);
  if (!reqs) continue;
  for (const kind of ["init", "flow"]) {
    const file = join(goldenDir, `${name}-${kind}.json`);
    if (!existsSync(file) || !reqs[kind]) continue;
    const expected = JSON.parse(readFileSync(file, "utf8"));
    let actual;
    try { actual = await callLean(cfg, reqs[kind], { build }); }
    catch (e) { report.push({ name, kind, status: "error", reason: e.message }); failed++; continue; }
    const diffs = diffJson(expected, actual);
    if (!diffs.length) { report.push({ name, kind, status: "ok" }); continue; }
    if (opts.update) { writeFileSync(file, JSON.stringify(actual, null, 2) + "\n"); report.push({ name, kind, status: "updated", diffs: diffs.length }); continue; }
    failed++;
    const first = diffs[0];
    const step = first.path.match(/^\/ok\/trace\/(\d+)/);
    report.push({ name, kind, status: "changed", firstDivergence: first.path, step: step ? Number(step[1]) + 1 : undefined,
      command: step ? Object.keys(expected.ok.trace[Number(step[1])]?.command ?? {})[0] : undefined, diffs: diffs.slice(0, 12) });
  }
}

if (opts.json) console.log(JSON.stringify({ failed, report }, null, 2));
else {
  for (const r of report) {
    if (r.status === "ok") console.log(`ok       ${r.name}-${r.kind}`);
    else if (r.status === "updated") console.log(`updated  ${r.name}-${r.kind} (${r.diffs} diffs)`);
    else if (r.status === "skipped") console.log(`skipped  ${r.name}: ${r.reason}`);
    else if (r.status === "error") console.log(`error    ${r.name}-${r.kind}: ${r.reason}`);
    else {
      console.log(`CHANGED  ${r.name}-${r.kind}: first divergence at ${r.firstDivergence}${r.step ? ` (step #${r.step} ${r.command})` : ""}`);
      for (const d of r.diffs) console.log(`           ${d.path}: expected ${JSON.stringify(d.expected)} / actual ${JSON.stringify(d.actual)}`);
    }
  }
  console.log(`\n${report.filter(r => r.status === "ok").length} ok, ${failed} changed/error, ${report.filter(r => r.status === "skipped").length} skipped`);
  if (failed) console.log("変更が意図したものなら --update で golden を更新し、golden の差分を変更理由とともにコミットすること。意図していない流れが変わっていたら、それがモデル変更の意図しない影響。");
}
process.exit(failed ? 1 : 0);
