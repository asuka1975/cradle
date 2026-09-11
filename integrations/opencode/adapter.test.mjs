import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const plugin = (await jiti.import("./index.ts")).default;

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cradle-opencode-adapter-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({
    project: "Example", protected: ["owners/**"],
    lean: { dir: "spec", golden: "snapshots" },
    backend: { generated: ["api/output"] }, frontend: { generated: ["web/output"] },
    documents: { ddd: "domain", openapi: "api/contract.yaml" },
  }));
  mkdirSync(join(root, "spec"));
  const events = {};
  await plugin.setup({
    permission: { hook: async (name, fn) => { events[name] = fn; } },
    tool: { hook: async (name, fn) => { events[name] = fn; } },
    session: { get: async () => ({ location: { directory: join(root, "spec") } }) },
  });
  return { root, events };
}

test("OpenCodeは設定・セッションcwdを使い、readを拒否しない", async t => {
  const { events } = await fixture(t);
  for (const resource of ["../owners/a.md", "../snapshots/basic-init.json", "../api/output/a.kt", "../web/output/a.ts", "../domain/hotspots.md"]) {
    const event = { action: "edit", effect: "allow", resources: [resource] };
    await events.evaluate(event);
    assert.equal(event.effect, "deny", resource);
    assert.ok(event.message);
    const read = { ...event, action: "read", effect: "allow" };
    await events.evaluate(read);
    assert.equal(read.effect, "allow");
  }
});

test("OpenCodeはコマンド内の名前でなくevent.agentで探索役を識別する", async t => {
  const { events } = await fixture(t);
  const explorer = { action: "shell", effect: "allow", resources: ["node ddd.mjs end"], agent: "ddd-domain-explorer" };
  await events.evaluate(explorer);
  assert.equal(explorer.effect, "deny");
  const parent = { action: "shell", effect: "allow", resources: ["cat ddd-domain-explorer.agent.md questions.md"], agent: "build" };
  await events.evaluate(parent);
  assert.equal(parent.effect, "allow");
});

test("OpenCodeの編集後の促しはfilePath・絶対パス・相対パスを既存hookへ渡す", async t => {
  const { root, events } = await fixture(t);
  for (const input of [{ filePath: "Example.lean" }, { path: join(root, "spec/Example.lean") }]) {
    const event = { tool: "write", input, status: "completed", result: { content: "written" } };
    await events["execute.after"](event);
    assert.match(event.result.content, /lean-check/);
  }
  const contract = { tool: "edit", input: { filePath: "../api/contract.yaml" }, status: "completed", result: { content: [] } };
  await events["execute.after"](contract);
  assert.match(JSON.stringify(contract.result.content), /generateApi/);
});

test("OpenCodeのgradle判定はbuild/test/checkのみ、失敗時は促さない", async t => {
  const { events } = await fixture(t);
  for (const command of ["./gradlew build", "./gradlew test", "./gradlew check"]) {
    const event = { tool: "bash", input: { command }, status: "completed", result: { content: "BUILD SUCCESSFUL" } };
    await events["execute.after"](event);
    assert.match(event.result.content, /sql-perf-review/);
  }
  for (const command of ["./gradlew --version", "./gradlew clean"]) {
    const event = { tool: "bash", input: { command }, status: "completed", result: { content: "BUILD SUCCESSFUL" } };
    await events["execute.after"](event);
    assert.equal(event.result.content, "BUILD SUCCESSFUL");
  }
  const failed = { tool: "bash", input: { command: "lake build" }, status: "error", error: { message: "failed" } };
  await events["execute.after"](failed);
  assert.equal(failed.result, undefined);
});
