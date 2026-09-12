import { Plugin } from "@opencode/plugin";
import { callHook, reminder } from "../hook-client.mjs";

export default Plugin.define({
  id: "cradle-opencode",
  async setup(ctx) {
    await ctx.permission.hook("evaluate", async (event) => {
      if (event.effect === "deny" || !["edit", "shell"].includes(event.action)) return;
      const session = await ctx.session.get({ sessionID: event.sessionID });
      const cwd = session.location.directory;
      for (const resource of event.resources) {
        const result = await callHook("pre-guard", {
          cwd,
          tool_name: event.action === "shell" ? "Bash" : "Edit",
          tool_input: event.action === "shell" ? { command: resource } : { file_path: resource },
          agent_type: event.agent,
        });
        const output = result?.hookSpecificOutput;
        if (output?.permissionDecision === "deny") {
          event.effect = "deny";
          event.message = output.permissionDecisionReason;
          return;
        }
        if (output?.additionalContext) {
          event.effect = "ask";
          event.message = output.additionalContext;
        }
      }
    });

    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed") return;
      const mode = ["shell", "bash"].includes(event.tool) ? "post-bash"
        : ["edit", "write", "apply_patch"].includes(event.tool) ? "post-edit" : null;
      if (!mode || !event.input || typeof event.input !== "object") return;
      const input = event.input as Record<string, unknown>;
      const session = await ctx.session.get({ sessionID: event.sessionID });
      const message = reminder(await callHook(mode, {
        cwd: session.location.directory,
        tool_input: {
          ...input,
          file_path: input.filePath ?? input.path,
          command: input.patchText ?? input.command,
        },
        tool_response: event.result.content ?? event.result,
      }));
      if (message) {
        // ツール結果に追記し、モデルに返す。syntheticで別ターンを起動しない。
        const content = event.result.content;
        event.result = { ...event.result, content: typeof content === "string"
          ? `${content}\n\n[Cradle] ${message}`
          : [...(content ?? []), { type: "text", text: `[Cradle] ${message}` }] };
      }
    });
  },
});
