import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, tempProject, cleanEnv, runNode, writeTree, git, commitAll } from "./helpers.mjs";

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

// core.quotePath の既定（true）の git は非 ASCII のパスを引用符と 8 進（"e2e/\346\211\213.ts"）で返す。cleanEnv は利用者の設定を読ませないので既定のまま。
// ai-notes の命名の規則は日本語の topic を拾うためにある
const note = "documents/ai-notes/20261030-01-検討.md";
const noteFindings = [`ai-note-header ${note}:1`, `ai-note-header ${note}:1`];
const ids = (r) => JSON.parse(r.stdout).findings.map(f => `${f.rule} ${f.file}:${f.line}`).sort();

test("--diff は非 ASCII の名前のファイルも、コミットのあるリポジトリ（変更と未追跡）でもコミットの無いリポジトリ（追跡中と未追跡）でも検査する", (t) => {
  const committed = fixture(t);
  writeTree(committed.root, { "e2e/手.ts": "export const z = 1;\n" });
  commitAll(committed.root);
  writeTree(committed.root, { "e2e/手.ts": "// この手は未決\nexport const z = 1;\n", [note]: "# 検討\n" });
  const unborn = fixture(t);
  writeTree(unborn.root, { "e2e/手.ts": "// この手は未決\nexport const z = 1;\n", [note]: "# 検討\n" });
  git(unborn.root, "init", "-q");
  git(unborn.root, "add", "e2e/手.ts");
  for (const [{ run }, extra] of [[committed, []], [unborn, ["comment-status e2e/flow.ts:1"]]]) {
    const r = run(["--json"]);
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(ids(r), [...noteFindings, ...extra, "comment-status e2e/手.ts:1"].sort());
  }
});

// cradle.json の置き場（cfg.root）が git のルートより下でも、diff はそのディレクトリからの相対で、その下だけを読む（ls-files と同じ範囲）
test("--diff は cradle.json が git のルートより下のディレクトリにあっても、追跡中のファイルの変更を検査し、その外の変更と配布物のスクリプトは見ない", (t) => {
  const top = tempDir(t, "cradle-unslop-sub-");
  writeTree(top, {
    "app/cradle.json": JSON.stringify({ project: "Example" }),
    "app/e2e/flow.ts": "export const y = 1;\n",
    "app/.claude/skills/cradle/scripts/status.mjs": "export const x = 1;\n",
    "other/e2e/flow.ts": "export const y = 1;\n",
  });
  commitAll(top);
  writeTree(top, {
    "app/e2e/flow.ts": "// この流れは未決\nexport const y = 1;\n",
    "app/.claude/skills/cradle/scripts/status.mjs": "// 未決 = 状況セルが空の行\nexport const x = 1;\n",
    "other/e2e/flow.ts": "// 外の流れは未決\nexport const y = 1;\n",
  });
  const app = join(top, "app");
  for (const args of [["--diff", "--json"], ["--json"]]) {
    const r = runNode(unslop, args, { cwd: app, env: cleanEnv() });
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(ids(r), ["comment-status e2e/flow.ts:1"]);
  }
});
