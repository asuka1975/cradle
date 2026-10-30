#!/usr/bin/env node
// hook — Claude Code / Codex のライフサイクル hook。stdin の JSON を読み、判定を JSON で返す（stdin / stdout の形は両者で同じ）。
//   hook pre-guard   PreToolUse(Edit|Write|MultiEdit|NotebookEdit|Agent|Bash。Codex では apply_patch / spawn_agent が同じ matcher に掛かる):
//                    生成物・保護領域・golden・探索ドキュメントへの直接編集を止める。Bash は探索役（Codex の agent_type）が中継の道具を触るのを止めるだけ
//   hook post-edit   PostToolUse(Edit|Write|MultiEdit): 契約・Lean・ai-notes を編集したあとの促し
//   hook post-bash   PostToolUse(Bash): ビルド成功のあとにレビューを促す（gradle build → SQL 性能 + backend 設計、lake build → golden 回帰 + 形式化の Evaluator）
//   hook stop        Stop: 作業ツリーの差分に unslop 違反があれば一度だけ差し戻す
// 判定は hook-decide.mjs。ここは stdin を読み、設定を読み、判定を書き出して 0 で終わるだけ。
import { readFileSync } from "node:fs";
import { loadConfig, findProjectRoot } from "./lib.mjs";
import { decide } from "./hook-decide.mjs";

const mode = process.argv[2];
let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { payload = {}; }
// Claude Code は CLAUDE_PROJECT_DIR を渡す。Codex は環境を空にして cwd だけ stdin に入れるので、そこから cradle.json を持つ祖先を探す。
const isClaude = Boolean(process.env.CLAUDE_PROJECT_DIR);

let cfg;
try { cfg = loadConfig(findProjectRoot(payload.cwd ?? process.cwd())); } catch { process.exit(0); }

// 判定の途中の例外（文書と型の違う cradle.json など）も、設定が読めないときと同じく黙って通す。
// stderr に書くか 0 以外で終わると、Claude Code は hook の失敗を毎回出し、Pi / OpenCode では hook-client が道具の呼び出しごとに例外を投げる
let r = null;
try { r = decide(mode, payload, { cfg, isClaude }); } catch {}
if (r) process.stdout.write(JSON.stringify(r));
process.exit(0);
