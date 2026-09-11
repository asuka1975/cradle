import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const piExtension = (await jiti.import(fileURLToPath(new URL("../integrations/pi/index.ts", import.meta.url)))).default;

function makeCtx(root) {
  const notifications = [];
  return {
    cwd: root,
    hasUI: true,
    ui: {
      notify: (msg, type) => notifications.push({ msg, type }),
      confirm: async () => false,
    },
    sessionManager: { getSessionFile: () => "/tmp/session.jsonl", getSessionId: () => "s1" },
    _notifications: notifications,
  };
}

function makePi(root) {
  const handlers = { tool_call: [], tool_result: [], agent_end: [], session_start: [] };
  const userMessages = [];
  return {
    on: (event, handler) => handlers[event].push(handler),
    sendUserMessage: (text, opts) => userMessages.push({ text, opts }),
    _handlers: handlers,
    _userMessages: userMessages,
  };
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cradle-pi-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example" }));
  mkdirSync(join(root, "documents/ddd"), { recursive: true });
  mkdirSync(join(root, "documents/developer"), { recursive: true });
  return root;
}

test("生成物・保護領域・golden応答を tool_call でブロックする", async (t) => {
  const root = fixture(t);
  const pi = makePi(root);
  piExtension(pi);
  const ctx = makeCtx(root);
  const toolCall = pi._handlers.tool_call[0];
  for (const path of ["backend/src/generated/A.kt", "documents/developer/a.md", "lean/golden/basic-init.json"]) {
    const result = await toolCall({ toolName: "write", input: { path }, toolCallId: "t1" }, ctx);
    assert.equal(result?.block, true);
    assert.ok(result?.reason.length > 0);
  }
  const allowed = await toolCall({ toolName: "write", input: { path: "backend/src/main/A.kt" }, toolCallId: "t2" }, ctx);
  assert.equal(allowed, undefined);
});

test("ビルド成功後と編集後に tool_result へ促しを追加する", async (t) => {
  const root = fixture(t);
  const pi = makePi(root);
  piExtension(pi);
  const ctx = makeCtx(root);
  const bashResult = await pi._handlers.tool_result[0]({
    toolName: "bash",
    input: { command: "lake build" },
    content: [{ type: "text", text: "Build completed successfully" }],
    toolCallId: "t1",
  }, ctx);
  const joined = bashResult.content.map(c => c.text).join("");
  assert.match(joined, /golden-check/);

  const editResult = await pi._handlers.tool_result[0]({
    toolName: "write",
    input: { path: "documents/codebase/openapi.yaml" },
    content: [{ type: "text", text: "wrote" }],
    toolCallId: "t2",
  }, ctx);
  const editJoined = editResult.content.map(c => c.text).join("");
  assert.match(editJoined, /generateApi/);
});

test("agent_end で unslop error があると follow-up を投入する", async (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "documents/ai-notes"), { recursive: true });
  writeFileSync(join(root, "documents/ai-notes/20260910-01-bad.md"), "no header");
  const pi = makePi(root);
  piExtension(pi);
  const ctx = makeCtx(root);
  await pi._handlers.session_start[0]({}, ctx);
  await pi._handlers.agent_end[0]({}, ctx);
  assert.equal(pi._userMessages.length, 1);
  assert.match(pi._userMessages[0].text, /unslop/);
});
