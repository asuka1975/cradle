import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const flowsFromGolden = fileURLToPath(new URL("../.apm/skills/e2e-parity/scripts/flows-from-golden.mjs", import.meta.url));
const status = fileURLToPath(new URL("../.apm/skills/cradle/scripts/status.mjs", import.meta.url));

const alice = { user: { id: 1 } };
const bob = { user: { id: 2 } };
const applied = (actor, command) => ({ actor, command, state: {}, views: { notes: [] } });
const refused = (actor, command) => ({ actor, command, domainError: "notAuthor" });
const flow = (trace) => ({ ok: { trace } });
// 台本の手: from-golden.json と同じ形（command は構成子名・actor・outcome）
const step = (n, actor, command, outcome) => ({ n, actor, command, outcome });

// 一時プロジェクト: cradle.json・golden 2 本（basic: 2 手 / other: 1 手）・e2e/。台本は各テストが置く。
// 環境変数を落とすのは、Claude Code の中で走るとプロジェクトルートが cradle 自身に解決されるため
function fixture(t, cradle = {}) {
  const root = mkdtempSync(join(tmpdir(), "cradle-e2e-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example", ...cradle }));
  mkdirSync(join(root, "lean/golden"), { recursive: true });
  mkdirSync(join(root, "e2e"), { recursive: true });
  writeFileSync(join(root, "lean/golden/basic-flow.json"), JSON.stringify(flow([
    applied(alice, { postNote: { title: "買い出し" } }),
    refused(bob, { closeNote: { note: { id: 0 } } }),
  ])));
  writeFileSync(join(root, "lean/golden/other-flow.json"), JSON.stringify(flow([applied(alice, { closeNote: { note: { id: 0 } } })])));
  const env = { ...process.env };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  const put = (rel, json) => { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), JSON.stringify(json)); };
  return { root, run, put };
}

// basic の手の列と同じ台本（actor のキーの順は違えてある）
const basicScript = { id: "hand-written", steps: [step(1, { user: { id: 1 } }, "postNote", "applied"), step(2, { user: { id: 2 } }, "closeNote", "refused")] };

test("手の列が同じ台本がある流れだけを対応と数え、対応の無い流れを手の列つきで出す", (t) => {
  const { run, put } = fixture(t);
  put("e2e/scenarios/generated/basic.json", basicScript);
  const r = run(flowsFromGolden, "--check");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /golden の流れ 2 本のうち台本が対応しているのは 1 本（台本 1 本: e2e\/scenarios）/);
  assert.match(r.stdout, /対応する台本が無い: other/);
  assert.match(r.stdout, /1\. closeNote by \{"user":\{"id":1\}\} → applied/);
  assert.doesNotMatch(r.stdout, /対応する台本が無い: basic/);
  const j = JSON.parse(run(flowsFromGolden, "--check", "--json").stdout);
  assert.deepEqual({ golden: j.golden, covered: j.covered, uncovered: j.uncovered, scripts: j.scripts }, { golden: ["basic", "other"], covered: ["basic"], uncovered: ["other"], scripts: 1 });
});

test("全部の流れに台本が対応していれば 0 で終わる。from-golden.json の flows の形も台本として読む", (t) => {
  const { run, put } = fixture(t);
  put("e2e/scenarios/from-golden.json", { flows: [basicScript, { id: "other", steps: [step(1, alice, "closeNote", "applied")] }] });
  const r = run(flowsFromGolden, "--check");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /golden の流れ 2 本のうち台本が対応しているのは 2 本/);
});

test("手の列が同じで payload だけ違う流れ 2 本に台本 1 本なら、対応は 1 本と数える", (t) => {
  const { run, put } = fixture(t);
  put("lean/golden/twin-flow.json", flow([applied(alice, { postNote: { title: "掃除" } }), refused(bob, { closeNote: { note: { id: 0 } } })]));
  put("e2e/scenarios/basic.json", basicScript);
  const j = JSON.parse(run(flowsFromGolden, "--check", "--json").stdout);
  assert.deepEqual({ covered: j.covered, uncovered: j.uncovered, scripts: j.scripts }, { covered: ["basic"], uncovered: ["other", "twin"], scripts: 1 });
});

test("payload まで書いた台本はその payload の流れにだけ対応し、手の列だけの台本は残りの流れに当たる", (t) => {
  const { run, put } = fixture(t);
  put("lean/golden/twin-flow.json", flow([applied(alice, { postNote: { title: "掃除" } }), refused(bob, { closeNote: { note: { id: 0 } } })]));
  const withPayload = (title) => ({ steps: [{ ...step(1, alice, "postNote", "applied"), payload: { title } }, { ...step(2, bob, "closeNote", "refused"), payload: { note: { id: 0 } } }] });
  put("e2e/scenarios/twin.json", withPayload("掃除"));
  const only = JSON.parse(run(flowsFromGolden, "--check", "--json").stdout);
  assert.deepEqual({ covered: only.covered, uncovered: only.uncovered }, { covered: ["twin"], uncovered: ["basic", "other"] });
  // 手の列だけの台本を足すと、payload つきの台本が先に twin に当たり、手の列だけの台本が basic に回る（置き場の並びに依らない）
  put("e2e/scenarios/a-hand.json", basicScript);
  const both = JSON.parse(run(flowsFromGolden, "--check", "--json").stdout);
  assert.deepEqual({ covered: both.covered, uncovered: both.uncovered, scripts: both.scripts }, { covered: ["basic", "twin"], uncovered: ["other"], scripts: 2 });
  // payload が golden と違う台本は対応しない
  put("e2e/scenarios/twin.json", withPayload("洗濯"));
  const wrong = JSON.parse(run(flowsFromGolden, "--check", "--json").stdout);
  assert.deepEqual({ covered: wrong.covered, uncovered: wrong.uncovered }, { covered: ["basic"], uncovered: ["other", "twin"] });
});

test("手の順・結果・当事者が違う台本は対応しない。steps の形でないファイルは台本と数えない", (t) => {
  const { run, put } = fixture(t);
  put("e2e/scenarios/reordered.json", { steps: [step(1, bob, "closeNote", "refused"), step(2, alice, "postNote", "applied")] });
  put("e2e/scenarios/wrong-outcome.json", { steps: [step(1, alice, "postNote", "applied"), step(2, bob, "closeNote", "applied")] });
  put("e2e/scenarios/wrong-actor.json", { steps: [step(1, bob, "postNote", "applied"), step(2, bob, "closeNote", "refused")] });
  put("e2e/scenarios/playwright.json", { workers: 1 });
  const j = JSON.parse(run(flowsFromGolden, "--check", "--json").stdout);
  assert.deepEqual(j.covered, []);
  assert.equal(j.scripts, 3);
});

test("置き場は引数か cradle.json の e2e.scenarios で指定でき、status の E2E フェーズも同じ数を出す", (t) => {
  const { run, put } = fixture(t, { e2e: { scenarios: "e2e/src/model/flows" } });
  put("e2e/src/model/flows/basic.json", basicScript);
  put("e2e/scenarios/from-golden.json", { flows: [] });
  const j = JSON.parse(run(flowsFromGolden, "--check", "--json").stdout);
  assert.equal(j.place, "e2e/src/model/flows");
  assert.deepEqual(j.covered, ["basic"]);
  const elsewhere = JSON.parse(run(flowsFromGolden, "--check", "--json", "e2e/scenarios").stdout);
  assert.deepEqual([elsewhere.place, elsewhere.covered], ["e2e/scenarios", []]);
  const s = JSON.parse(run(status, "--json").stdout);
  const e2e = s.phases.find(p => p.name.startsWith("E2E"));
  assert.deepEqual(e2e.facts, ["golden の流れ 2 本 / 台本が対応 1 本（e2e/src/model/flows）", "台本 1 本"]);
  assert.match(e2e.next, /flows-from-golden --check/);
});

test("golden の流れが 0 本なら status は golden を採ることを次の一手にする", (t) => {
  const { root, run } = fixture(t);
  for (const f of ["basic-flow.json", "other-flow.json"]) rmSync(join(root, "lean/golden", f));
  const e2e = JSON.parse(run(status, "--json").stdout).phases.find(p => p.name.startsWith("E2E"));
  assert.deepEqual(e2e.facts, ["golden の流れ 0 本 / 台本が対応 0 本（e2e/scenarios）", "台本 0 本"]);
  assert.match(e2e.next, /golden を採る/);
});

test("status は対応が揃えば pnpm test を次の一手にする", (t) => {
  const { run, put } = fixture(t);
  put("e2e/scenarios/from-golden.json", { flows: [basicScript, { id: "other", steps: [step(1, alice, "closeNote", "applied")] }] });
  const e2e = JSON.parse(run(status, "--json").stdout).phases.find(p => p.name.startsWith("E2E"));
  assert.deepEqual(e2e.facts, ["golden の流れ 2 本 / 台本が対応 2 本（e2e/scenarios）", "台本 2 本"]);
  assert.match(e2e.next, /pnpm test/);
});

// 外部能力の経路（cmd external）で採った golden: trace の要素は result・環境・外部能力の往復を持ち、内部入力（observation）の手に当事者は無い
const env0 = { cursor: 0, script: [] };
const external = (input, result, extra = {}) => ({ ...input, result, state: {}, views: { notes: [] }, env: env0, interactions: [], ...extra });
const authorize = { port: "PaymentGateway", operation: "authorize", request: { attempt: { id: 0 } }, outcome: "authorized" };
const payTrace = [
  external({ actor: alice, command: { startPayment: { visit: { id: 0 } } } }, "applied"),
  external({ observation: { dispatchPayment: { attempt: { id: 0 } } } }, "applied", { interactions: [authorize] }),
  external({ actor: bob, command: { startPayment: { visit: { id: 0 } } } }, "refused", { domainError: "alreadyPaying" }),
  // 障害で止まった手: 指名した名前の写し（fault）と、止まった契約（faultContract）
  external({ observation: { confirmPayment: { attempt: { id: 0 } } }, fault: "sentNoAnswer" }, "fault", { faultContract: { name: "ConfirmPaymentUseCase.sentNoAnswer", portCalls: 1 } }),
];
const payInputs = [
  { command: { startPayment: { visit: { id: 0 } } } },
  { observation: { dispatchPayment: { attempt: { id: 0 } } } },
  { command: { startPayment: { visit: { id: 0 } } }, actor: bob },
  { observation: { confirmPayment: { attempt: { id: 0 } } }, fault: "sentNoAnswer" },
];
function putExternalGolden(put) {
  put("lean/golden/pay-flow.json", { ok: { trace: payTrace, env: env0 } });
  put("lean/golden/pay-init.json", { ok: { state: {}, views: { notes: [] }, env: env0 } });
  put("lean/golden/pay.request.json", { version: 1,
    init: { cmd: "external", version: 1, action: "init", scenario: "basic", environment: "paymentAuthorized", viewer: { id: 1 } },
    flow: { cmd: "external", version: 1, action: "flow", scenario: "basic", environment: "paymentAuthorized", viewer: { id: 1 }, actor: alice, inputs: payInputs } });
}
const observation = (n, name, outcome) => ({ n, kind: "observation", observation: name, outcome });
const payCommands = [step(1, alice, "startPayment", "applied"), step(3, bob, "startPayment", "refused"), { ...observation(4, "confirmPayment", "fault") }];
// 途中で止めた流れ（stopAt）: 名前で環境を渡し、-init.json は無く、script の尾（inquire）は呼ばれていない
const inquire = { port: "PaymentGateway", operation: "inquire", request: { attempt: { id: 0 } }, outcome: "notFound" };
const stopEnv = { cursor: 1, script: [authorize, inquire] };
function putStoppedGolden(put) {
  put("lean/golden/stop-flow.json", { ok: { env: stopEnv, trace: [external({ observation: { dispatchPayment: { attempt: { id: 0 } } } }, "applied", { interactions: [authorize], env: stopEnv })] } });
  put("lean/golden/stop.request.json", { version: 1,
    init: { cmd: "external", version: 1, action: "init", scenario: "basic", environment: "paymentAuthorized" },
    flow: { cmd: "external", version: 1, action: "flow", scenario: "basic", environment: "paymentAuthorized", inputs: [payInputs[1]], stopAt: 1 } });
}

test("外部能力の流れは内部入力の手も台本に要り、kind: observation の手として同じ順に無ければ対応しない", (t) => {
  const { run, put } = fixture(t);
  putExternalGolden(put);
  // 操作の手だけの台本（内部入力を落としている）
  put("e2e/scenarios/pay.json", { steps: [payCommands[0], payCommands[1], payCommands[2]] });
  const r = run(flowsFromGolden, "--check");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /対応する台本が無い: pay（external, environment=paymentAuthorized \(script 0 件\)）/);
  assert.match(r.stdout, /2\. observation dispatchPayment → applied/);
  assert.match(r.stdout, /4\. observation confirmPayment → fault/);
  const j = JSON.parse(run(flowsFromGolden, "--check", "--json").stdout);
  assert.deepEqual(j.uncovered, ["basic", "other", "pay"]);
  const pay = j.flows.find(f => f.id === "pay");
  assert.deepEqual({ external: pay.external, environment: pay.environment }, { external: true, environment: { name: "paymentAuthorized", script: [] } });
  assert.deepEqual(pay.steps[1], { kind: "observation", observation: "dispatchPayment", actor: null, payload: { attempt: { id: 0 } }, outcome: "applied" });
  assert.deepEqual(pay.steps[3], { kind: "observation", observation: "confirmPayment", actor: null, payload: { attempt: { id: 0 } }, outcome: "fault", fault: "sentNoAnswer" });
  const basic = j.flows.find(f => f.id === "basic");
  assert.deepEqual({ external: basic.external, environment: basic.environment, kind: basic.steps[0].kind }, { external: false, environment: null, kind: "command" });
  // 内部入力を操作の手（kind command）として書いた台本は対応しない
  put("e2e/scenarios/pay.json", { steps: [payCommands[0], step(2, null, "dispatchPayment", "applied"), payCommands[1], payCommands[2]] });
  assert.deepEqual(JSON.parse(run(flowsFromGolden, "--check", "--json").stdout).covered, []);
  // kind: observation の手を同じ位置に書けば対応する（内部入力に当事者は無い）
  put("e2e/scenarios/pay.json", { steps: [payCommands[0], observation(2, "dispatchPayment", "applied"), payCommands[1], payCommands[2]] });
  const ok = JSON.parse(run(flowsFromGolden, "--check", "--json").stdout);
  assert.deepEqual({ covered: ok.covered, uncovered: ok.uncovered }, { covered: ["pay"], uncovered: ["basic", "other"] });
});

test("flows-from-golden は外部能力の流れに external・environment・interactions・fault・contract を付け、人物は操作の当事者だけ。起こした台本は --check に通る", (t) => {
  const { run, put } = fixture(t);
  putExternalGolden(put);
  putStoppedGolden(put);
  const out = JSON.parse(run(flowsFromGolden, "--json").stdout);
  const pay = out.flows.find(f => f.id === "pay");
  assert.deepEqual({ external: pay.external, environment: pay.environment, scenario: pay.scenario, personas: pay.personas }, { external: true, environment: { name: "paymentAuthorized", script: [] }, scenario: "basic", personas: [alice, bob] });
  // 環境の script は sidecar の名前ではなく CLI の応答（-init.json が無ければ -flow.json の env）から — 呼ばれなかった尾（inquire）が読める
  const stop = out.flows.find(f => f.id === "stop");
  assert.deepEqual({ external: stop.external, environment: stop.environment, personas: stop.personas }, { external: true, environment: { name: "paymentAuthorized", script: [authorize, inquire] }, personas: [] });
  assert.deepEqual(stop.steps, [{ n: 1, kind: "observation", observation: "dispatchPayment", payload: { attempt: { id: 0 } }, outcome: "applied", interactions: [authorize], observe: { notes: "0 rows" } }]);
  assert.match(run(flowsFromGolden).stdout, /# stop {2}scenario=basic viewer=null today=null external environment=paymentAuthorized \(script 2 件\)/);
  assert.deepEqual(pay.steps[1], { n: 2, kind: "observation", observation: "dispatchPayment", payload: { attempt: { id: 0 } }, outcome: "applied", interactions: [authorize], observe: { notes: "0 rows" } });
  assert.deepEqual(pay.steps[2], { n: 3, kind: "command", command: "startPayment", actor: bob, payload: { visit: { id: 0 } }, outcome: "refused", interactions: [], refusal: "alreadyPaying" });
  assert.deepEqual(pay.steps[3], { n: 4, kind: "observation", observation: "confirmPayment", payload: { attempt: { id: 0 } }, outcome: "fault", interactions: [], fault: "sentNoAnswer", contract: "ConfirmPaymentUseCase.sentNoAnswer", observe: { notes: "0 rows" } });
  const basic = out.flows.find(f => f.id === "basic");
  assert.deepEqual({ external: basic.external, environment: basic.environment, keys: Object.keys(basic.steps[0]) }, { external: false, environment: null, keys: ["n", "kind", "command", "actor", "payload", "outcome", "observe"] });
  const wrote = run(flowsFromGolden, "--out", "e2e/scenarios/from-golden.json");
  assert.equal(wrote.status, 0, wrote.stdout + wrote.stderr);
  const c = JSON.parse(run(flowsFromGolden, "--check", "--json").stdout);
  assert.deepEqual({ covered: c.covered, uncovered: c.uncovered, scripts: c.scripts }, { covered: ["basic", "other", "pay", "stop"], uncovered: [], scripts: 4 });
  assert.deepEqual(c.flows.find(f => f.id === "stop").environment, { name: "paymentAuthorized", script: [authorize, inquire] });
});
