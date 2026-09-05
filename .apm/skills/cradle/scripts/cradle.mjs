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
  const r = spawnSync("git", ["grep", "-n", "-I", "--", id], { encoding: "utf8" });
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
  const lines = [`package ${outPkg}`, "", `import ${pkg}.${cls}`, "", "/** 生成された契約テストに本番実装を配線する。fake を挟まない — 本番の実装を実 DB 相手にそのまま使う。 */",
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
    const head = spawnSync("git", ["log", "-1", "--format=%cI"], { cwd: cfg.root, encoding: "utf8" }).stdout.trim();
    for (const n of names) {
      const r = spawnSync("docker", ["inspect", "--format", "{{.Created}}", n], { encoding: "utf8" });
      const created = (r.stdout || "").trim();
      const stale = created && head && new Date(created) < new Date(head);
      console.log(`${r.status === 0 ? (stale ? "STALE  " : "fresh  ") : "missing"} ${n.padEnd(28)} created=${created || "-"} head=${head}`);
    }
    process.exit(0);
  }
  const tools = [["node", ["--version"]], ["lake", ["--version"]], ["elan", ["--version"]], ["java", ["-version"]], ["pnpm", ["--version"]], ["apm", ["--version"]], ["git", ["--version"]], ["docker", ["--version"]], ["terraform", ["--version"]]];
  for (const [bin, args] of tools) {
    const r = spawnSync(bin, args, { encoding: "utf8" });
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
