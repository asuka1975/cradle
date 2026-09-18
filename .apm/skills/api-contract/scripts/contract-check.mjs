#!/usr/bin/env node
// contract-check — Lean のコマンド構成子・観測（内部入力）・画面の口と openapi.yaml の操作を突き合わせる。
//   contract-check [--json] [--meta <json>|@file]
// 判定:
//   - GET 以外の操作はすべて x-cradle-kind（command | observation）と x-cradle-model（構成子の完全名）を宣言する。無い操作は黙って除外せず NG
//   - x-cradle-model は <ルート>.Runtime.Command.<構成子> か <ルート>.Runtime.Observation.<構成子>。kind と一致し、モデルにある構成子を指す
//   - コマンドの構成子と操作は 1 対 1（操作が無い・複数ある構成子は NG）
//   - 観測は操作が無くてよい（worker だけの受信）。操作があれば公開受信。複数は NG
//   - 画面の口には GET がある（cradle.json の api.outletsWithoutEndpoint に挙げた口は除く）
// --meta を渡せば spec-query を起動せずその meta を使う（検査の再現用）。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, parseArgs, jsonArg, fail } from "../../cradle/scripts/lib.mjs";

const opts = parseArgs(process.argv.slice(2), { json: "bool" });
const cfg = loadConfig();
const spec = join(cfg.root, cfg.documents.openapi);
if (!existsSync(spec)) fail(`契約がありません: ${cfg.documents.openapi}`);
const meta = jsonArg(opts.meta) ?? queryMeta();
const yaml = readFileSync(spec, "utf8");

function queryMeta() {
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "..", "cradle", "scripts", "spec-query.mjs"), "meta"], { stdio: ["ignore", "pipe", "pipe"], cwd: cfg.root, encoding: "utf8" });
  if (!r.stdout?.trim()) fail(`spec-query meta が何も返しませんでした: ${(r.stderr ?? "").trim().slice(0, 400)}`);
  return JSON.parse(r.stdout);
}

// 素朴な走査: paths 配下の "  /path:" と "    get:|post:|…"、操作直下（6 空白）の operationId・x-cradle-kind・x-cradle-model
const ops = [];
let path = null, method = null;
const current = () => (ops.length && ops[ops.length - 1].path === path && ops[ops.length - 1].method === method) ? ops[ops.length - 1] : null;
const unquote = (s) => s.replace(/^["']|["']$/g, "");
for (const line of yaml.split("\n")) {
  const p = line.match(/^  (\/[^:]*):\s*$/); if (p) { path = p[1]; method = null; continue; }
  const m = line.match(/^    (get|post|put|patch|delete):\s*$/); if (m && path) { method = m[1]; ops.push({ path, method, operationId: null, kind: null, model: null }); continue; }
  const o = line.match(/^\s{6}operationId:\s*(\S+)/); if (o && current()) { current().operationId = unquote(o[1]); continue; }
  const k = line.match(/^\s{6}x-cradle-kind:\s*(\S+)/); if (k && current()) { current().kind = unquote(k[1]); continue; }
  const d = line.match(/^\s{6}x-cradle-model:\s*(\S+)/); if (d && current()) current().model = unquote(d[1]);
}
const writes = ops.filter(o => o.method !== "get");
const reads = ops.filter(o => o.method === "get");
const label = (o) => `${o.method.toUpperCase()} ${o.path}${o.operationId ? ` (${o.operationId})` : ""}`;

// 宣言の解決: kind と model から構成子名を取る。取れなければ理由を返す
const root = meta.project;
const kinds = {
  command: { segment: "Command", names: meta.commands ?? [], word: "コマンド" },
  observation: { segment: "Observation", names: meta.observations ?? [], word: "観測" },
};
function resolveModel(o) {
  const kind = kinds[o.kind];
  if (!kind) return { reason: `x-cradle-kind は command か observation（${o.kind}）` };
  const m = o.model.match(/^(.*)\.Runtime\.(Command|Observation)\.([^.\s]+)$/);
  if (!m) return { reason: `x-cradle-model の形は <ルート>.Runtime.Command.<構成子> か <ルート>.Runtime.Observation.<構成子>（${o.model}）` };
  const [, modelRoot, segment, ctor] = m;
  if (modelRoot !== root) return { reason: `x-cradle-model のルートが ${root} ではない（${modelRoot}）` };
  if (segment !== kind.segment) return { reason: `x-cradle-kind（${o.kind}）と x-cradle-model（Runtime.${segment}）が食い違う` };
  if (!kind.names.includes(ctor)) return { reason: `モデルに無い${kind.word}の構成子（${ctor}）` };
  return { ctor };
}

const undeclaredOps = writes.filter(o => !o.kind || !o.model);
const declared = writes.filter(o => o.kind && o.model).map(o => ({ ...o, ...resolveModel(o) }));
const opsWithUnknownModel = declared.filter(o => o.reason);
const bound = declared.filter(o => o.ctor);
const opsOf = (kind, name) => bound.filter(o => o.kind === kind && o.ctor === name);
const manyOps = (kind, names) => names.filter(n => opsOf(kind, n).length > 1).map(n => ({ name: n, ops: opsOf(kind, n).map(label) }));

const commandsWithoutOp = kinds.command.names.filter(c => opsOf("command", c).length === 0);
const commandsWithManyOps = manyOps("command", kinds.command.names);
const observations = kinds.observation.names.map(n => ({ name: n, reception: opsOf("observation", n).length ? "public" : "worker" }));
const observationsWithManyOps = manyOps("observation", kinds.observation.names);

// 画面の口 ↔ GET（api.outletsWithoutEndpoint に挙げた口は端点を持たない）
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const outlets = (meta.views?.outlets ?? []).filter(v => !cfg.api.outletsWithoutEndpoint.includes(v));
const outletsWithoutGet = outlets.filter(v => !reads.some(o => norm(o.operationId).includes(norm(v)) || norm(o.path).includes(norm(v))));

const ok = ![undeclaredOps, opsWithUnknownModel, commandsWithoutOp, commandsWithManyOps, observationsWithManyOps, outletsWithoutGet].some(g => g.length);
const result = {
  ok, commands: kinds.command.names.length, observations, writeOps: writes.length, outlets: outlets.length, reads: reads.length,
  undeclaredOps, opsWithUnknownModel, commandsWithoutOp, commandsWithManyOps, observationsWithManyOps, outletsWithoutGet,
};
if (opts.json) console.log(JSON.stringify(result, null, 2));
else {
  const pub = observations.filter(o => o.reception === "public").length;
  console.log(`コマンド ${result.commands} / 観測 ${observations.length}（公開 ${pub}・worker ${observations.length - pub}） / 書き込み操作 ${result.writeOps} / 画面の口 ${outlets.length} / 読み取り操作 ${result.reads}`);
  if (undeclaredOps.length) console.log(`x-cradle-kind / x-cradle-model の無い書き込み操作: ${undeclaredOps.map(label).join(", ")}`);
  if (opsWithUnknownModel.length) console.log(`x-cradle-model がモデルと合わない操作: ${opsWithUnknownModel.map(o => `${label(o)} — ${o.reason}`).join("; ")}`);
  if (commandsWithoutOp.length) console.log(`契約に無いコマンド: ${commandsWithoutOp.join(", ")}`);
  if (commandsWithManyOps.length) console.log(`操作が複数あるコマンド: ${commandsWithManyOps.map(c => `${c.name} (${c.ops.join(", ")})`).join("; ")}`);
  if (observationsWithManyOps.length) console.log(`操作が複数ある観測: ${observationsWithManyOps.map(c => `${c.name} (${c.ops.join(", ")})`).join("; ")}`);
  if (outletsWithoutGet.length) console.log(`GET の無い画面の口: ${outletsWithoutGet.join(", ")}`);
  console.log(ok ? "OK 契約とモデルは 1 対 1" : "NG");
}
process.exit(ok ? 0 : 1);
