import test from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree, commitAll } from "./helpers.mjs";

const hook = fileURLToPath(new URL("../.apm/skills/cradle/scripts/hook.mjs", import.meta.url));

// 一時プロジェクト（git 管理）: unslop の --diff は HEAD との差分を見るので、空の e2e/flow.ts をコミットしてから各テストが書き換える
function fixture(t) {
  const root = tempProject(t, "cradle-hook-stop-");
  writeTree(root, { "e2e/flow.ts": "export const y = 1;\n" });
  commitAll(root);
  const stop = (payload = {}) => {
    const r = runNode(hook, ["stop"], { cwd: root, env: cleanEnv(), input: JSON.stringify({ cwd: root, ...payload }) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    return r.stdout ? JSON.parse(r.stdout) : null;
  };
  return { root, stop };
}

const reasonLine = (n) => `- e2e/flow.ts:${n} [comment-status] コメントにドメイン事実のステータス語 — 可変の状態を 2 か所に持たない`;

test("Stop は差分の unslop error を先頭 15 件だけ並べ、16 件目からは全件の出し方を一行で添えて差し戻す", (t) => {
  const { root, stop } = fixture(t);
  writeTree(root, { "e2e/flow.ts": Array.from({ length: 16 }, (_, i) => `// 手 ${i + 1} は未決\n`).join("") + "export const y = 1;\n" });
  const lines = Array.from({ length: 15 }, (_, i) => reasonLine(i + 1)).join("\n");
  assert.deepEqual(stop(), { decision: "block", reason: `作業ツリーの差分に unslop 違反（error）が 16 件あります。止まる前に直すこと（規約は unslop と comments）:\n${lines}\n…（cradle unslop --diff で全件）` });
  // 15 件ちょうどなら省略の行は付かない
  writeTree(root, { "e2e/flow.ts": Array.from({ length: 15 }, (_, i) => `// 手 ${i + 1} は未決\n`).join("") + "export const y = 1;\n" });
  assert.deepEqual(stop(), { decision: "block", reason: `作業ツリーの差分に unslop 違反（error）が 15 件あります。止まる前に直すこと（規約は unslop と comments）:\n${lines}` });
  // 再入（stop_hook_active）は検査せず通す
  assert.equal(stop({ stop_hook_active: true }), null);
});

// unslop --json の出力はパイプ（hook-decide の spawnSync）越しに読む。error が 1200 件なら 280KB 余りで、パイプの容量を超える
test("Stop は差分の unslop error が多くても unslop --json を全部読んで差し戻す", (t) => {
  const { root, stop } = fixture(t);
  writeTree(root, { "e2e/flow.ts": Array.from({ length: 1200 }, (_, i) => `// 手 ${i + 1} は未決\n`).join("") + "export const y = 1;\n" });
  const lines = Array.from({ length: 15 }, (_, i) => reasonLine(i + 1)).join("\n");
  assert.deepEqual(stop(), { decision: "block", reason: `作業ツリーの差分に unslop 違反（error）が 1200 件あります。止まる前に直すこと（規約は unslop と comments）:\n${lines}\n…（cradle unslop --diff で全件）` });
});

// 6000 件なら 1.4MB 余りで、spawnSync の既定の maxBuffer（1MB）を超える
test("Stop は unslop --json が 1MB を超えても全部読んで差し戻す", (t) => {
  const { root, stop } = fixture(t);
  writeTree(root, { "e2e/flow.ts": Array.from({ length: 6000 }, (_, i) => `// 手 ${i + 1} は未決\n`).join("") + "export const y = 1;\n" });
  const lines = Array.from({ length: 15 }, (_, i) => reasonLine(i + 1)).join("\n");
  assert.deepEqual(stop(), { decision: "block", reason: `作業ツリーの差分に unslop 違反（error）が 6000 件あります。止まる前に直すこと（規約は unslop と comments）:\n${lines}\n…（cradle unslop --diff で全件）` });
});

test("Stop は warn だけの差分や違反の無い差分では差し戻さない", (t) => {
  const { root, stop } = fixture(t);
  writeTree(root, { "e2e/flow.ts": "// たぶん動く\nexport const y = 1;\n" });
  assert.equal(stop(), null);
  writeTree(root, { "e2e/flow.ts": "export const y = 2;\n" });
  assert.equal(stop(), null);
});

// 読み取りの上限を超えたときだけが失敗での差し戻し。git の外で unslop --diff が差分を読めなくても、hook は止めずに通す
test("Stop は git の外では違反のあるファイルがあっても差し戻さない", (t) => {
  const root = tempProject(t, "cradle-hook-stop-nogit-");
  writeTree(root, { "e2e/flow.ts": "// 手 1 は未決\nexport const y = 1;\n" });
  const r = runNode(hook, ["stop"], { cwd: root, env: cleanEnv({ GIT_CEILING_DIRECTORIES: dirname(root) }), input: JSON.stringify({ cwd: root }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout, "");
});
