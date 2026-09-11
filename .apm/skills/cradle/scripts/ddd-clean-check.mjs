#!/usr/bin/env node
// ddd-clean-check — 探索セッション（ddd スキル）が残したプローブ・問いかけファイル・命名の確認・セッション印が消えていることを機械で確かめる。
//   ddd-clean-check [--build]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, parseArgs, walk, rel, git, lakeBuild } from "./lib.mjs";

const opts = parseArgs(process.argv.slice(2), { build: "bool", json: "bool" });
const cfg = loadConfig();
const problems = [];
const ddd = join(cfg.root, cfg.documents.ddd);
for (const f of ["questions.md", "naming.md", ".session"]) if (existsSync(join(ddd, f))) problems.push(`${cfg.documents.ddd}/${f} が残っています`);
for (const f of [...walk(cfg.lean.rootDir, { ext: [".lean", ".html", ".mjs"] })]) {
  const text = readFileSync(f, "utf8");
  const m = text.match(/probe-[\w-]+/);
  if (m) problems.push(`プローブの残骸: ${rel(cfg.root, f)} (${m[0]})`);
}
try {
  git(cfg.root, ["rev-parse", "--verify", "HEAD"]);   // コミットが 1 つも無ければ差分の比較はできない
  const dirty = git(cfg.root, ["status", "--short", "--", cfg.lean.dir]);
  if (dirty) problems.push(`${cfg.lean.dir}/ に探索前と違う差分が残っています（モデルを変えるのはフェーズ 2 の仕事）:\n${dirty}`);
} catch {}
if (opts.build) { try { lakeBuild(cfg); } catch (e) { problems.push(e.message); } }
if (opts.json) console.log(JSON.stringify({ ok: !problems.length, problems }, null, 2));
else { for (const p of problems) console.log(`NG ${p}`); console.log(problems.length ? "後片付けが残っています" : "OK 後片付け済み"); }
process.exit(problems.length ? 1 : 0);
