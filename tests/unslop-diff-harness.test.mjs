import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const unslop = fileURLToPath(new URL("../.apm/skills/cradle/scripts/unslop-lint.mjs", import.meta.url));

// 一時プロジェクト（git 管理）: 配布物のスクリプトと消費側のコードを 1 本ずつコミットし、各テストが作業ツリーを書き換える
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cradle-unslop-diff-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  const git = (...args) => { const r = spawnSync("git", args, { cwd: root, env, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
  const put = (rel, text) => { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), text); };
  put("cradle.json", JSON.stringify({ project: "Example" }));
  put(".claude/skills/cradle/scripts/status.mjs", "export const x = 1;\n");
  put("e2e/flow.ts", "export const y = 1;\n");
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const findings = (...args) => {
    const r = spawnSync(process.execPath, [unslop, ...args, "--json"], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
    return JSON.parse(r.stdout).findings.map(f => `${f.rule} ${f.file}`);
  };
  return { put, findings };
}

test("--diff は版上げで変わった配布物のスクリプトを検査しない（--all と同じ扱い）", (t) => {
  const { put, findings } = fixture(t);
  put(".claude/skills/cradle/scripts/status.mjs", "// 未決 = 状況セルが空か open / 未決 で始まる行\nexport const x = 1;\n");
  put(".agents/skills/cradle/scripts/status.mjs", "// 未決 = 状況セルが空か open / 未決 で始まる行\nexport const x = 1;\n");
  assert.deepEqual(findings("--diff"), []);
  assert.deepEqual(findings("--all"), []);
});

test("--diff は消費側のコードのコメントを引き続き検査する", (t) => {
  const { put, findings } = fixture(t);
  put("e2e/flow.ts", "// この流れは未決\nexport const y = 1;\n");
  assert.deepEqual(findings("--diff"), ["comment-status e2e/flow.ts"]);
});
