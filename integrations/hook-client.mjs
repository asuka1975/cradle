// 既存CLIを無変更で呼び出す。判定規則はこのアダプターに複製しない。
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const scripts = new URL("../.apm/skills/cradle/scripts/", import.meta.url);

function run(script, args, cwd, input) {
  // 別ハーネスから起動した場合も、イベントのcwdを既存CLIに渡す。
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CRADLE_PROJECT_DIR;
  delete env.CRADLE_CONFIG;
  return new Promise((resolve, reject) => {
    const child = execFile("node", [fileURLToPath(new URL(script, scripts)), ...args], {
      cwd, env, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout) => {
      // unslopは違反を見つけるとexit 1を返す。その他の失敗は握りつぶさない。
      if (error && !(script === "unslop-lint.mjs" && error.code === 1 && stdout.trim())) {
        reject(new Error(`Cradle ${script} の実行に失敗しました`, { cause: error }));
        return;
      }
      try { resolve(stdout.trim() ? JSON.parse(stdout) : null); }
      catch (cause) { reject(new Error(`Cradle ${script} の応答がJSONではありません`, { cause })); }
    });
    child.stdin.on("error", () => { /* プロセスの失敗はexecFileのcallbackで報告する。 */ });
    child.stdin.end(input);
  });
}

export function callHook(mode, payload) {
  return run("hook.mjs", [mode], payload.cwd, JSON.stringify(payload));
}

export function reminder(result) {
  return result?.reason ?? result?.hookSpecificOutput?.additionalContext;
}

// Piでは未初期化のGitリポジトリでも検査するため、既存CLIの--allを利用する。
export async function checkAll(root) {
  const result = await run("unslop-lint.mjs", ["--all", "--json"], root);
  const errors = result?.findings?.filter(f => f.severity === "error") ?? [];
  if (!errors.length) return null;
  const lines = errors.slice(0, 15).map(f => `- ${f.file}:${f.line} [${f.rule}] ${f.message}`);
  return `unslop --all の検査対象にerrorが ${errors.length} 件あります。終了前に修正してください。\n${lines.join("\n")}${errors.length > 15 ? "\n…（cradle unslop --all で全件）" : ""}`;
}
