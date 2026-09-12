#!/usr/bin/env node
// OpenCode V2 の実プロセスで Plugin のロードと permission hook を検証する。
// 実行前に integrations/opencode で npm ci を済ませる。

import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const opencode = process.env.OPENCODE_BIN ?? "opencode2";
const plugin = join(root, "integrations", "opencode");

if (spawnSync(opencode, ["--version"], { stdio: "ignore" }).status !== 0) {
  throw new Error(`${opencode} が見つかりません`);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const port = server.address().port;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

async function waitFor(predicate, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("OpenCode V2 server の起動がタイムアウトしました");
}

async function request(base, password, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: {
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  assert.ok(response.ok, `${options.method ?? "GET"} ${path}: HTTP ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const directory = await mkdtemp(join(tmpdir(), "cradle-opencode-v2-"));
await writeFile(join(directory, "cradle.json"), JSON.stringify({ project: "Example" }));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
await writeFile(join(directory, "opencode.jsonc"), JSON.stringify({
  "$schema": "https://opencode.ai/config.json",
  plugins: [plugin],
}));

const child = spawn(opencode, ["--print-logs", "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: directory,
  env: { ...process.env, HOME: directory, XDG_CONFIG_HOME: join(directory, "config"), XDG_DATA_HOME: join(directory, "data"), XDG_CACHE_HOME: join(directory, "cache"), XDG_STATE_HOME: join(directory, "state") },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });
const exit = new Promise((resolvePromise) => child.once("exit", (code, signal) => resolvePromise({ code, signal })));

try {
  const password = await waitFor(async () => {
    const match = logs.match(/server password ([^\s]+)/);
    return match?.[1] ?? null;
  });
  const health = await request(base, password, "/api/health");
  assert.equal(health.healthy, true);
  assert.equal(health.version, (await new Promise((resolvePromise, reject) => {
    const result = spawnSync(opencode, ["--version"], { encoding: "utf8" });
    if (result.error) reject(result.error);
    else resolvePromise(result.stdout.trim().replace(/^opencode2 v?/, ""));
  })));
  const session = await request(base, password, "/api/session", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const sessionID = session.data.id;

  const golden = await request(base, password, `/api/session/${sessionID}/permission`, {
    method: "POST",
    body: JSON.stringify({ action: "edit", resources: ["lean/golden/runtime-init.json"] }),
  });
  assert.equal(golden.data.effect, "deny");

  const explorationDocument = await request(base, password, `/api/session/${sessionID}/permission`, {
    method: "POST",
    body: JSON.stringify({ action: "edit", resources: ["documents/ddd/event-timeline.md"] }),
  });
  assert.equal(explorationDocument.data.effect, "deny");

  await mkdir(join(directory, "documents", "ddd"), { recursive: true });
  await writeFile(join(directory, "documents", "ddd", ".session"), "smoke-test\n");
  const activeSession = await request(base, password, "/api/session", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const activeExplorationDocument = await request(base, password, `/api/session/${activeSession.data.id}/permission`, {
    method: "POST",
    body: JSON.stringify({ action: "edit", resources: ["documents/ddd/event-timeline.md"] }),
  });
  assert.equal(activeExplorationDocument.data.effect, "allow");

  console.log(`OpenCode V2 runtime smoke passed (${health.version})`);
} finally {
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  await exit;
  clearTimeout(timer);
  await rm(directory, { recursive: true, force: true });
}
