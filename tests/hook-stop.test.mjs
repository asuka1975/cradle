import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, tempProject, cleanEnv, runNode, writeTree, commitAll, git } from "./helpers.mjs";

const hook = fileURLToPath(new URL("../.apm/skills/cradle/scripts/hook.mjs", import.meta.url));
const unslop = fileURLToPath(new URL("../.apm/skills/cradle/scripts/unslop-lint.mjs", import.meta.url));

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

// 理由は 15 件までだが 1 件の長さに上限は無い（存在しないパスの文はそのパスを載せる）。process.exit で終わると書き切る前に応答が切れる
test("Stop は理由の行が長くても、応答の JSON を切らずに差し戻す", (t) => {
  const { root, stop } = fixture(t);
  const paths = Array.from({ length: 15 }, (_, i) => `${"d/".repeat(5000)}x${i}.md`);
  writeTree(root, { "e2e/flow.ts": paths.map(p => `// ${p}\n`).join("") + "export const y = 1;\n" });
  const r = stop();
  assert.equal(r.decision, "block");
  for (const p of paths) assert.ok(r.reason.includes(p));
  assert.ok(Buffer.byteLength(JSON.stringify(r)) > 150_000);
});

test("読み手が stdout を先に閉じても、hook は stderr を空にして 0 で終わる（fail-open）", async (t) => {
  const { root } = fixture(t);
  writeTree(root, { "e2e/flow.ts": "// 手 1 は未決\nexport const y = 1;\n" });
  const r = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [hook, "stop"], { cwd: root, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
    p.stdout.destroy();
    let stderr = "";
    p.stderr.setEncoding("utf8"); p.stderr.on("data", d => { stderr += d; });
    p.on("error", reject);
    p.on("close", status => resolve({ status, stderr }));
    p.stdin.end(JSON.stringify({ cwd: root }));
  });
  assert.deepEqual(r, { status: 0, stderr: "" });
});

test("Stop は warn だけの差分や違反の無い差分では差し戻さない", (t) => {
  const { root, stop } = fixture(t);
  writeTree(root, { "e2e/flow.ts": "// たぶん動く\nexport const y = 1;\n" });
  assert.equal(stop(), null);
  writeTree(root, { "e2e/flow.ts": "export const y = 2;\n" });
  assert.equal(stop(), null);
});

// 読み取りの上限を超えたときだけが失敗での差し戻し。git の外で unslop --diff が差分を読めず 2 で止まっても、hook は止めずに通す
test("Stop は git の外では違反のあるファイルがあっても差し戻さない", (t) => {
  const root = tempProject(t, "cradle-hook-stop-nogit-");
  writeTree(root, { "e2e/flow.ts": "// 手 1 は未決\nexport const y = 1;\n" });
  const env = cleanEnv({ GIT_CEILING_DIRECTORIES: dirname(root) });
  assert.equal(runNode(unslop, ["--json"], { cwd: root, env }).status, 2);
  const r = runNode(hook, ["stop"], { cwd: root, env, input: JSON.stringify({ cwd: root }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout, "");
});

// コミットの無いリポジトリの差分は空の HEAD とのもの（追跡中と未追跡のファイル全部）
test("Stop はコミットの無いリポジトリでも新しいファイルの unslop error で差し戻す", (t) => {
  const root = tempProject(t, "cradle-hook-stop-unborn-");
  writeTree(root, { "e2e/flow.ts": "// 手 1 は未決\nexport const y = 1;\n" });
  git(root, "init", "-q");
  const r = runNode(hook, ["stop"], { cwd: root, env: cleanEnv(), input: JSON.stringify({ cwd: root }) });
  assert.deepEqual([r.status, r.stderr], [0, ""]);
  assert.deepEqual(JSON.parse(r.stdout), { decision: "block", reason: `作業ツリーの差分に unslop 違反（error）が 1 件あります。止まる前に直すこと（規約は unslop と comments）:\n${reasonLine(1)}` });
});

// core.quotePath の既定（true）の git が引用符と 8 進で返す非 ASCII のパスも、Stop の差分に入る
test("Stop は非 ASCII の名前のファイルの unslop error でも、コミットのあるリポジトリでも無いリポジトリでも差し戻す", (t) => {
  const note = "documents/ai-notes/20261030-01-検討.md";
  const lines = [
    `- ${note}:1 [ai-note-header] ファイル名は YYYYMMDD-NN-<topic>.md（20261030-01-検討.md）`,
    `- ${note}:1 [ai-note-header] 冒頭に「これは規約ではありません。」の断りが無い`,
    "- e2e/手.ts:1 [comment-status] コメントにドメイン事実のステータス語 — 可変の状態を 2 か所に持たない",
  ].join("\n");
  const expected = { decision: "block", reason: `作業ツリーの差分に unslop 違反（error）が 3 件あります。止まる前に直すこと（規約は unslop と comments）:\n${lines}` };
  const { root, stop } = fixture(t);
  writeTree(root, { "e2e/手.ts": "export const z = 1;\n" });
  git(root, "add", "e2e/手.ts");
  git(root, "commit", "-q", "-m", "te");
  writeTree(root, { "e2e/手.ts": "// この手は未決\nexport const z = 1;\n", [note]: "# 検討\n" });
  assert.deepEqual(stop(), expected);
  const unborn = tempProject(t, "cradle-hook-stop-unborn-");
  writeTree(unborn, { "e2e/手.ts": "// この手は未決\nexport const z = 1;\n", [note]: "# 検討\n" });
  git(unborn, "init", "-q");
  git(unborn, "add", "e2e/手.ts");
  const r = runNode(hook, ["stop"], { cwd: unborn, env: cleanEnv(), input: JSON.stringify({ cwd: unborn }) });
  assert.deepEqual([r.status, r.stderr], [0, ""]);
  assert.deepEqual(JSON.parse(r.stdout || "null"), expected);
});

// プロジェクトルートは payload.cwd から上がった最寄りの cradle.json（git のルートとは比べない）
test("Stop は cradle.json が git のルートより下のディレクトリにあっても、追跡中のファイルの変更の unslop error で差し戻す", (t) => {
  const top = tempDir(t, "cradle-hook-stop-sub-");
  writeTree(top, { "app/cradle.json": JSON.stringify({ project: "Example" }), "app/e2e/flow.ts": "export const y = 1;\n" });
  commitAll(top);
  writeTree(top, { "app/e2e/flow.ts": "// 手 1 は未決\nexport const y = 1;\n" });
  const app = join(top, "app");
  const r = runNode(hook, ["stop"], { cwd: app, env: cleanEnv(), input: JSON.stringify({ cwd: app }) });
  assert.deepEqual([r.status, r.stderr], [0, ""]);
  assert.deepEqual(JSON.parse(r.stdout || "null"), { decision: "block", reason: `作業ツリーの差分に unslop 違反（error）が 1 件あります。止まる前に直すこと（規約は unslop と comments）:\n${reasonLine(1)}` });
});
