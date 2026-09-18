#!/usr/bin/env node
// golden-check — golden（モデルが吐いた入出力例）を CLI で再生し、いまのモデルの応答と突き合わせる。
// モデルを変えたとき「変えるつもりのなかった流れ」が変わっていないかを検知する回帰検査。
//
//   golden-check [--name N]... [--manifest file] [--update] [--build auto|always|never] [--json]
//
// golden/ の規約: <name>-init.json = init の応答そのもの、<name>-flow.json = flow の応答そのもの。
// 再生に要るリクエストは <name>.request.json（sidecar: {"version":1,"init":{…},"flow":{…}}）から読む。version が 1 でなければ error。
// version の無い旧形式の sidecar は旧経路（cmd init / flow）の golden にだけ許す。
// 旧経路の golden に sidecar が無ければ --manifest（{"<name>": {"scenario":…,"viewer":…,"today":…,"actor":…}}）で補い、
// flow の commands は trace から復元する。
// 外部能力の経路（cmd external）で採った golden は sidecar が必須 — 環境（script）と入力列（command | observation と指名した障害）は
// 応答から復元できないので、無ければ error（モックアップで採り直す）。sidecar が無くても応答の形（init の env・trace の env / result）で
// external と分かる golden は同じ扱いで、manifest からの復元も CLI の呼び出しもしない。
//
// 検査は 3 種。init / flow は応答そのものの一致。chain（external だけ）は flow の入力列を init + step の連鎖で打ち直し、
// 手ごとの応答（result / state / views / env / interactions / domainError / faultContract）と最後の env が再生した flow と一致すること
// — flow は連続する step の定義そのものなので、ずれれば実行器の不整合。
// 応答に現れる外部能力の往復（init の env の script・trace の interactions の port / operation）は Lean の Port の一覧
// （Application/Port/<Port>/<操作>.lean、Domain/Port も同じ）に要り、無ければ error。
// --update が書くのは init / flow の応答だけで、トップが ok でない応答（error / harnessError）は書かない。chain は書くものを持たない。
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, callLean, parseArgs, diffJson, fail, readSidecar, isExternalGolden, traceInputOf, ports, hasPortOperation, SIDECAR_VERSION } from "./lib.mjs";

const opts = parseArgs(process.argv.slice(2), { update: "bool", json: "bool" });
const cfg = loadConfig();
const build = opts.build ?? "auto";
const goldenDir = join(cfg.root, cfg.lean.golden);
if (!existsSync(goldenDir)) fail(`golden ディレクトリがありません: ${goldenDir}`);

const manifest = opts.manifest ? JSON.parse(readFileSync(opts.manifest, "utf8")) : {};
const names = [...new Set(readdirSync(goldenDir).filter(f => /-(init|flow)\.json$/.test(f)).map(f => f.replace(/-(init|flow)\.json$/, "")))].sort();
const wanted = opts.name ? [].concat(opts.name) : names;
const portList = ports(cfg);

/** 旧経路の golden だけ: manifest の項目と trace から init / flow のリクエストを復元する。 */
function manifestRequests(name) {
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

const isOk = (res) => !!res && typeof res === "object" && "ok" in res;

/** 応答に現れる外部能力の往復のうち Lean の Port に無いもの（"<Port>.<operation>"、重複無し）。 */
function unknownPortCalls(kind, top) {
  const calls = kind === "init" ? top.ok.env?.script ?? [] : (top.ok.trace ?? []).flatMap(t => t?.interactions ?? []);
  return [...new Set(calls.filter(c => c && !hasPortOperation(portList, c.port, c.operation)).map(c => `${c.port}.${c.operation}`))];
}

const CHAIN_KEYS = ["result", "state", "views", "env", "interactions", "domainError", "faultContract"];
const pickFields = (src, keys) => Object.fromEntries(keys.filter(k => src?.[k] !== undefined).map(k => [k, src[k]]));

/** external の flow を init + step の連鎖で打ち直し、再生した flow の応答（trace の各要素の射影と最後の env）と突き合わせる。
    init は sidecar の flow のリクエストの欄（scenario・環境・actor・viewer・today）から組む。 */
async function chainReplay(name, flowReq, flowRes) {
  const inputs = flowReq.inputs ?? [];
  const trace = flowRes.ok.trace ?? [];
  const changed = (diffs, i) => {
    const input = i === undefined ? null : traceInputOf(inputs[i]);
    return { name, kind: "chain", status: "changed", firstDivergence: diffs[0].path, step: i === undefined ? undefined : i + 1,
      command: input?.name, inputKind: input?.name !== undefined ? input.kind : undefined, diffs: diffs.slice(0, 12) };
  };
  const common = pickFields(flowReq, ["actor", "viewer", "today"]);
  const init = await callLean(cfg, { cmd: "external", version: SIDECAR_VERSION, action: "init", ...pickFields(flowReq, ["scenario", "environment", "env"]), ...common }, { build });
  if (!isOk(init)) return { name, kind: "chain", status: "error", reason: `連鎖の init の応答のトップが ok ではない: ${JSON.stringify(init).slice(0, 300)}` };
  if (trace.length !== inputs.length) return changed([{ path: "/ok/trace", expected: `length ${inputs.length}（sidecar の inputs）`, actual: `length ${trace.length}` }]);
  let state = init.ok.state, env = init.ok.env;
  for (let i = 0; i < inputs.length; i++) {
    const res = await callLean(cfg, { cmd: "external", version: SIDECAR_VERSION, action: "step", state, env, input: inputs[i], ...common }, { build });
    if (!isOk(res)) return changed([{ path: `/ok/trace/${i}`, expected: "ok", actual: res }], i);
    const diffs = diffJson(pickFields(trace[i], CHAIN_KEYS), pickFields(res.ok, CHAIN_KEYS), `/ok/trace/${i}`);
    if (diffs.length) return changed(diffs, i);
    state = res.ok.state; env = res.ok.env;
  }
  const diffs = diffJson(flowRes.ok.env, env, "/ok/env");
  return diffs.length ? changed(diffs) : { name, kind: "chain", status: "ok" };
}

const report = [];
let failed = 0;
const error = (name, reason, kind) => { report.push({ name, ...(kind ? { kind } : {}), status: "error", reason }); failed++; };
for (const name of wanted) {
  let stop = false;
  const stored = {};
  for (const kind of ["init", "flow"]) {
    const file = join(goldenDir, `${name}-${kind}.json`);
    if (!existsSync(file)) { error(name, `${name}-${kind}.json が無い（golden は init / flow の 2 本 1 組）`, kind); continue; }
    let top; try { top = JSON.parse(readFileSync(file, "utf8")); } catch (e) { error(name, `JSON として読めない: ${e.message}`, kind); stop = true; continue; }
    if (!isOk(top)) error(name, "トップレベルが {\"ok\": …} ではない（CLI の応答そのものを置く）", kind);
    else {
      const unknown = unknownPortCalls(kind, top);
      if (unknown.length) { error(name, `外部能力の往復 ${unknown.join(", ")} が Lean の Port（Application/Port/<Port>/<操作>.lean）に無い`, kind); stop = true; }
    }
    stored[kind] = top;
  }
  if (stop) continue;
  let sidecar, external;
  try { sidecar = readSidecar(goldenDir, name); external = isExternalGolden(goldenDir, name); }
  catch (e) { error(name, e.message); continue; }
  let reqs;
  if (external) {
    if (!sidecar) { error(name, `外部能力を使う golden は ${name}.request.json（版・環境・入力列）が無いと再生できない — モックアップで採り直す`); continue; }
    reqs = sidecar;
    // 障害契約を指名した手は、保存した応答でもその契約で止まっている（そうでなければ sidecar と応答が別の採取のもの）
    if (isOk(stored.flow)) {
      const trace = stored.flow.ok.trace ?? [];
      const mismatch = (reqs.flow?.inputs ?? []).map((input, i) => ({ step: i + 1, fault: input?.fault, result: trace[i]?.result })).find(x => typeof x.fault === "string" && x.result !== "fault");
      if (mismatch) { error(name, `手 #${mismatch.step} は障害契約 ${mismatch.fault} を指名しているのに、保存した flow の応答の result が fault ではない（${JSON.stringify(mismatch.result)}）— sidecar と応答が食い違っている。モックアップで採り直す`, "flow"); continue; }
    }
  } else {
    reqs = sidecar ?? manifestRequests(name);
    if (!reqs) { report.push({ name, status: "skipped", reason: `${name}.request.json が無い（再生できない golden）— モックアップで採り直すか --manifest で補う` }); continue; }
  }
  const replayed = {};
  for (const kind of ["init", "flow"]) {
    const file = join(goldenDir, `${name}-${kind}.json`);
    if (!existsSync(file) || !reqs[kind]) continue;
    const expected = stored[kind];
    let actual;
    try { actual = await callLean(cfg, reqs[kind], { build }); }
    catch (e) { error(name, e.message, kind); continue; }
    if (!isOk(actual)) { error(name, `CLI の応答のトップが ok ではない: ${JSON.stringify(actual).slice(0, 300)}（golden は ok の応答だけ — --update でも書かない）`, kind); continue; }
    replayed[kind] = actual;
    const diffs = diffJson(expected, actual);
    if (!diffs.length) { report.push({ name, kind, status: "ok" }); continue; }
    if (opts.update) { writeFileSync(file, JSON.stringify(actual, null, 2) + "\n"); report.push({ name, kind, status: "updated", diffs: diffs.length }); continue; }
    failed++;
    const first = diffs[0];
    const step = first.path.match(/^\/ok\/trace\/(\d+)/);
    // 最初に食い違った手の入力: command の名前か observation の名前（report の鍵は command のまま。inputKind でどちらかを示す）
    const input = step ? traceInputOf(expected.ok?.trace?.[Number(step[1])]) : null;
    report.push({ name, kind, status: "changed", firstDivergence: first.path, step: step ? Number(step[1]) + 1 : undefined,
      command: input?.name, inputKind: input?.name !== undefined ? input.kind : undefined, diffs: diffs.slice(0, 12) });
  }
  // 連鎖は再生した flow（保存した golden ではない）と比べる — init / flow の応答が ok で揃ったときだけ
  if (external && replayed.init && replayed.flow) {
    const r = await chainReplay(name, reqs.flow, replayed.flow);
    report.push(r);
    if (r.status !== "ok") failed++;
  }
}

if (opts.json) console.log(JSON.stringify({ failed, report }, null, 2));
else {
  for (const r of report) {
    if (r.status === "ok") console.log(`ok       ${r.name}-${r.kind}`);
    else if (r.status === "updated") console.log(`updated  ${r.name}-${r.kind} (${r.diffs} diffs)`);
    else if (r.status === "skipped") console.log(`skipped  ${r.name}: ${r.reason}`);
    else if (r.status === "error") console.log(`error    ${r.name}${r.kind ? `-${r.kind}` : ""}: ${r.reason}`);
    else {
      console.log(`CHANGED  ${r.name}-${r.kind}: first divergence at ${r.firstDivergence}${r.step ? ` (step #${r.step} ${r.inputKind === "observation" ? "observation " : ""}${r.command})` : ""}`);
      for (const d of r.diffs) console.log(`           ${d.path}: expected ${JSON.stringify(d.expected)} / actual ${JSON.stringify(d.actual)}`);
    }
  }
  console.log(`\n${report.filter(r => r.status === "ok").length} ok, ${failed} changed/error, ${report.filter(r => r.status === "skipped").length} skipped`);
  if (failed) console.log("変更が意図したものなら --update で golden を更新し、golden の差分を変更理由とともにコミットすること。意図していない流れが変わっていたら、それがモデル変更の意図しない影響。chain の食い違いは実行器（flow と step）の不整合で、--update では直らない。");
}
process.exit(failed ? 1 : 0);
