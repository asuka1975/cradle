import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree } from "./helpers.mjs";

const unslop = fileURLToPath(new URL("../.apm/skills/cradle/scripts/unslop-lint.mjs", import.meta.url));

// 一時プロジェクト: 逃げ言葉のコメントを 1 つ持つ e2e/flow.ts だけ（warn が 1 件）
function fixture(t) {
  const root = tempProject(t, "cradle-unslop-files-");
  writeTree(root, { "e2e/flow.ts": "// たぶん動く\nexport const y = 1;\n" });
  const run = (args, cwd = root) => runNode(unslop, args, { cwd, env: cleanEnv() });
  return { root, run };
}

test("unslop に渡したファイルが無ければ、0 件と言わずに無いパスを並べて 2 で終わる", (t) => {
  const { run } = fixture(t);
  const r = run(["no/such/File.kt", "--json"]);
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, "", "cradle: ファイルがありません（プロジェクトルートからの相対）: no/such/File.kt\n"]);
  // 在るファイルと混ざっていても検査せず、無いものだけを渡した形のまま並べる
  const mixed = run(["e2e/flow.ts", "e2e/missing.ts", "/no/such/abs.ts"]);
  assert.deepEqual([mixed.status, mixed.stdout, mixed.stderr], [2, "", "cradle: ファイルがありません（プロジェクトルートからの相対）: e2e/missing.ts, /no/such/abs.ts\n"]);
});

test("unslop に渡した相対パスはプロジェクトルートから読み、サブディレクトリで呼んでも同じファイルを検査する", (t) => {
  const { root, run } = fixture(t);
  for (const [args, cwd] of [[["e2e/flow.ts", "--json"], root], [["e2e/flow.ts", "--json"], join(root, "e2e")], [[join(root, "e2e/flow.ts"), "--json"], join(root, "e2e")]]) {
    const r = run(args, cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).findings.map(f => `${f.rule} ${f.file}:${f.line}`), ["hedge e2e/flow.ts:1"]);
  }
});
