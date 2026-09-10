import { existsSync } from "node:fs";
import { join } from "node:path";
import { Plugin } from "@opencode/plugin";

const EXTENSION_ID = "cradle-opencode";

type ToolInput = {
  command?: unknown;
  path?: unknown;
};

export default Plugin.define({
  id: EXTENSION_ID,
  async setup(ctx) {
    const location = ctx.location.directory;

    await ctx.permission.hook("evaluate", async (event) => {
      if (event.effect === "deny") return;
      const resources = event.resources;

      for (const resource of resources) {
        if (/documents\/developer\//.test(resource) || /\/(generated|build\/generated)\//.test(resource)) {
          event.effect = "deny";
          event.message = `${resource} は Cradle の保護領域または生成物です。直接編集せず、源を直して再生成してください。`;
          return;
        }
        if (/lean\/golden\/.*-(init|flow)\.json$/.test(resource)) {
          event.effect = "deny";
          event.message = `${resource} は golden（CLI の応答そのもの）です。手で書かず、モックアップの golden 保存や golden-check --update で更新してください。`;
          return;
        }
        if (/documents\/ddd\/(event-timeline|hotspots|ubiquitous-language)\.md$/.test(resource)) {
          const sessionMarker = join(location, "documents", "ddd", ".session");
          if (!existsSync(sessionMarker)) {
            event.effect = "deny";
            event.message = `${resource} は探索の正式ドキュメントです。ddd スキルのセッション中だけ編集できます。`;
            return;
          }
        }
      }

      if (event.action === "shell") {
        const command = resources[0] ?? "";
        if (/ddd-domain-explorer/.test(command) && /ddd\.mjs\s+(start|questions|answers|end)\b|questions\.md|\.session/.test(command)) {
          event.effect = "deny";
          event.message = "探索役は ddd.mjs・questions.md・.session に触りません。";
        }
      }
    });

    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed") return;
      const input = event.input as ToolInput;

      if (event.tool === "bash") {
        const command = typeof input.command === "string" ? input.command : "";
        const content = event.result.content;
        const text = typeof content === "string" ? content : JSON.stringify(event.result);
        if (/\bgradlew\b/.test(command) && /BUILD SUCCESSFUL/.test(text)) {
          await ctx.session.synthetic({
            sessionID: event.sessionID,
            text: "[Cradle block] ビルドが成功しました。sql-perf-review と backend-design-review を実施してください。",
          });
        }
        if (/\blake build\b/.test(command) && !/BUILD FAILED|FAILURE:|error:|Error:|failed/.test(text)) {
          await ctx.session.synthetic({
            sessionID: event.sessionID,
            text: "[Cradle reminder] lake build が通りました。cradle golden-check を走らせて、変えるつもりのなかった流れが変わっていないことを確かめてください。",
          });
        }
      }

      if (event.tool === "edit" || event.tool === "write") {
        const path = typeof input.path === "string" ? input.path : "";
        if (path.endsWith("openapi.yaml")) {
          await ctx.session.synthetic({
            sessionID: event.sessionID,
            text: "[Cradle reminder] 契約を変えました。backend は generateApi、frontend は gen:api で生成し直し、写し漏れをコンパイルエラーで出すことを確認してください。",
          });
        }
        if (path.startsWith("lean/") && path.endsWith(".lean")) {
          await ctx.session.synthetic({
            sessionID: event.sessionID,
            text: "[Cradle reminder] Lean を変えました。cd lean && lake build → cradle lean-check → cradle golden-check の順に確かめてください。",
          });
        }
      }
    });
  },
});
