#!/usr/bin/env node
// contract-check — Lean のコマンド構成子・画面の口と openapi.yaml の操作を突き合わせる。
//   contract-check [--json]
// 判定: 各コマンド構成子に operationId（構成子名を含む）を持つ POST/PUT/PATCH/DELETE が 1 つあるか、
//       各画面の口に GET があるか、契約にあってモデルに無い操作（反機能の疑い）が無いか。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, parseArgs, fail } from "../../cradle/scripts/lib.mjs";

const opts = parseArgs(process.argv.slice(2), { json: "bool" });
const cfg = loadConfig();
const spec = join(cfg.root, cfg.documents.openapi);
if (!existsSync(spec)) fail(`契約がありません: ${cfg.documents.openapi}`);
const meta = JSON.parse(spawnSync(process.execPath, [join(import.meta.dirname, "..", "..", "cradle", "scripts", "spec-query.mjs"), "meta"], { stdio: ["ignore", "pipe", "pipe"], cwd: cfg.root, encoding: "utf8" }).stdout);
const yaml = readFileSync(spec, "utf8");

// 素朴な走査: paths 配下の "  /path:" と "    get:|post:|…" と "      operationId: x"
const ops = [];
let path = null, method = null;
for (const line of yaml.split("\n")) {
  const p = line.match(/^  (\/[^:]*):\s*$/); if (p) { path = p[1]; method = null; continue; }
  const m = line.match(/^    (get|post|put|patch|delete):\s*$/); if (m && path) { method = m[1]; ops.push({ path, method, operationId: null }); continue; }
  const o = line.match(/^\s{6}operationId:\s*(\S+)/); if (o && ops.length && ops[ops.length - 1].path === path && ops[ops.length - 1].method === method) ops[ops.length - 1].operationId = o[1];
}
const writes = ops.filter(o => o.method !== "get");
const reads = ops.filter(o => o.method === "get");
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const commandsWithoutOp = meta.commands.filter(c => !writes.some(o => norm(o.operationId).includes(norm(c)) || norm(o.path).includes(norm(c))));
const opsWithoutCommand = writes.filter(o => !meta.commands.some(c => norm(o.operationId).includes(norm(c)) || norm(o.path).includes(norm(c))));
const outlets = (meta.views?.outlets ?? []).filter(v => v !== "unregistered" && v !== "employees");
const outletsWithoutGet = outlets.filter(v => !reads.some(o => norm(o.operationId).includes(norm(v)) || norm(o.path).includes(norm(v))));
const result = { commands: meta.commands.length, writeOps: writes.length, reads: reads.length, commandsWithoutOp, opsWithoutCommand, outletsWithoutGet };
if (opts.json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`コマンド ${result.commands} / 書き込み操作 ${result.writeOps} / 画面の口 ${outlets.length} / 読み取り操作 ${result.reads}`);
  if (commandsWithoutOp.length) console.log(`契約に無いコマンド: ${commandsWithoutOp.join(", ")}`);
  if (opsWithoutCommand.length) console.log(`モデルに無い書き込み操作（反機能の疑い）: ${opsWithoutCommand.map(o => `${o.method.toUpperCase()} ${o.path}${o.operationId ? ` (${o.operationId})` : ""}`).join(", ")}`);
  if (outletsWithoutGet.length) console.log(`GET の無い画面の口: ${outletsWithoutGet.join(", ")}`);
  const ok = !commandsWithoutOp.length && !opsWithoutCommand.length && !outletsWithoutGet.length;
  console.log(ok ? "OK 契約とモデルは 1 対 1" : "NG");
  process.exit(ok ? 0 : 1);
}
