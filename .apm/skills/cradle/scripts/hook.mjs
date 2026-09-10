#!/usr/bin/env node
// hook — Claude Code / Codex のライフサイクル hook。stdin の JSON を読み、判定を JSON で返す（stdin / stdout の形は両者で同じ）。
//   hook pre-guard   PreToolUse(Edit|Write|MultiEdit|NotebookEdit|Agent|Bash。Codex では apply_patch / spawn_agent が同じ matcher に掛かる):
//                    生成物・保護領域・golden・探索ドキュメントへの直接編集を止める。Bash は探索役（Codex の agent_type）が中継の道具を触るのを止めるだけ
//   hook post-edit   PostToolUse(Edit|Write|MultiEdit): 契約・Lean・ai-notes を編集したあとの促し
//   hook post-bash   PostToolUse(Bash): ビルド成功のあとにレビューを促す（gradle build → SQL 性能 + backend 設計、lake build → golden 回帰）
//   hook stop        Stop: 作業ツリーの差分に unslop 違反があれば一度だけ差し戻す
import { evaluatePreGuard, evaluatePostBash, evaluatePostEdit, evaluateStopCheck } from "./policy.mjs";
import { findProjectRoot, loadConfig } from "./lib.mjs";

const mode = process.argv[2];
let payload = {};
try { payload = JSON.parse((await import("node:fs")).readFileSync(0, "utf8") || "{}"); } catch { payload = {}; }
const out = (obj) => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
const allow = () => process.exit(0);
const isClaude = Boolean(process.env.CLAUDE_PROJECT_DIR);

let cfg;
try { cfg = loadConfig(findProjectRoot(payload.cwd ?? process.cwd())); } catch { allow(); }

const projectRoot = cfg?.root ?? payload.cwd ?? process.cwd();

if (mode === "pre-guard") {
  const decision = evaluatePreGuard({
    projectRoot,
    cfg,
    toolName: payload.tool_name,
    toolInput: payload.tool_input,
    basePath: payload.cwd,
    agentType: payload.agent_type ?? payload.tool_input?.subagent_type,
    runInBackground: payload.tool_input?.run_in_background,
    isClaudeLike: isClaude,
  });
  if (decision.action === "allow") allow();
  if (decision.action === "deny") out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: decision.reason } });
  if (decision.action === "ask") out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: decision.reason } });
  if (decision.action === "remind") out({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: decision.message } });
  allow();
}

if (mode === "post-bash") {
  const decision = evaluatePostBash({
    projectRoot,
    cfg,
    command: String(payload.tool_input?.command ?? ""),
    toolResponse: payload.tool_response,
  });
  if (decision?.action === "block") out({ decision: "block", reason: decision.reason });
  if (decision?.action === "remind") out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: decision.message } });
  allow();
}

if (mode === "post-edit") {
  const decision = evaluatePostEdit({
    projectRoot,
    cfg,
    toolName: payload.tool_name,
    toolInput: payload.tool_input,
    basePath: payload.cwd,
  });
  if (decision?.action === "remind") out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: decision.message } });
  allow();
}

if (mode === "stop") {
  const decision = evaluateStopCheck({ projectRoot, cfg, stopHookActive: payload.stop_hook_active });
  if (decision?.action === "block") out({ decision: "block", reason: decision.reason });
  allow();
}

allow();
