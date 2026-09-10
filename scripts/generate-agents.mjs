#!/usr/bin/env node
// 7 つの Cradle 専任エージェントを、Pi / OpenCode V2 用の形に変換する。
// APM が配る `.apm/agents/*.agent.md` を正本とする。

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = join(root, ".apm", "agents");
const piDir = join(root, "integrations", "pi", "agents");
const opencodeDir = join(root, "integrations", "opencode", "agents");

mkdirSync(piDir, { recursive: true });
mkdirSync(opencodeDir, { recursive: true });

const AGENT_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

function parseAgent(path) {
  const text = readFileSync(path, "utf8");
  const m = text.match(AGENT_RE);
  if (!m) throw new Error(`Invalid agent frontmatter: ${path}`);
  const front = Object.fromEntries(
    m[1].split("\n")
      .filter(l => l.includes(":") && !l.startsWith("---"))
      .map(l => {
        const idx = l.indexOf(":");
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
      })
  );
  return { front, body: m[2].trim() };
}

function toPiAgent({ front, body }) {
  const lines = ["---"];
  lines.push(`name: ${front.name}`);
  lines.push(`description: ${front.description}`);
  lines.push("advertise: true");
  // ツール名を小へ統一
  const tools = (front.tools ?? "")
    .split(/,\s*|\s+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .join(", ");
  lines.push(`tools: ${tools}`);
  lines.push("inheritProjectContext: true");
  lines.push("async: true");
  lines.push("---");
  lines.push("");
  // 子専用ガード：同じリポジトリの Cradle 規約を読むよう指示
  lines.push("Cradle 規約はプロジェクトの `.apm/instructions/*.instructions.md` と `SKILL.md` にある。自分が子エージェントとして動くとき、生成物・人間専用領域・golden・探索正式ドキュメントへの直接編集は行わない。`ddd` 役は `ddd.mjs`・`questions.md`・`.session` に触らない。");
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}

function toOpenCodeAgent({ front, body }) {
  const lines = ["---"];
  lines.push(`name: ${front.name}`);
  lines.push(`description: ${front.description}`);
  lines.push("mode: subagent");
  // OpenCode V2 では model は利用者設定に委ねる
  lines.push("tools:");
  for (const t of (front.tools ?? "").split(/,\s*|\s+/).map(s => s.trim().toLowerCase()).filter(Boolean)) {
    lines.push(`  - ${t}`);
  }
  lines.push("permissions:");
  lines.push("  - action: edit");
  lines.push("    resource: documents/ddd/*");
  lines.push("    effect: allow");
  lines.push("  - action: edit");
  lines.push("    resource: documents/ai-notes/*");
  lines.push("    effect: allow");
  lines.push("  - action: edit");
  lines.push("    resource: documents/developer/*");
  lines.push("    effect: deny");
  lines.push("---");
  lines.push("");
  lines.push("Cradle 規約はプロジェクトの `.apm/instructions/*.instructions.md` と `SKILL.md` にある。子エージェントとして動くとき、生成物・人間専用領域・golden・探索正式ドキュメント（セッション印無し）への直接編集は行わない。`ddd` 役は `ddd.mjs`・`questions.md`・`.session` に触らない。");
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}

let changed = false;
for (const file of readdirSync(sourceDir)) {
  if (extname(file) !== ".md") continue;
  const agent = parseAgent(join(sourceDir, file));
  const piPath = join(piDir, file);
  const opencodePath = join(opencodeDir, file);
  const piText = toPiAgent(agent);
  const opencodeText = toOpenCodeAgent(agent);
  if (!existsSync(piPath) || readFileSync(piPath, "utf8") !== piText) {
    writeFileSync(piPath, piText);
    changed = true;
  }
  if (!existsSync(opencodePath) || readFileSync(opencodePath, "utf8") !== opencodeText) {
    writeFileSync(opencodePath, opencodeText);
    changed = true;
  }
}

if (process.argv.includes("--check")) {
  if (changed) {
    process.stderr.write("generated agents are out of date. Run: node scripts/generate-agents.mjs\n");
    process.exit(1);
  }
  process.stdout.write("generated agents are up to date\n");
} else {
  process.stdout.write(`generated Pi/OpenCode agents from ${sourceDir}\n`);
}
