// テストの共通の足場: 一時プロジェクト・子プロセスの環境・スクリプトの起動・git 管理の fixture。
// ファイル名が *.test.mjs でないので、npm test の glob はこれをテストとして走らせない
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

/** テストごとの一時ディレクトリ。テストの終わりに消す。 */
export function tempDir(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** cradle.json を置いた一時プロジェクト。 */
export function tempProject(t, prefix, config = { project: "Example" }) {
  const root = tempDir(t, prefix);
  writeFileSync(join(root, "cradle.json"), JSON.stringify(config));
  return root;
}

// Claude Code の中で走るとプロジェクトルートが cradle 自身に解決されるので、子プロセスにはルートを指す変数を渡さない。
// 子の git には利用者の設定（global・system・-c で渡した設定）を読ませず、git の hook から npm test を走らせたときに渡る
// 呼び手のリポジトリ（GIT_DIR・GIT_INDEX_FILE など）も渡さない。git の設定を差し込むテストは extra に GIT_CONFIG_COUNT などを渡す（extra は最後に重ねる）
export function cleanEnv(extra = {}) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR",
    "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"]) delete env[key];
  return { ...env, ...extra };
}

export function runNode(script, args, { cwd, env, input, timeout = 20_000 } = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: "utf8", timeout, input });
}

/** { "相対パス": "中身" } を root の下に書く（親ディレクトリも作る）。 */
export function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

// cleanEnv が利用者の git 設定を切るので、作者は引数で渡す（署名もここで切る）
export function git(root, ...args) {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, env: cleanEnv(), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

/** root を git 管理にして、いまあるファイルを全部コミットする。 */
export function commitAll(root) {
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
}
