#!/usr/bin/env node
// ddd-clean-check — 探索セッション（ddd スキル）が残したプローブ・問いかけファイル・命名の確認が消えていること
// （--baseline なしならセッション印も）を機械で確かめる。
//   ddd-clean-check [--build] [--baseline <file>]
//   --baseline は ddd.mjs start が書いた .session（lean に開始時点の sha256）。lean/ をその時点と比べ、無ければ HEAD と比べる
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, parseArgs, fail, walk, rel, git, lakeBuild, readJson, leanSnapshot } from "./lib.mjs";

const opts = parseArgs(process.argv.slice(2), { build: "bool", json: "bool" });
if (opts.baseline === true) fail("usage: ddd-clean-check [--build] [--baseline <file>]");
const cfg = loadConfig();
const baseline = (() => {
  if (!opts.baseline) return null;
  const file = resolve(cfg.root, opts.baseline);
  let lean; try { lean = readJson(file).lean; } catch {}
  if (!lean || typeof lean !== "object") fail(`--baseline <file> は ddd.mjs start が書いた .session（lean に開始時点の sha256）: ${file}`);
  return lean;
})();
const problems = [];
const ddd = join(cfg.root, cfg.documents.ddd);
// --baseline のとき .session は呼び出し側（ddd.mjs end）が検査の後に消す
for (const f of ["questions.md", "naming.md", ...(opts.baseline ? [] : [".session"])]) if (existsSync(join(ddd, f))) problems.push(`${cfg.documents.ddd}/${f} が残っています`);
for (const f of [...walk(cfg.lean.rootDir, { ext: [".lean", ".html", ".mjs"] })]) {
  const text = readFileSync(f, "utf8");
  const m = text.match(/probe-[\w-]+/);
  if (m) problems.push(`プローブの残骸: ${rel(cfg.root, f)} (${m[0]})`);
}
// lean/ の比較は lake build の前（ビルドが書く lake-manifest.json を差分に数えない）
if (baseline) {
  const before = baseline, after = leanSnapshot(cfg);
  const diff = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .map(p => !(p in before) ? ` A ${cfg.lean.dir}/${p}` : !(p in after) ? ` D ${cfg.lean.dir}/${p}` : before[p] !== after[p] ? ` M ${cfg.lean.dir}/${p}` : null).filter(Boolean);
  if (diff.length) problems.push(`${cfg.lean.dir}/ が ddd.mjs start の時点と違います（プローブは編集を手で戻す。git checkout / stash は HEAD に戻すので未コミットの形式化まで消える）:\n${diff.join("\n")}`);
} else {
  try {
    git(cfg.root, ["rev-parse", "--verify", "HEAD"]);   // コミットが 1 つも無ければ差分の比較はできない
    const dirty = git(cfg.root, ["status", "--short", "--", cfg.lean.dir]);
    if (dirty) problems.push(`${cfg.lean.dir}/ に HEAD と違う差分があります（セッション開始時の記録が無いので HEAD と比べている。前回の形式化（フェーズ 2）が未コミットならそれも差分に出る — ddd.mjs end 経由なら開始時点と比べる）:\n${dirty}`);
  } catch {}
}
if (opts.build) { try { lakeBuild(cfg); } catch (e) { problems.push(e.message); } }
if (opts.json) console.log(JSON.stringify({ ok: !problems.length, problems }, null, 2));
else { for (const p of problems) console.log(`NG ${p}`); console.log(problems.length ? "後片付けが残っています" : "OK 後片付け済み"); }
process.exit(problems.length ? 1 : 0);
