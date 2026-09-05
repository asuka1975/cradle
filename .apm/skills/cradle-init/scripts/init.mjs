#!/usr/bin/env node
// init — 新しいプロダクトに Cradle の骨格を敷く。
//   init --project <Root> [--dir <path>] [--backend <package>] [--dry-run] [--force]
//   --backend <package> を付けると backend/ の骨格（ktlint 独自ルール・.editorconfig・gradle.properties）も敷く（例: com.example.notes）
//   <Root> は Lean のルート名前空間（例: MonoWa）。lake の exe 名は小文字にしたもの。
// 敷くもの: cradle.json / CLAUDE.md / .gitignore / documents/{ddd,ai-notes,infra-design,codebase} / lean/（動く最小ドメイン付き）
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
if (!project || !/^[A-Z][A-Za-z0-9]*$/.test(project)) { console.error("--project <Root> が要ります（大文字始まりの英数字。例: MonoWa）"); process.exit(1); }
const lower = project.toLowerCase();
const assets = join(import.meta.dirname, "..", "assets");

const written = [], skipped = [];
function put(rel, content, { exec = false } = {}) {
  const dest = join(target, rel);
  if (existsSync(dest) && !force) { skipped.push(rel); return; }
  written.push(rel);
  if (dryRun) return;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content, { mode: exec ? 0o755 : 0o644 });
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
// project root（.github/workflows も含む）
for (const f of walk(join(assets, "project"))) {
  const relPath = relative(join(assets, "project"), f);
  if ([".gitignore", "cradle.json", "CLAUDE.md"].includes(relPath)) continue;
  put(relPath, rename(readFileSync(f, "utf8")));
}
put("cradle.json", rename(readFileSync(join(assets, "project", "cradle.json"), "utf8")));
put("CLAUDE.md", rename(readFileSync(join(assets, "project", "CLAUDE.md"), "utf8")));
{
  const gi = join(target, ".gitignore");
  const add = readFileSync(join(assets, "project", ".gitignore"), "utf8");
  if (!existsSync(gi)) put(".gitignore", add);
  else if (!readFileSync(gi, "utf8").includes("# Cradle")) { written.push(".gitignore (追記)"); if (!dryRun) appendFileSync(gi, "\n" + add); }
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
console.log(`\n次: cd lean && lake build  →  cradle status  →  /ddd で探索を始める`);
