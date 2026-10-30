// テストの共通の足場: 一時プロジェクト・子プロセスの環境・スクリプトの起動。
// ファイル名が *.test.mjs でないので、npm test の glob はこれをテストとして走らせない
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// Claude Code の中で走るとプロジェクトルートが cradle 自身に解決されるので、子プロセスにはルートを指す変数を渡さない
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  return { ...env, ...extra };
}

export function runNode(script, args, { cwd, env, input, timeout = 20_000 } = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: "utf8", timeout, input });
}
