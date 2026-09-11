import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { callHook, checkAll, reminder } from "../hook-client.mjs";
import { findProjectRoot, loadConfig } from "../../.apm/skills/cradle/scripts/lib.mjs";

export default function cradlePiExtension(pi: ExtensionAPI) {
  let skipFollowUpEnd = false;

  pi.on("session_start", (_event, ctx) => {
    skipFollowUpEnd = false;
    if (ctx.hasUI) ctx.ui.notify("Cradle harness active", "info");
  });

  pi.on("tool_call", async (event, ctx) => {
    const names = { edit: "Edit", write: "Write", bash: "Bash" };
    const tool = names[event.toolName as keyof typeof names];
    if (!tool) return;
    const result = await callHook("pre-guard", {
      cwd: ctx.cwd, tool_name: tool, tool_input: event.input,
    });
    const output = result?.hookSpecificOutput;
    if (output?.permissionDecision === "deny") {
      return { block: true, reason: output.permissionDecisionReason };
    }
    if (output?.additionalContext) {
      pi.sendMessage({ customType: "cradle-reminder", content: output.additionalContext, display: true });
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError) return;
    const mode = event.toolName === "bash" ? "post-bash"
      : ["edit", "write"].includes(event.toolName) ? "post-edit" : null;
    if (!mode) return;
    const message = reminder(await callHook(mode, {
      cwd: ctx.cwd, tool_input: event.input, tool_response: event.content,
    }));
    if (message) return { content: [...event.content, { type: "text" as const, text: `\n[Cradle] ${message}` }] };
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (skipFollowUpEnd) {
      skipFollowUpEnd = false;
      return;
    }
    let cfg;
    try { cfg = loadConfig(findProjectRoot(ctx.cwd)); }
    catch { return; } // Cradle未導入のプロジェクトは対象外。
    const reason = await checkAll(cfg.root);
    if (!reason) return;
    skipFollowUpEnd = true;
    try {
      pi.sendUserMessage(reason, { deliverAs: "followUp" });
    } catch (error) {
      skipFollowUpEnd = false;
      throw error;
    }
  });
}
