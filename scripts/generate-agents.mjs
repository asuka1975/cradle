#!/usr/bin/env node
// .apm/agentsを正本として、実行環境固有のヘッダーだけを生成する。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");
const toolMap = { Read: ["read"], Write: ["write"], Edit: ["edit"], Bash: ["bash"], Grep: ["grep"], Glob: ["find", "ls"] };
const guidance = "プロジェクトの AGENTS.md と利用するスキルの SKILL.md を読む。道具の <skills> は .agents/skills。子エージェント自身は ddd.mjs・questions.md・.session を操作せず、質問を親へ返す。";
let stale = false;

for (const target of ["pi", "opencode"]) {
  const dir = join(root, "integrations", target, "agents");
  if (!check) mkdirSync(dir, { recursive: true });
  const expected = new Set();
  for (const file of readdirSync(join(root, ".apm", "agents")).sort()) {
    if (!file.endsWith(".agent.md")) continue;
    const text = readFileSync(join(root, ".apm", "agents", file), "utf8");
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error(`Invalid agent: ${file}`);
    const fields = Object.fromEntries(match[1].split(/\r?\n/).map(line => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    }));
    const tools = (fields.tools ?? "").split(/,\s*/);
    const description = fields.description.replace(/Claude Code では[^。]*。/g, "").replace(/Codex では[^。]*。/g, "").trim();
    const header = ["---", `name: ${fields.name}`, `description: ${description}`];
    if (target === "pi") {
      header.push("advertise: true", `tools: ${tools.flatMap(tool => toolMap[tool] ?? []).join(", ")}`, "inheritProjectContext: true");
    } else {
      // 許可範囲は正本のツールから導出し、書込みのないレビュアーへeditを与えない。
      header.push("mode: subagent", "permissions:");
      const permissions = [
        ["read", "allow"],
        ["edit", tools.some(t => t === "Write" || t === "Edit") ? "ask" : "deny"],
        ["shell", tools.includes("Bash") ? "ask" : "deny"],
      ];
      for (const [action, effect] of permissions) header.push(`  - action: ${action}`, '    resource: "*"', `    effect: ${effect}`);
    }
    header.push("---", "", guidance, "");
    if (tools.some(tool => tool.startsWith("mcp__"))) header.push("ブラウザ用MCPは環境ごとに設定する。利用できなければ実画面のレビューは未実施と報告し、実施済みと扱わない。", "");
    const result = [...header, match[2].trim(), ""].join("\n");
    const name = `${fields.name}.md`;
    expected.add(name);
    const output = join(dir, name);
    if (!existsSync(output) || readFileSync(output, "utf8") !== result) {
      stale = true;
      if (!check) writeFileSync(output, result);
    }
  }
  for (const file of existsSync(dir) ? readdirSync(dir) : []) {
    if (!file.endsWith(".md") || expected.has(file)) continue;
    stale = true;
    if (!check) unlinkSync(join(dir, file));
  }
}
if (check && stale) {
  console.error("generated agents are out of date. Run: node scripts/generate-agents.mjs");
  process.exitCode = 1;
} else console.log(check ? "generated agents are up to date" : "generated Pi/OpenCode agents");
