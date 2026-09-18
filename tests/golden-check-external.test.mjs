import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const goldenCheck = fileURLToPath(new URL("../.apm/skills/cradle/scripts/golden-check.mjs", import.meta.url));

// 偽の Lean CLI（cradle.json の project から lean/.lake/build/bin/<project 小文字> に置く）:
// stdin のリクエストを requests.log に残し、canned.json から cmd（external なら external:<action>）で引いた応答を返す。
// 同じ鍵の応答が配列なら、この呼び出しが何度目か（requests.log の同じ鍵の行数）で選ぶ — step の連鎖に使う
const fakeCli = `#!${process.execPath}
const fs = require("fs"); const path = require("path");
const req = JSON.parse(fs.readFileSync(0, "utf8"));
const log = path.join(__dirname, "requests.log");
fs.appendFileSync(log, JSON.stringify(req) + "\\n");
const keyOf = (r) => r.cmd === "external" ? "external:" + r.action : r.cmd;
const key = keyOf(req);
const canned = JSON.parse(fs.readFileSync(path.join(__dirname, "canned.json"), "utf8"))[key];
const nth = fs.readFileSync(log, "utf8").trim().split("\\n").filter(l => keyOf(JSON.parse(l)) === key).length - 1;
const res = Array.isArray(canned) ? canned[nth] : canned;
process.stdout.write(JSON.stringify(res ?? { error: "no canned response for " + key + " #" + nth }));
`;

const alice = { user: { id: 1 } };
const env0 = { cursor: 0, script: [] };
const legacyInit = { ok: { state: { notes: [] }, views: { notes: [] } } };
const legacyFlow = { ok: { trace: [{ actor: alice, command: { postNote: { title: "買い出し" } }, state: { notes: [] }, views: { notes: [] } }] } };
const legacyRequests = { init: { cmd: "init", scenario: "basic", viewer: { id: 1 } }, flow: { cmd: "flow", scenario: "basic", viewer: { id: 1 }, actor: alice, commands: [{ postNote: { title: "買い出し" } }] } };
const externalInit = { ok: { state: { notes: [] }, views: { notes: [] }, env: env0 } };
const externalTrace = [
  { actor: alice, command: { startPayment: { visit: { id: 0 } } }, result: "applied", state: { attempts: 1 }, views: {}, env: env0, interactions: [] },
  { observation: { dispatchPayment: { attempt: { id: 0 } } }, result: "refused", domainError: "attemptNotDispatchable", state: { attempts: 1 }, views: {}, env: env0, interactions: [] },
];
const externalFlow = { ok: { env: env0, trace: externalTrace } };
const inputs = [{ command: { startPayment: { visit: { id: 0 } } } }, { observation: { dispatchPayment: { attempt: { id: 0 } } } }];
const externalRequests = {
  init: { cmd: "external", version: 1, action: "init", scenario: "basic", environment: "paymentAuthorized", viewer: { id: 1 } },
  flow: { cmd: "external", version: 1, action: "flow", scenario: "basic", environment: "paymentAuthorized", viewer: { id: 1 }, actor: alice, inputs } };
const externalSidecar = (version) => ({ version, ...externalRequests });
// step の応答は trace の要素から入力の写しを落としたもの（result / state / views / env / interactions / domainError）
const stepOf = ({ actor, command, observation, fault, ...body }) => ({ ok: body });
const chainSteps = externalTrace.map(stepOf);
// 連鎖のリクエスト: init は flow の欄から、step は直前の応答の state / env を運ぶ
const chainInit = { cmd: "external", version: 1, action: "init", scenario: "basic", environment: "paymentAuthorized", actor: alice, viewer: { id: 1 } };
const chainStep = (state, env, input) => ({ cmd: "external", version: 1, action: "step", state, env, input, actor: alice, viewer: { id: 1 } });
const chainRequests = [chainInit, chainStep(externalInit.ok.state, env0, inputs[0]), chainStep(externalTrace[0].state, env0, inputs[1])];

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cradle-golden-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example" }));
  const bin = join(root, "lean/.lake/build/bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "example"), fakeCli);
  chmodSync(join(bin, "example"), 0o755);
  mkdirSync(join(root, "lean/golden"), { recursive: true });
  const env = { ...process.env };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  const put = (rel, json) => writeFileSync(join(root, rel), JSON.stringify(json));
  const read = (rel) => readFileSync(join(root, rel), "utf8");
  const canned = (responses) => put("lean/.lake/build/bin/canned.json", responses);
  const run = (...args) => spawnSync(process.execPath, [goldenCheck, "--build", "never", ...args], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  const report = (...args) => { const r = run("--json", ...args); assert.equal(r.stderr, "", r.stderr); return { status: r.status, ...JSON.parse(r.stdout) }; };
  // 前回の呼び出し以降に CLI が受け取ったリクエスト
  const log = join(bin, "requests.log");
  const requests = () => { if (!existsSync(log)) return []; const lines = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)); rmSync(log); return lines; };
  const manifest = (m) => { put("manifest.json", m); return ["--manifest", join(root, "manifest.json")]; };
  // Lean の Port の操作モジュール（中身は見ない — 置き場だけが Port の一覧）
  const port = (name, op) => { const d = join(root, "lean/Example/Application/Port", name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, `${op}.lean`), ""); };
  const external = (sidecar = externalSidecar(1)) => { put("lean/golden/pay-init.json", externalInit); put("lean/golden/pay-flow.json", externalFlow); if (sidecar) put("lean/golden/pay.request.json", sidecar); };
  return { root, put, read, canned, run, report, requests, manifest, port, external };
}
const summary = (r) => r.report.map(x => [x.name, x.kind ?? null, x.status]);

test("sidecar の無い外部能力の golden は error で、manifest からの復元も CLI の呼び出しもしない", (t) => {
  const { put, canned, report, requests, manifest, external } = fixture(t);
  canned({ "external:init": externalInit, "external:flow": externalFlow, init: externalInit, flow: externalFlow });
  external(null);
  const r = report(...manifest({ pay: { scenario: "basic" } }));
  assert.equal(r.status, 1);
  assert.equal(r.failed, 1);
  assert.deepEqual(r.report, [{ name: "pay", status: "error", reason: "外部能力を使う golden は pay.request.json（版・環境・入力列）が無いと再生できない — モックアップで採り直す" }]);
  assert.deepEqual(requests(), []);
  // init の応答に env が無くても、trace の要素に result か env があれば external
  put("lean/golden/pay-init.json", legacyInit);
  assert.deepEqual(report(...manifest({ pay: { scenario: "basic" } })).report.map(x => x.status), ["error"]);
  put("lean/golden/pay-flow.json", { ok: { trace: [{ actor: alice, command: { startPayment: {} }, state: {}, views: {}, env: env0 }] } });
  assert.deepEqual(report(...manifest({ pay: { scenario: "basic" } })).report.map(x => x.status), ["error"]);
  assert.deepEqual(requests(), []);
});

test("sidecar の version が 1 でなければ経路に依らず error。version の無い sidecar が external のリクエストを持つのも error", (t) => {
  const { put, canned, report, requests, external } = fixture(t);
  canned({ "external:init": externalInit, "external:flow": externalFlow, init: legacyInit, flow: legacyFlow });
  external(externalSidecar(2));
  const r = report();
  assert.equal(r.failed, 1);
  assert.equal(r.report[0].status, "error");
  assert.match(r.report[0].reason, /^pay\.request\.json の version 2 は読めない（読める版: 1）/);
  put("lean/golden/basic-init.json", legacyInit);
  put("lean/golden/basic-flow.json", legacyFlow);
  put("lean/golden/basic.request.json", { version: 2, ...legacyRequests });
  const legacy = report("--name", "basic");
  assert.deepEqual(summary(legacy), [["basic", null, "error"]]);
  assert.match(legacy.report[0].reason, /basic\.request\.json の version 2 は読めない/);
  external({ ...externalRequests });
  const unversioned = report("--name", "pay");
  assert.deepEqual(summary(unversioned), [["pay", null, "error"]]);
  assert.match(unversioned.report[0].reason, /pay\.request\.json が version 無しで外部能力の経路/);
  assert.deepEqual(requests(), []);
});

test("旧経路の golden は sidecar が無ければ skipped。manifest か version の無い sidecar があれば init / flow で再生し、chain は無い", (t) => {
  const { put, canned, report, requests, manifest } = fixture(t);
  canned({ init: legacyInit, flow: legacyFlow });
  put("lean/golden/basic-init.json", legacyInit);
  put("lean/golden/basic-flow.json", legacyFlow);
  const skipped = report();
  assert.equal(skipped.status, 0);
  assert.deepEqual(summary(skipped), [["basic", null, "skipped"]]);
  assert.deepEqual(requests(), []);
  const restored = report(...manifest({ basic: { scenario: "basic", actor: alice } }));
  assert.deepEqual(summary(restored), [["basic", "init", "ok"], ["basic", "flow", "ok"]]);
  assert.deepEqual(requests(), [{ cmd: "init", scenario: "basic", actor: alice }, { cmd: "flow", scenario: "basic", actor: alice, commands: [{ actor: alice, command: { postNote: { title: "買い出し" } } }] }]);
  put("lean/golden/basic.request.json", legacyRequests);
  const replayed = report();
  assert.equal(replayed.failed, 0);
  assert.deepEqual(summary(replayed), [["basic", "init", "ok"], ["basic", "flow", "ok"]]);
  assert.deepEqual(requests(), [legacyRequests.init, legacyRequests.flow]);
});

test("sidecar の入力が障害契約を指名した手は、保存した flow の応答でも result が fault — 違えば error で CLI を呼ばない", (t) => {
  const { put, canned, report, requests, external } = fixture(t);
  canned({ "external:init": externalInit, "external:flow": externalFlow, "external:step": chainSteps });
  external({ version: 1, init: externalRequests.init, flow: { ...externalRequests.flow, inputs: [inputs[0], { ...inputs[1], fault: "sentNoAnswer" }] } });
  const r = report();
  assert.deepEqual(summary(r), [["pay", "flow", "error"]]);
  assert.match(r.report[0].reason, /^手 #2 は障害契約 sentNoAnswer を指名しているのに、保存した flow の応答の result が fault ではない（"refused"）/);
  assert.deepEqual(requests(), []);
  // 応答の手が fault で止まっていれば通る（連鎖の step の応答も同じ形）
  const faulted = { ...externalTrace[1], fault: "sentNoAnswer", result: "fault", faultContract: { name: "DispatchPaymentUseCase.sentNoAnswer", portCalls: 1 } };
  delete faulted.domainError;
  put("lean/golden/pay-flow.json", { ok: { env: env0, trace: [externalTrace[0], faulted] } });
  canned({ "external:init": externalInit, "external:flow": { ok: { env: env0, trace: [externalTrace[0], faulted] } }, "external:step": [chainSteps[0], stepOf(faulted)] });
  const ok = report();
  assert.equal(ok.status, 0, JSON.stringify(ok.report));
  assert.deepEqual(summary(ok), [["pay", "init", "ok"], ["pay", "flow", "ok"], ["pay", "chain", "ok"]]);
});

test("version 1 の sidecar が cmd init を持てば旧経路の golden として再生する（external ではない）", (t) => {
  const { put, canned, report, requests } = fixture(t);
  canned({ init: legacyInit, flow: legacyFlow });
  put("lean/golden/basic-init.json", legacyInit);
  put("lean/golden/basic-flow.json", legacyFlow);
  put("lean/golden/basic.request.json", { version: 1, ...legacyRequests });
  const r = report();
  assert.equal(r.status, 0, JSON.stringify(r.report));
  assert.deepEqual(summary(r), [["basic", "init", "ok"], ["basic", "flow", "ok"]]);
  assert.deepEqual(requests(), [legacyRequests.init, legacyRequests.flow]);
});

test("外部能力の golden は sidecar のリクエストを送り、応答が一致すれば ok。続けて flow を init + step の連鎖で打ち直す（chain）", (t) => {
  const { canned, report, requests, run, external } = fixture(t);
  canned({ "external:init": externalInit, "external:flow": externalFlow, "external:step": chainSteps });
  external();
  const r = report();
  assert.equal(r.status, 0, JSON.stringify(r.report));
  assert.deepEqual(r.report, [{ name: "pay", kind: "init", status: "ok" }, { name: "pay", kind: "flow", status: "ok" }, { name: "pay", kind: "chain", status: "ok" }]);
  assert.deepEqual(requests(), [externalRequests.init, externalRequests.flow, ...chainRequests]);
  assert.match(run().stdout, /ok       pay-chain\n/);
});

test("連鎖の手の応答が flow の trace と食い違えば chain が changed で、食い違った手と入力を出す。--update でも何も書かない", (t) => {
  const { canned, report, run, read, requests, external } = fixture(t);
  external();
  const before = [read("lean/golden/pay-init.json"), read("lean/golden/pay-flow.json")];
  canned({ "external:init": externalInit, "external:flow": externalFlow, "external:step": [chainSteps[0], { ok: { ...chainSteps[1].ok, state: { attempts: 2 } } }] });
  const r = report("--update");
  assert.equal(r.failed, 1);
  const chain = r.report.find(x => x.kind === "chain");
  assert.deepEqual({ status: chain.status, step: chain.step, command: chain.command, inputKind: chain.inputKind, firstDivergence: chain.firstDivergence },
    { status: "changed", step: 2, command: "dispatchPayment", inputKind: "observation", firstDivergence: "/ok/trace/1/state/attempts" });
  assert.deepEqual(chain.diffs, [{ path: "/ok/trace/1/state/attempts", expected: 1, actual: 2 }]);
  assert.deepEqual([read("lean/golden/pay-init.json"), read("lean/golden/pay-flow.json")], before);
  assert.deepEqual(requests(), [externalRequests.init, externalRequests.flow, ...chainRequests]);
  assert.match(run().stdout, /CHANGED  pay-chain: first divergence at \/ok\/trace\/1\/state\/attempts \(step #2 observation dispatchPayment\)/);
  requests();
  // 手がハーネスの失敗で止まるのも連鎖の食い違い
  canned({ "external:init": externalInit, "external:flow": externalFlow, "external:step": [chainSteps[0], { harnessError: { step: null, message: "script exhausted" } }] });
  const harness = report().report.find(x => x.kind === "chain");
  assert.deepEqual({ status: harness.status, step: harness.step, actual: harness.diffs[0].actual }, { status: "changed", step: 2, actual: { harnessError: { step: null, message: "script exhausted" } } });
  requests();
  // 連鎖の最後の env が flow の応答の env と違うのも食い違い（手は無い）— 手ごとの env は一致するので、flow の応答自身が不整合なとき
  requests();
  canned({ "external:init": externalInit, "external:flow": { ok: { env: { cursor: 1, script: [] }, trace: externalTrace } }, "external:step": chainSteps });
  const tail = report().report.find(x => x.kind === "chain");
  assert.deepEqual({ status: tail.status, step: tail.step, firstDivergence: tail.firstDivergence }, { status: "changed", step: undefined, firstDivergence: "/ok/env/cursor" });
});

test("応答のトップが ok でなければ（error / harnessError）--update でも書かず error。flow が ok でなければ chain も打たない", (t) => {
  const { put, canned, report, read, requests, external } = fixture(t);
  external();
  const flowBefore = read("lean/golden/pay-flow.json");
  canned({ "external:init": externalInit, "external:flow": { harnessError: { step: 2, message: "unexpected port call" } }, "external:step": chainSteps });
  const r = report("--update");
  assert.equal(r.failed, 1);
  assert.deepEqual(summary(r), [["pay", "init", "ok"], ["pay", "flow", "error"]]);
  assert.match(r.report[1].reason, /トップが ok ではない: \{"harnessError"/);
  assert.equal(read("lean/golden/pay-flow.json"), flowBefore);
  assert.deepEqual(requests(), [externalRequests.init, externalRequests.flow]);
  put("lean/golden/basic-init.json", legacyInit);
  put("lean/golden/basic-flow.json", legacyFlow);
  put("lean/golden/basic.request.json", legacyRequests);
  canned({ init: { error: "unknown scenario" }, flow: legacyFlow });
  const legacy = report("--name", "basic", "--update");
  assert.deepEqual(summary(legacy), [["basic", "init", "error"], ["basic", "flow", "ok"]]);
  assert.equal(read("lean/golden/basic-init.json"), JSON.stringify(legacyInit));
});

test("応答が変わっていれば最初に食い違った手を出す — 内部入力の手なら observation の名前を command に載せる", (t) => {
  const { canned, run, report, external } = fixture(t);
  const changed = { ok: { env: env0, trace: [externalTrace[0], { ...externalTrace[1], state: { attempts: 2 } }] } };
  canned({ "external:init": externalInit, "external:flow": changed, "external:step": [chainSteps[0], { ok: { ...chainSteps[1].ok, state: { attempts: 2 } } }] });
  external();
  const r = report();
  assert.equal(r.failed, 1);
  const flow = r.report.find(x => x.kind === "flow");
  assert.deepEqual({ status: flow.status, step: flow.step, command: flow.command, inputKind: flow.inputKind }, { status: "changed", step: 2, command: "dispatchPayment", inputKind: "observation" });
  assert.match(flow.firstDivergence, /^\/ok\/trace\/1\//);
  // 連鎖は保存した golden ではなく再生した flow と比べるので、こちらは ok
  assert.equal(r.report.find(x => x.kind === "chain").status, "ok");
  assert.match(run().stdout, /CHANGED  pay-flow: first divergence at \/ok\/trace\/1\/state\/attempts \(step #2 observation dispatchPayment\)/);
});

test("応答に現れる外部能力の往復 (port, operation) は Lean の Port に要る — 無ければ error で CLI を呼ばない", (t) => {
  const { put, canned, report, requests, port } = fixture(t);
  const call = (operation) => ({ port: "PaymentGateway", operation, request: { attempt: { id: 0 } }, outcome: "authorized" });
  const withCalls = (operation) => {
    const env = { cursor: 0, script: [call(operation)] };
    const trace = [{ ...externalTrace[0], env: { ...env, cursor: 1 }, interactions: [call(operation)] }];
    put("lean/golden/pay-init.json", { ok: { ...externalInit.ok, env } });
    put("lean/golden/pay-flow.json", { ok: { env: { ...env, cursor: 1 }, trace } });
    put("lean/golden/pay.request.json", { version: 1, init: externalRequests.init, flow: { ...externalRequests.flow, inputs: [inputs[0]] } });
    canned({ "external:init": { ok: { ...externalInit.ok, env } }, "external:flow": { ok: { env: { ...env, cursor: 1 }, trace } }, "external:step": trace.map(stepOf) });
  };
  withCalls("authorize");
  const missing = report();
  assert.deepEqual(summary(missing), [["pay", "init", "error"], ["pay", "flow", "error"]]);
  assert.match(missing.report[0].reason, /外部能力の往復 PaymentGateway\.authorize が Lean の Port/);
  assert.deepEqual(requests(), []);
  port("PaymentGateway", "Authorize");
  const found = report();
  assert.equal(found.status, 0, JSON.stringify(found.report));
  assert.deepEqual(summary(found), [["pay", "init", "ok"], ["pay", "flow", "ok"], ["pay", "chain", "ok"]]);
  requests();
  withCalls("refund");
  const unknown = report();
  assert.deepEqual(summary(unknown), [["pay", "init", "error"], ["pay", "flow", "error"]]);
  assert.match(unknown.report[1].reason, /PaymentGateway\.refund/);
  assert.deepEqual(requests(), []);
});
