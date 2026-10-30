import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, tempProject, cleanEnv, runNode, writeTree, git } from "./helpers.mjs";

const unslop = fileURLToPath(new URL("../.apm/skills/cradle/scripts/unslop-lint.mjs", import.meta.url));

const noGit = "cradle: --diff（引数の無い既定）は git で HEAD との差分を読むので、git のリポジトリの中で回す。git の外では --all か、ファイルを並べて渡す\n";

// 一時プロジェクト: ステータス語のコメント（error）を持つ e2e/flow.ts。git の外のテストは一時ディレクトリの祖先の作業ツリーまで上がらない
function fixture(t) {
  const root = tempProject(t, "cradle-unslop-git-");
  writeTree(root, { "e2e/flow.ts": "// この流れは未決\nexport const y = 1;\n" });
  const run = (args, extra = {}) => runNode(unslop, args, { cwd: root, env: cleanEnv({ GIT_CEILING_DIRECTORIES: dirname(root), ...extra }) });
  return { root, run };
}

test("--diff と引数無しは git の外で差分を読めなければ、0 件と言わずに --all とファイルの指定を示して 2 で終わる", (t) => {
  const { run } = fixture(t);
  for (const args of [["--diff", "--json"], ["--diff"], []]) {
    const r = run(args);
    assert.deepEqual([r.status, r.stdout, r.stderr], [2, "", noGit]);
  }
  // git が無いときも同じ（node は絶対パスで起こすので、PATH を空のディレクトリに向けて git だけを無くす）
  const r = run(["--json"], { PATH: tempDir(t, "cradle-unslop-nopath-") });
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, "", noGit]);
  // 示した代わりの道はどちらも git の外で検査する
  assert.deepEqual([run(["--all"]).status, run(["e2e/flow.ts"]).status], [1, 1]);
});

test("コミットの無いリポジトリの --diff と引数無しは、空の HEAD との差分として追跡中と未追跡のファイルを全部検査する", (t) => {
  const { root, run } = fixture(t);
  writeTree(root, {
    "e2e/staged.ts": "// 手は未決\nexport const z = 1;\n",
    "e2e/gone.ts": "// 消した手は未決\n",
    "e2e/ignored.ts": "// 外した手は未決\n",
    ".gitignore": "e2e/ignored.ts\n",
    ".claude/skills/cradle/scripts/status.mjs": "// 未決 = 状況セルが空の行\nexport const x = 1;\n",
  });
  git(root, "init", "-q");
  git(root, "add", "e2e/staged.ts", "e2e/gone.ts");
  rmSync(`${root}/e2e/gone.ts`);
  // 追跡中（staged.ts）と未追跡（flow.ts）は検査し、作業ツリーから消したもの・無視したもの・配布物のスクリプトは見ない
  for (const args of [["--diff", "--json"], ["--json"]]) {
    const r = run(args);
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).findings.map(f => `${f.rule} ${f.file}:${f.line}`), ["comment-status e2e/flow.ts:1", "comment-status e2e/staged.ts:1"]);
  }
});
