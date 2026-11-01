#!/usr/bin/env node
// doctor — ハーネスの置き場と配線、道具の有無と版、lean2kotlin の解決可否。--local は local スタックのコンテナの鮮度
//   doctor [--local]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadConfigOrFail, findProjectRoot, readText, renameScaffold, walk } from "./lib.mjs";
const args = process.argv.slice(2);
if (args.includes("--local")) {
  // local env の鮮度: cradle.json の infra.containers（コンテナ名の配列）の Created と HEAD のコミット時刻を比べる
  const cfg = loadConfigOrFail();
  const names = cfg.infra.containers ?? [];
  if (!names.length) { console.log("cradle.json の infra.containers が空（例: [\"myapp-local-backend\", \"myapp-local-frontend\"]）"); process.exit(0); }
  // git が無ければ stdout も無い（head は空のまま比べない）
  const head = (spawnSync("git", ["log", "-1", "--format=%cI"], { stdio: ["ignore", "pipe", "pipe"], cwd: cfg.root, encoding: "utf8" }).stdout ?? "").trim();
  for (const n of names) {
    const r = spawnSync("docker", ["inspect", "--format", "{{.Created}}", n], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    const created = (r.stdout || "").trim();
    const stale = created && head && new Date(created) < new Date(head);
    console.log(`${r.status === 0 ? (stale ? "STALE  " : "fresh  ") : "missing"} ${n.padEnd(28)} created=${created || "-"} head=${head}`);
  }
  process.exit(0);
}
// ハーネスの置き場と配線: Claude Code は .claude/skills + .claude/settings.json、Codex は .agents/skills + .codex/hooks.json + AGENTS.md、Pi は pi package + .pi/settings.json
const root = findProjectRoot();
const homes = [".claude/skills/cradle", ".agents/skills/cradle"].filter(d => existsSync(join(root, d)));
console.log(`${homes.length ? "ok     " : "missing"} harness    ${homes.join(", ") || "（apm install で配る）"}`);
const wired = (f) => readText(join(root, f)).includes("hook.mjs");
console.log(`${wired(".claude/settings.json") || wired(".codex/hooks.json") ? "ok     " : "missing"} hooks      claude=${wired(".claude/settings.json") ? "ok" : "-"} codex=${wired(".codex/hooks.json") ? "ok" : "-"}`);
{
  const piSettings = join(root, ".pi", "settings.json");
  const piPackage = readText(piSettings).includes("cradle");
  console.log(`${piPackage ? "ok     " : "info   "} pi         ${piPackage ? ".pi/settings.json に cradle パッケージが登録済み" : "pi install -l <cradle> / pi config -l で有効化"}`);
}
{
  const opencodeConfig = ["opencode.json", "opencode.jsonc"].find(file =>
    readText(join(root, file)).includes("integrations/opencode"));
  console.log(`${opencodeConfig ? "ok     " : "info   "} opencode   ${opencodeConfig ? `${opencodeConfig} に Cradle plugin のパスあり（ロード状態は未確認）` : "opencode.json(c) に Cradle の integrations/opencode を plugin として追加"}`);
}
if (existsSync(join(root, ".codex/hooks.json"))) {
  // Codex は起動時のレビューで信頼した hook だけを動かし、その記録を ~/.codex/config.toml に [hooks.state."<hooks.json の絶対パス>:<event>:<group>:<hook>"] で持つ
  const home = process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex");
  const toml = readText(join(home, "config.toml"));
  const key = join(root, ".codex/hooks.json") + ":";
  const trusted = toml.split("\n").filter(l => l.startsWith(`[hooks.state."${key}`)).length;
  let expected = 0;
  try { const h = JSON.parse(readFileSync(join(root, ".codex/hooks.json"), "utf8")).hooks ?? {}; for (const groups of Object.values(h)) for (const g of groups) expected += (g.hooks ?? []).length; } catch {}
  console.log(`${trusted ? "ok     " : "STALE  "} hooks-trust codex: ${trusted}/${expected} 件を信頼済み${trusted ? "" : "（Codex の起動時レビューで信頼するまで hook は動かない。codex exec なら --dangerously-bypass-hook-trust）"}`);
}
{
  // CLI（Main.lean）とプロトコル（Runtime/Protocol.lean）は骨格の持ち物。Cradle を更新したら --only <path> --force で敷き直す（index.html は作り込みの正本なので触らない）
  let cfg = null; try { cfg = loadConfig(root); } catch {}
  // import.meta の dirname は Node 20.11 から（init.mjs と同じく URL から引く）
  const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "cradle-init", "assets", "lean");
  const hasCli = cfg && existsSync(join(root, cfg.lean.dir, "Main.lean"));
  const owned = hasCli ? [["lean-main", `${cfg.lean.dir}/Main.lean`, join(assets, "Main.lean")], ["protocol", `${cfg.lean.dir}/${cfg.lean.root}/Runtime/Protocol.lean`, join(assets, "Sprout", "Runtime", "Protocol.lean")]] : [];
  for (const [label, relPath, shipped] of owned) {
    const cur = join(root, relPath);
    if (!existsSync(shipped)) continue;
    const same = existsSync(cur) && readFileSync(cur, "utf8") === renameScaffold(readFileSync(shipped, "utf8"), { project: cfg.project });
    console.log(`${same ? "ok     " : "STALE  "} ${label.padEnd(10)} ${relPath}${same ? "" : ` が骨格の最新版と違う（node <skills>/cradle-init/scripts/init.mjs --project ${cfg.project} --only ${relPath} --force）`}`);
  }
  // モックアップは Lean をブラウザの wasm で動かす。server.mjs の時代の置き土産と、モデルより古い lean.js を知らせる
  if (cfg && existsSync(join(root, cfg.lean.mockup, "server.mjs"))) console.log(`STALE   mockup     ${cfg.lean.mockup}/server.mjs はもう使わない（Lean はブラウザの wasm で動く。docs/adopting.md の手順で移す）`);
  if (cfg && existsSync(join(root, cfg.lean.mockup, "public", "index.html"))) {
    const leanJs = join(root, cfg.lean.mockup, "public", "lean.js");
    const shown = `${cfg.lean.mockup}/public/lean.js`;
    if (!existsSync(leanJs)) console.log(`missing wasm       ${shown}（cradle mockup-build で作る。Emscripten が要る）`);
    else {
      const built = statSync(leanJs).mtimeMs;
      const newer = walk(join(root, cfg.lean.dir), { ext: [".lean"] }).filter(f => statSync(f).mtimeMs > built).length;
      console.log(`${newer ? "STALE  " : "ok     "} wasm       ${shown}${newer ? ` がモデルより古い（.lean ${newer} 本。cradle mockup-build で作り直す）` : ""}`);
    }
  }
}
if (existsSync(join(root, "AGENTS.md"))) {
  const size = statSync(join(root, "AGENTS.md")).size;
  const toml = readText(join(root, ".codex/config.toml"));
  const limit = Number((toml.match(/^\s*project_doc_max_bytes\s*=\s*(\d+)/m) ?? [])[1] ?? 32768);
  console.log(`${size > limit ? "STALE  " : "ok     "} AGENTS.md  ${size} bytes / Codex の上限 ${limit}${size > limit ? "（.codex/config.toml の project_doc_max_bytes を上げる。超えた分は黙って切られる）" : ""}`);
}
{
  // 生成器 lean2kotlin: LEAN2KOTLIN_HOME → apm が配った写し（apm_modules/<owner>/cradle/lean2kotlin）の順に、generator/ と lean/ を両方持つ場所を探す
  const modules = join(root, "apm_modules");
  const shipped = existsSync(modules) ? readdirSync(modules).map(o => join(modules, o, "cradle", "lean2kotlin")) : [];
  const l2k = [process.env.LEAN2KOTLIN_HOME, ...shipped].filter(Boolean).find(d => existsSync(join(d, "generator")) && existsSync(join(d, "lean")));
  console.log(`${l2k ? "ok     " : "missing"} lean2kotlin ${l2k ?? "（backend フェーズで要る。apm install で apm_modules に配られる。別のチェックアウトを使うなら LEAN2KOTLIN_HOME）"}`);
}
const tools = [["node", ["--version"]], ["lake", ["--version"]], ["elan", ["--version"]], ["java", ["-version"]], ["pnpm", ["--version"]], ["emcc", ["--version"]], ["apm", ["--version"]], ["claude", ["--version"]], ["codex", ["--version"]], ["git", ["--version"]], ["docker", ["--version"]], ["terraform", ["--version"]]];
for (const [bin, args] of tools) {
  const r = spawnSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  const v = ((r.stdout || "") + (r.stderr || "")).split("\n")[0].trim();
  console.log(`${r.error ? "missing" : "ok     "} ${bin.padEnd(10)} ${r.error ? "" : v}`);
}
process.exit(0);
