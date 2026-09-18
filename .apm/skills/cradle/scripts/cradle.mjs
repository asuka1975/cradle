#!/usr/bin/env node
// cradle — 決定論的な道具の入口。`node <this> <command> [args]`
//   spec-query | golden-check | lean-check | regen-impact | unslop | status | ddd-clean-check | doctor [--local] | refs <ID> | contract-skeleton <file> | hook
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const [cmd, ...args] = process.argv.slice(2);
if (cmd === "refs") {
  // refs <ID>: 撤回・訂正の伝播 — その ID を引いている場所を全部出す（documents / lean / 契約 / 設計 / README）
  const id = args[0];
  if (!id) { console.error("usage: cradle refs <HS-001|MQ-003|UX-002|INFRA-D-004|イベント#5>"); process.exit(1); }
  const r = spawnSync("git", ["grep", "-n", "-I", "--", id], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  const lines = (r.stdout || "").split("\n").filter(Boolean);
  console.log(`${id}: ${lines.length} 箇所`);
  for (const l of lines) console.log("  " + l);
  console.log("documents 側で撤回・訂正したら、ここに出た派生（Lean の出典・openapi・infra-design・README）を洗い直すこと。");
  process.exit(0);
}
if (cmd === "contract-skeleton") {
  // contract-skeleton <生成された抽象契約テスト.kt> [--package <pkg>]: 具象サブクラスの骨格を標準出力に出す
  const file = args[0];
  if (!file) { console.error("usage: cradle contract-skeleton backend/src/generated/kotlin-test/.../XxxContractTest.kt"); process.exit(1); }
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(file, "utf8");
  const pkg = (text.match(/^package\s+(\S+)/m) ?? [])[1] ?? "";
  const cls = (text.match(/abstract\s+class\s+(\w+)/) ?? [])[1];
  if (!cls) { console.error("abstract class が見つかりません"); process.exit(1); }
  const sigs = [...text.matchAll(/^\s*(?:protected\s+)?abstract\s+fun\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^\n={]+)/gm)];
  const outPkg = (args.indexOf("--package") >= 0 ? args[args.indexOf("--package") + 1] : pkg);
  const lines = [`package ${outPkg}`, "", `import ${pkg}.${cls}`, "", "/** 生成された契約テストに本番実装を配線する。Repository に fake を挟まない — 本番の実装を実 DB 相手にそのまま使う。Port は渡された生成モックを配線する。 */",
    `class ${cls}Impl : ${cls}() {`];
  for (const m of sigs) lines.push(`\toverride fun ${m[1]}(${m[2].trim()}): ${m[3].trim()} = TODO("wire: 本番の実装を返す（${m[3].trim()}）")`);
  lines.push("}", "");
  console.log(lines.join("\n"));
  process.exit(0);
}
if (cmd === "doctor") {
  if (args.includes("--local")) {
    // local env の鮮度: cradle.json の infra.containers（コンテナ名の配列）の Created と HEAD のコミット時刻を比べる
    const { loadConfig } = await import("./lib.mjs");
    const cfg = loadConfig();
    const names = cfg.infra.containers ?? [];
    if (!names.length) { console.log("cradle.json の infra.containers が空（例: [\"myapp-local-backend\", \"myapp-local-frontend\"]）"); process.exit(0); }
    const head = spawnSync("git", ["log", "-1", "--format=%cI"], { stdio: ["ignore", "pipe", "pipe"], cwd: cfg.root, encoding: "utf8" }).stdout.trim();
    for (const n of names) {
      const r = spawnSync("docker", ["inspect", "--format", "{{.Created}}", n], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
      const created = (r.stdout || "").trim();
      const stale = created && head && new Date(created) < new Date(head);
      console.log(`${r.status === 0 ? (stale ? "STALE  " : "fresh  ") : "missing"} ${n.padEnd(28)} created=${created || "-"} head=${head}`);
    }
    process.exit(0);
  }
  // ハーネスの置き場と配線: Claude Code は .claude/skills + .claude/settings.json、Codex は .agents/skills + .codex/hooks.json + AGENTS.md、Pi は pi package + .pi/settings.json
  const { existsSync, readFileSync, statSync } = await import("node:fs");
  const { findProjectRoot } = await import("./lib.mjs");
  const root = findProjectRoot();
  const homes = [".claude/skills/cradle", ".agents/skills/cradle"].filter(d => existsSync(join(root, d)));
  console.log(`${homes.length ? "ok     " : "missing"} harness    ${homes.join(", ") || "（apm install で配る）"}`);
  const wired = (f) => existsSync(join(root, f)) && readFileSync(join(root, f), "utf8").includes("hook.mjs");
  console.log(`${wired(".claude/settings.json") || wired(".codex/hooks.json") ? "ok     " : "missing"} hooks      claude=${wired(".claude/settings.json") ? "ok" : "-"} codex=${wired(".codex/hooks.json") ? "ok" : "-"}`);
  {
    const piSettings = join(root, ".pi", "settings.json");
    const piPackage = existsSync(piSettings) && readFileSync(piSettings, "utf8").includes("cradle");
    console.log(`${piPackage ? "ok     " : "info   "} pi         ${piPackage ? ".pi/settings.json に cradle パッケージが登録済み" : "pi install -l <cradle> / pi config -l で有効化"}`);
  }
  {
    const opencodeConfig = ["opencode.json", "opencode.jsonc"].find(file =>
      existsSync(join(root, file)) && readFileSync(join(root, file), "utf8").includes("integrations/opencode"));
    console.log(`${opencodeConfig ? "ok     " : "info   "} opencode   ${opencodeConfig ? `${opencodeConfig} に Cradle plugin のパスあり（ロード状態は未確認）` : "opencode.json(c) に Cradle の integrations/opencode を plugin として追加"}`);
  }
  if (existsSync(join(root, ".codex/hooks.json"))) {
    // Codex は起動時のレビューで信頼した hook だけを動かし、その記録を ~/.codex/config.toml に [hooks.state."<hooks.json の絶対パス>:<event>:<group>:<hook>"] で持つ
    const home = process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex");
    const toml = existsSync(join(home, "config.toml")) ? readFileSync(join(home, "config.toml"), "utf8") : "";
    const key = join(root, ".codex/hooks.json") + ":";
    const trusted = toml.split("\n").filter(l => l.startsWith(`[hooks.state."${key}`)).length;
    let expected = 0;
    try { const h = JSON.parse(readFileSync(join(root, ".codex/hooks.json"), "utf8")).hooks ?? {}; for (const groups of Object.values(h)) for (const g of groups) expected += (g.hooks ?? []).length; } catch {}
    console.log(`${trusted ? "ok     " : "STALE  "} hooks-trust codex: ${trusted}/${expected} 件を信頼済み${trusted ? "" : "（Codex の起動時レビューで信頼するまで hook は動かない。codex exec なら --dangerously-bypass-hook-trust）"}`);
  }
  {
    // モックアップのサーバーは骨格の持ち物。Cradle を更新したら --only lean/mockup/server.mjs --force で敷き直す（index.html は作り込みの正本なので触らない）
    const { loadConfig: lc } = await import("./lib.mjs");
    let cfg = null; try { cfg = lc(root); } catch {}
    const cur = cfg && join(root, cfg.lean.mockup, "server.mjs");
    const shipped = join(import.meta.dirname, "..", "..", "cradle-init", "assets", "lean", "mockup", "server.mjs");
    if (cur && existsSync(cur) && existsSync(shipped)) {
      const same = readFileSync(cur, "utf8") === readFileSync(shipped, "utf8").replace(/Sprout/g, cfg.project).replace(/sprout/g, cfg.project.toLowerCase());
      console.log(`${same ? "ok     " : "STALE  "} mockup     ${cfg.lean.mockup}/server.mjs${same ? "" : ` が骨格の最新版と違う（node <skills>/cradle-init/scripts/init.mjs --project ${cfg.project} --only ${cfg.lean.mockup}/server.mjs --force）`}`);
    }
  }
  if (existsSync(join(root, "AGENTS.md"))) {
    const size = statSync(join(root, "AGENTS.md")).size;
    const toml = existsSync(join(root, ".codex/config.toml")) ? readFileSync(join(root, ".codex/config.toml"), "utf8") : "";
    const limit = Number((toml.match(/^\s*project_doc_max_bytes\s*=\s*(\d+)/m) ?? [])[1] ?? 32768);
    console.log(`${size > limit ? "STALE  " : "ok     "} AGENTS.md  ${size} bytes / Codex の上限 ${limit}${size > limit ? "（.codex/config.toml の project_doc_max_bytes を上げる。超えた分は黙って切られる）" : ""}`);
  }
  {
    // 生成器 lean2kotlin: LEAN2KOTLIN_HOME → apm が配った写し（apm_modules/<owner>/cradle/lean2kotlin）の順に、generator/ と lean/ を両方持つ場所を探す
    const { readdirSync } = await import("node:fs");
    const modules = join(root, "apm_modules");
    const shipped = existsSync(modules) ? readdirSync(modules).map(o => join(modules, o, "cradle", "lean2kotlin")) : [];
    const l2k = [process.env.LEAN2KOTLIN_HOME, ...shipped].filter(Boolean).find(d => existsSync(join(d, "generator")) && existsSync(join(d, "lean")));
    console.log(`${l2k ? "ok     " : "missing"} lean2kotlin ${l2k ?? "（backend フェーズで要る。apm install で apm_modules に配られる。別のチェックアウトを使うなら LEAN2KOTLIN_HOME）"}`);
  }
  const tools = [["node", ["--version"]], ["lake", ["--version"]], ["elan", ["--version"]], ["java", ["-version"]], ["pnpm", ["--version"]], ["apm", ["--version"]], ["claude", ["--version"]], ["codex", ["--version"]], ["git", ["--version"]], ["docker", ["--version"]], ["terraform", ["--version"]]];
  for (const [bin, args] of tools) {
    const r = spawnSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    const v = ((r.stdout || "") + (r.stderr || "")).split("\n")[0].trim();
    console.log(`${r.error ? "missing" : "ok     "} ${bin.padEnd(10)} ${r.error ? "" : v}`);
  }
  process.exit(0);
}
const map = { "spec-query": "spec-query.mjs", "golden-check": "golden-check.mjs", "lean-check": "lean-check.mjs", "regen-impact": "regen-impact.mjs", unslop: "unslop-lint.mjs", status: "status.mjs", "ddd-clean-check": "ddd-clean-check.mjs", hook: "hook.mjs" };
if (!map[cmd]) {
  console.log("usage: cradle <command> [args]\n  " + Object.keys(map).join("\n  "));
  process.exit(cmd ? 1 : 0);
}
const r = spawnSync(process.execPath, [join(import.meta.dirname, map[cmd]), ...args], { stdio: "inherit" });
process.exit(r.status ?? 1);
