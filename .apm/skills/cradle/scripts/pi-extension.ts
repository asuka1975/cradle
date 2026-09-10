// Cradle for Pi — Extension entry point.
// Pi専用の判定処理を使う。既存のClaude/Codex hookは変更しない。

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { evaluatePreGuard, evaluatePostBash, evaluatePostEdit, evaluateStopCheck } from "./pi-policy.mjs";
import { findProjectRoot, loadConfig } from "./lib.mjs";

const EXTENSION_NAME = "cradle-pi";

function getProjectRoot(ctx: ExtensionContext): string | undefined {
  try { return ctx.cwd; } catch {}
  return undefined;
}

function getConfig(ctx: ExtensionContext) {
  const root = getProjectRoot(ctx);
  if (!root) return undefined;
  try { return loadConfig(findProjectRoot(root)); } catch { return undefined; }
}

export default function cradlePiExtension(pi: ExtensionAPI) {
  let stopCheckArmed = false;

  pi.on("tool_call", async (event, ctx) => {
    const cfg = getConfig(ctx);
    if (!cfg) return undefined;

    const decision = evaluatePreGuard({
      projectRoot: cfg.root,
      cfg,
      toolName: event.toolName,
      toolInput: event.input as Record<string, unknown>,
      basePath: cfg.root,
      agentType: undefined,
      runInBackground: undefined,
      isClaudeLike: false,
    });

    if (decision.action === "deny") {
      return { block: true, reason: decision.reason };
    }
    if (decision.action === "ask" && ctx.hasUI) {
      const ok = await ctx.ui.confirm("Cradle", decision.reason);
      if (!ok) return { block: true, reason: "Blocked by user" };
      return undefined;
    }
    if (decision.action === "remind") {
      ctx.ui.notify?.(`Cradle: ${decision.message}`, "warning");
      return undefined;
    }
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    const cfg = getConfig(ctx);
    if (!cfg) return undefined;

    if (event.toolName === "bash") {
      const decision = evaluatePostBash({
        projectRoot: cfg.root,
        cfg,
        command: String((event.input as { command?: string }).command ?? ""),
        toolResponse: event.content,
      });
      if (decision?.action === "block") {
        return { content: [...(event.content ?? []), { type: "text", text: `\n\n[Cradle block] ${decision.reason}` }] };
      }
      if (decision?.action === "remind") {
        return { content: [...(event.content ?? []), { type: "text", text: `\n\n[Cradle reminder] ${decision.message}` }] };
      }
      return undefined;
    }

    if (event.toolName === "edit" || event.toolName === "write") {
      const decision = evaluatePostEdit({
        projectRoot: cfg.root,
        cfg,
        toolName: event.toolName,
        toolInput: event.input as Record<string, unknown>,
        basePath: cfg.root,
      });
      if (decision?.action === "remind") {
        return { content: [...(event.content ?? []), { type: "text", text: `\n\n[Cradle reminder] ${decision.message}` }] };
      }
      return undefined;
    }

    return undefined;
  });

  pi.on("agent_end", async (_event, ctx) => {
    const cfg = getConfig(ctx);
    if (!cfg) return;
    if (!stopCheckArmed) return;
    stopCheckArmed = false;
    const decision = evaluateStopCheck({ projectRoot: cfg.root, cfg });
    if (decision?.action === "block") {
      ctx.ui.notify?.(`Cradle: ${decision.reason}`, "error");
      pi.sendUserMessage(`作業ツリーに unslop 違反（error）が残っています。止まる前に直してください。`, { deliverAs: "followUp" });
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    stopCheckArmed = true;
    const cfg = getConfig(ctx);
    if (cfg) {
      ctx.ui.notify?.(`Cradle harness active: ${cfg.project}`, "info");
    }
  });
}
