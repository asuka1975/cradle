import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode } from "./helpers.mjs";

const unslop = fileURLToPath(new URL("../.apm/skills/cradle/scripts/unslop-lint.mjs", import.meta.url));

// 一時プロジェクト: cradle.json と e2e/ だけ。散文は各テストが置く
function fixture(t) {
  const root = tempProject(t, "cradle-unslop-");
  mkdirSync(join(root, "e2e"), { recursive: true });
  const env = cleanEnv();
  const put = (rel, text) => { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), text); };
  const findings = () => {
    const r = runNode(unslop, ["--all", "--json"], { cwd: root, env });
    return JSON.parse(r.stdout).findings.filter(f => f.rule === "stale-path");
  };
  return { put, findings };
}

test("ハーネスの散文が指す未作成のパスは、そのディレクトリが既にあっても stale-path にしない", (t) => {
  const { put, findings } = fixture(t);
  put(".claude/skills/e2e-parity/SKILL.md", "1. `scripts/flows-from-golden.mjs --out e2e/scenarios/from-golden.json`。\n");
  put(".claude/rules/project.md", "- 台本: e2e/scenarios/from-golden.json\n");
  put("AGENTS.md", "台本は e2e/scenarios/from-golden.json にある。\n");
  assert.deepEqual(findings(), []);
});

test("消費側の散文（README と .apm/instructions の固有の事実）が指す無いパスは stale-path になる", (t) => {
  const { put, findings } = fixture(t);
  put("README.md", "設計は docs/missing.md にある。\n");
  put(".apm/instructions/project.instructions.md", "- 実行可能仕様: lean/Nothing.lean\n");
  const files = findings().map(f => f.file).sort();
  assert.deepEqual(files, [".apm/instructions/project.instructions.md", "README.md"]);
});
