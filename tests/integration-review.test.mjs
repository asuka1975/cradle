import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createJiti } from "jiti";
import { callHook } from "../integrations/hook-client.mjs";

const jiti = createJiti(import.meta.url);
const piExtension = (await jiti.import("../integrations/pi/index.ts")).default;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cradle-review-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example" }));
  mkdirSync(join(root, "lean"));
  return root;
}
function setup(root) {
  const events = {};
  const messages = [];
  piExtension({ on: (name, fn) => { events[name] = fn; }, sendUserMessage: text => messages.push(text) });
  return { events, messages, ctx: { cwd: root, hasUI: false } };
}

test("Piはサブディレクトリの相対パスをcwd基準でガードする", async t => {
  const root = fixture(t);
  const { events, ctx } = setup(join(root, "lean"));
  const denied = await events.tool_call({ toolName: "write", input: { path: "golden/basic-init.json" } }, ctx);
  assert.equal(denied.block, true);
  const edit = await events.tool_result({ toolName: "edit", input: { path: "Example.lean" }, content: [] }, ctx);
  assert.match(edit.content[0].text, /lean-check/);
  assert.equal(await events.tool_call({ toolName: "read", input: { path: "golden/basic-init.json" } }, ctx), undefined);
});

test("Piはfollow-upの終了だけを飛ばし、次の通常ターンを検査する", async t => {
  const root = fixture(t);
  mkdirSync(join(root, "documents/ai-notes"), { recursive: true });
  writeFileSync(join(root, "documents/ai-notes/20260910-01-bad.md"), "no header");
  const { events, messages, ctx } = setup(root);
  await events.session_start({}, ctx);
  await events.agent_end({}, ctx);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /documents\/ai-notes\/.*:1 \[ai-note-header\]/);
  assert.match(messages[0], /--all/);
  await events.agent_end({}, ctx);
  assert.equal(messages.length, 1);
  await events.agent_end({}, ctx);
  assert.equal(messages.length, 2);
  await events.session_start({}, ctx);
  await events.agent_end({}, ctx);
  assert.equal(messages.length, 3);
});

test("Piは失敗したtool_resultに成功の促しを付けない", async t => {
  const { events, ctx } = setup(fixture(t));
  assert.equal(await events.tool_result({ toolName: "bash", input: { command: "lake build" }, content: [], isError: true }, ctx), undefined);
});

test("hook委譲は設定された保護領域を利用し、不明な設定を固定パスで補わない", async t => {
  const root = fixture(t);
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example", protected: ["owners/**"], lean: { golden: "snapshots" } }));
  for (const path of ["owners/a.md", "snapshots/basic-init.json"]) {
    const result = await callHook("pre-guard", { cwd: root, tool_name: "Edit", tool_input: { path } });
    assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  }
  assert.equal(await callHook("pre-guard", { cwd: root, tool_name: "Edit", tool_input: { path: "documents/developer/a.md" } }), null);
});

test("doctorはjsonとjsoncのpluginパスを認識する", t => {
  const root = fixture(t);
  const script = new URL("../.apm/skills/cradle/scripts/cradle.mjs", import.meta.url);
  for (const file of ["opencode.json", "opencode.jsonc"]) {
    writeFileSync(join(root, file), JSON.stringify({ plugins: ["./apm_modules/owner/cradle/integrations/opencode"] }));
    const result = spawnSync("node", [script.pathname, "doctor"], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /ok\s+opencode/);
    rmSync(join(root, file));
  }
});

test("生成エージェントはPiのツール名を使い、レビュアーの編集権限を広げない", () => {
  const pi = readFileSync(new URL("../integrations/pi/agents/frontend-ux-reviewer.md", import.meta.url), "utf8");
  assert.match(pi, /tools: bash, read, grep, find, ls/);
  assert.doesNotMatch(pi.split("---")[1], /mcp__|glob|model:/);
  for (const name of ["backend-design-reviewer", "sql-performance-reviewer", "unslop-reviewer"]) {
    const agent = readFileSync(new URL(`../integrations/opencode/agents/${name}.md`, import.meta.url), "utf8");
    assert.match(agent, /action: edit\n\s+resource: "\*"\n\s+effect: deny/);
    assert.doesNotMatch(agent.split("---")[1], /tools:|model:/);
  }
});
