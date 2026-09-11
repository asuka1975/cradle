#!/usr/bin/env node
// モデル応答だけをローカル固定応答にし、OpenCode V2の実ツール・hook・結果保存を検証する。
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = realpathSync(mkdtempSync(join(tmpdir(), "cradle-opencode-tools-")));
const plan = [
  { name: "write", input: { path: "lean/Example.lean", content: "-- before\n" }, expected: /lean-check/ },
  { name: "edit", input: { path: "lean/Example.lean", oldString: "before", newString: "after" }, expected: /lean-check/ },
  { name: "write", input: { path: join(directory, "documents/codebase/openapi.yaml"), content: "openapi: 3.0.0\n" }, expected: /generateApi/ },
  { name: "shell", input: { command: "./gradlew build" }, expected: /sql-perf-review/ },
  { name: "shell", input: { command: "./gradlew clean" }, expected: null },
  { name: "shell", input: { command: "lake build" }, expected: /golden-check/ },
];
let step = 0;
let modelError;
const model = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const next = body.tools?.length ? plan[step] : null;
    let delta = { role: "assistant", content: "done" };
    let finish = "stop";
    if (next) {
      assert.ok(body.tools.some(tool => tool.function?.name === next.name), `Missing runtime tool: ${next.name}`);
      delta = { role: "assistant", tool_calls: [{ index: 0, id: `call-smoke-${step++}`, type: "function", function: { name: next.name, arguments: JSON.stringify(next.input) } }] };
      finish = "tool_calls";
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const [part, reason] of [[delta, null], [{}, finish]]) {
      res.write(`data: ${JSON.stringify({ id: "smoke", object: "chat.completion.chunk", created: 0, model: "smoke", choices: [{ index: 0, delta: part, finish_reason: reason }] })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  } catch (error) {
    modelError = error;
    res.writeHead(500).end("Fixture failed");
  }
});
let child;
let exited;
let logs = "";

try {
  await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
  const modelPort = model.address().port;
  mkdirSync(join(directory, "lean"));
  mkdirSync(join(directory, "bin"));
  mkdirSync(join(directory, "documents/codebase"), { recursive: true });
  // ビルド自体は対象外。終了メッセージを出す実行可能ファイルでhookへの配線を検証する。
  writeFileSync(join(directory, "gradlew"), '#!/bin/sh\nprintf "BUILD SUCCESSFUL\\n"\n', { mode: 0o755 });
  writeFileSync(join(directory, "bin/lake"), '#!/bin/sh\nprintf "Build completed successfully\\n"\n', { mode: 0o755 });
  writeFileSync(join(directory, "cradle.json"), JSON.stringify({ project: "Example" }));
  writeFileSync(join(directory, "opencode.json"), JSON.stringify({
    plugins: [join(root, "integrations/opencode")],
    permissions: [{ action: "edit", resource: "*", effect: "allow" }, { action: "shell", resource: "*", effect: "allow" }],
    providers: { smoke: {
      // beta-19135の内蔵provider package名。新しいSDKの名前空間とは異なる。
      package: "@opencode-ai/ai/providers/openai-compatible",
      settings: { baseURL: `http://127.0.0.1:${modelPort}/v1`, apiKey: "local-fixture" },
      models: { smoke: {} },
    } },
  }));
  child = spawn(process.env.OPENCODE_BIN ?? "opencode2", ["--print-logs", "serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: directory,
    env: { ...process.env, HOME: directory, SHELL: "/bin/sh", PATH: `${join(directory, "bin")}:${process.env.PATH}`, XDG_CONFIG_HOME: join(directory, "config"), XDG_DATA_HOME: join(directory, "data"), XDG_CACHE_HOME: join(directory, "cache"), XDG_STATE_HOME: join(directory, "state") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => { logs += chunk; });
  child.stderr.on("data", chunk => { logs += chunk; });
  let launchError;
  child.on("error", error => { launchError = error; });
  exited = new Promise(resolve => { child.once("exit", resolve); child.once("error", resolve); });
  const deadline = Date.now() + 60000;
  let base, password;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    base = logs.match(/server listening on (http[^\s]+)/)?.[1];
    password = logs.match(/server password ([^\s]+)/)?.[1];
    if (base && password) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(base && password, "OpenCode server startup timed out");
  async function api(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: body ? "POST" : "GET", signal: AbortSignal.timeout(10000),
      headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.ok(response.ok, `HTTP ${response.status} for runtime API`);
    return response.json();
  }
  const health = await api("/api/health");
  const { data: session } = await api("/api/session", { model: { providerID: "smoke", id: "smoke" } });
  await api(`/api/session/${session.id}/prompt`, { text: "Run the local fixture tools and then stop." });
  let messages;
  while (Date.now() < deadline) {
    if (modelError) throw modelError;
    messages = (await api(`/api/session/${session.id}/message`)).data;
    if (messages.some(message => message.type === "assistant" && message.finish === "stop")) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(messages?.some(message => message.type === "assistant" && message.finish === "stop"), "Tool run did not finish");
  const calls = messages.flatMap(message => message.type === "assistant" ? message.content.filter(part => part.type === "tool") : []);
  const evidence = [];
  for (const [index, item] of plan.entries()) {
    const call = calls.find(call => call.id === `call-smoke-${index}`);
    assert.ok(call, `Missing tool result ${index}`);
    assert.equal(call.state.status, "completed", `Failed tool ${item.name}`);
    const text = JSON.stringify(call.state.content);
    if (item.expected) assert.match(text, item.expected);
    else assert.doesNotMatch(text, /\[Cradle\]/);
    evidence.push({ tool: call.name, inputKeys: Object.keys(call.state.input).sort(), status: call.state.status, reminder: Boolean(item.expected) });
  }
  assert.equal(readFileSync(join(directory, "lean/Example.lean"), "utf8"), "-- after\n");
  console.log(JSON.stringify({ cli: health.version, sdk: JSON.parse(readFileSync(join(root, "integrations/opencode/package.json"))).dependencies["@opencode/plugin"], evidence }, null, 2));
} finally {
  if (child && exited) {
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
    await exited;
    clearTimeout(timer);
  }
  model.closeAllConnections();
  await new Promise(resolve => model.close(resolve));
  rmSync(directory, { recursive: true, force: true });
}
