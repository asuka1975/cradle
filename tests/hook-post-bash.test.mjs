import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, gitConfigEnv, runNode, writeTree, commitAll } from "./helpers.mjs";

const hook = fileURLToPath(new URL("../.apm/skills/cradle/scripts/hook.mjs", import.meta.url));

// 判定の順序は hook-decide.test.mjs が git を差し替えて見る。ここは既定の git status が利用者の git 設定に左右されないことを、プロセスを起こして見る
test("post-bash は frontend の新しいファイルだけの変更も status.showUntrackedFiles=no に依らず未コミットの変更と見て、画面の確かめを促す", (t) => {
  const root = tempProject(t, "cradle-hook-post-bash-");
  writeTree(root, { "frontend/package.json": "{}\n" });
  commitAll(root);
  writeTree(root, { "frontend/src/NoteList.tsx": "export const NoteList = () => null;\n" });
  const input = JSON.stringify({ cwd: root, tool_input: { command: "pnpm test" }, tool_response: "ok" });
  for (const env of [cleanEnv(), cleanEnv(gitConfigEnv({ "status.showUntrackedFiles": "no" }))]) {
    const r = runNode(hook, ["post-bash"], { cwd: root, env, input });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.match(JSON.parse(r.stdout || "null")?.hookSpecificOutput?.additionalContext ?? "", /frontend-ux-review/, env.GIT_CONFIG_COUNT ?? "既定");
  }
});
