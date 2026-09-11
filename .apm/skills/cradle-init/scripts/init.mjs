#!/usr/bin/env node
// init — 新しいプロダクトに Cradle の骨格を敷く。
//   init --project <Root> [--dir <path>] [--backend <package>] [--only <prefix>] [--dry-run] [--force]
//   --only <prefix> は、そのパスで始まるファイルだけを対象にする（例: --only lean/mockup --force で骨格由来のモックアップだけ更新）
//   --backend <package> を付けると backend/ の骨格（ktlint 独自ルール・.editorconfig・gradle.properties）も敷く（例: com.example.notes）
//   <Root> は Lean のルート名前空間（例: MonoWa）。lake の exe 名は小文字にしたもの。
// 敷くもの: cradle.json / .apm/instructions/project.instructions.md（固有の事実。apm install が rules に写す。Codex は apm compile --single-agents で AGENTS.md に）/ .gitignore / documents/{ddd,ai-notes,infra-design,codebase} / lean/（動く最小ドメイン付き）
// .claude/ と .codex/ の設定例は、その置き場が既にあるもの（apm install 済みのターゲット）だけ敷く。どちらも無ければ両方。
// 既にあるファイルは上書きしない（--force で上書き）。
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, appendFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] ?? true) : d; };
const project = opt("project");
const target = opt("dir", process.env.CRADLE_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const backendPkg = opt("backend", null);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const only = opt("only", null);
if (!project || !/^[A-Z][A-Za-z0-9]*$/.test(project)) { console.error("--project <Root> が要ります（大文字始まりの英数字。例: MonoWa）"); process.exit(1); }
const lower = project.toLowerCase();
const assets = join(import.meta.dirname, "..", "assets");

const written = [], skipped = [], failed = [];
// 書けない場所（Codex のサンドボックスでは .codex/ など）があっても止まらず、残りを敷いてから最後に報告する
function put(rel, content, { exec = false } = {}) {
  if (only && only !== true && !rel.startsWith(only.replace(/\/$/, ""))) return;
  const dest = join(target, rel);
  if (existsSync(dest) && !force) { skipped.push(rel); return; }
  if (dryRun) { written.push(rel); return; }
  try {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content, { mode: exec ? 0o755 : 0o644 });
    written.push(rel);
  } catch (e) { failed.push(`${rel}（${e.code ?? e.message}）`); }
}
function rename(text) {
  return text.replace(/Sprout/g, project).replace(/sprout/g, lower).replace(/__PROJECT__/g, project).replace(/__PROJECT_LOWER__/g, lower);
}
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) { const p = join(dir, name); out.push(...(statSync(p).isDirectory() ? walk(p) : [p])); }
  return out;
}

// documents
for (const f of walk(join(assets, "documents"))) put(relative(assets, f), rename(readFileSync(f, "utf8")));
// project root（.github/workflows・.apm/instructions も含む）
const hasClaude = existsSync(join(target, ".claude")), hasCodex = existsSync(join(target, ".agents")) || existsSync(join(target, ".codex"));
for (const f of walk(join(assets, "project"))) {
  const relPath = relative(join(assets, "project"), f);
  if ([".gitignore", "cradle.json"].includes(relPath)) continue;
  if (relPath.startsWith(".claude/") && !hasClaude && hasCodex) continue;
  if (relPath.startsWith(".codex/") && !hasCodex && hasClaude) continue;
  // *.tmpl は APM に primitive として拾われないための拡張子。敷くときに外す。
  put(relPath.replace(/\.tmpl$/, ""), rename(readFileSync(f, "utf8")));
}
put("cradle.json", rename(readFileSync(join(assets, "project", "cradle.json"), "utf8")));
if (!only) {
  const gi = join(target, ".gitignore");
  const add = readFileSync(join(assets, "project", ".gitignore"), "utf8");
  if (!existsSync(gi)) put(".gitignore", add);
  else if (!readFileSync(gi, "utf8").includes("# Cradle")) { try { if (!dryRun) appendFileSync(gi, "\n" + add); written.push(".gitignore (追記)"); } catch (e) { failed.push(`.gitignore（${e.code ?? e.message}）`); } }
  else skipped.push(".gitignore");
}
// lean scaffold（Sprout → <Root> に改名しながら写す）
for (const f of walk(join(assets, "lean"))) {
  const rel = relative(join(assets, "lean"), f).split("/").map(seg => seg.replace(/^Sprout(?=\.lean$|$)/, project)).join("/");
  const text = readFileSync(f, "utf8");
  put(join("lean", rel), rename(text), { exec: f.endsWith(".mjs") });
}

if (backendPkg && backendPkg !== true) {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(backendPkg)) { console.error("--backend は Java のパッケージ名（例: com.example.notes）"); process.exit(1); }
  for (const f of walk(join(assets, "backend"))) {
    const relPath = relative(join(assets, "backend"), f);
    put(join("backend", relPath), rename(readFileSync(f, "utf8")).replace(/__PACKAGE__/g, backendPkg));
  }
}
console.log(`Cradle init — ${project} (${target})${dryRun ? " [dry-run]" : ""}`);
for (const w of written) console.log(`  + ${w}`);
for (const s of skipped) console.log(`  = ${s}（既存のため据え置き）`);
for (const f of failed) console.log(`  ! ${f}`);
if (failed.length) console.log(`\n${failed.length} 件を書けなかった。書ける権限で同じコマンドをもう一度実行すると、敷いた分は据え置いて残りだけ敷く。`);
console.log(`\n次: apm install（固有の事実を rules に写す。Codex は apm compile --single-agents）  →  cd lean && lake build  →  cradle status  →  ddd スキルで探索を始める`);
process.exit(failed.length ? 1 : 0);
