// 読めない golden（壊れた -flow.json / -init.json と、JSON としては読めても形の違う -flow.json）: status は E2E のフェーズにそれを出して後のフェーズも出し、
// flows-from-golden は既定の出力でも --check（門）でもファイル名つきの 1 行で 1 で終わる。
// golden-check は形の違う golden（ok がオブジェクトでない・ok.trace / ok.env.script が配列でない・手がオブジェクトでない）と sidecar
// （init / flow のリクエストが無い・オブジェクトでない、external の flow.inputs が配列でない・手がオブジェクトでない）をファイル名つきの error の行にして再生せず、
// 残りの golden の行も出す（--manifest でも、golden-check を呼ぶ regen-impact でも stack trace にしない）。
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree, commitAll } from "./helpers.mjs";
import { loadConfig, goldenFlows } from "../.apm/skills/cradle/scripts/lib.mjs";

const status = fileURLToPath(new URL("../.apm/skills/cradle/scripts/status.mjs", import.meta.url));
const flowsFromGolden = fileURLToPath(new URL("../.apm/skills/e2e-parity/scripts/flows-from-golden.mjs", import.meta.url));

const alice = { user: { id: 1 } };
const flow = JSON.stringify({ ok: { trace: [{ actor: alice, command: { postNote: { title: "a" } }, state: {}, views: { notes: [] } }] } });
const init = JSON.stringify({ ok: { state: {}, views: { notes: [] } } });
// 旧経路の sidecar（isExternalGolden が応答を読まずに経路を決める）
const sidecar = JSON.stringify({ version: 1, init: { cmd: "init", scenario: "basic" }, flow: { cmd: "flow", scenario: "basic" } });
// 対応の取れた台本（壊れた golden の他は門を通る）
const script = JSON.stringify({ id: "ok", steps: [{ n: 1, actor: alice, command: "postNote", outcome: "applied" }] });

function fixture(t, golden) {
  const root = tempProject(t, "cradle-golden-malformed-");
  writeTree(root, { "lean/golden/ok-flow.json": flow, "lean/golden/ok-init.json": init, "e2e/scenarios/ok.json": script, ...Object.fromEntries(Object.entries(golden).map(([f, text]) => [`lean/golden/${f}`, text])) });
  const run = (script, ...args) => runNode(script, args, { cwd: root, env: cleanEnv() });
  return { root, run };
}

const brokenFlow = { "a-flow.json": "{bad" };
const brokenInit = { "a-flow.json": flow, "a-init.json": "{\"ok\":" };

// 1 行で止まる: `cradle: <ファイル> を JSON として読めない: …`。stack trace を出さない
function assertOneLine(r, file) {
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, new RegExp(`^cradle: ${file} を JSON として読めない: .+\\n$`));
  assert.doesNotMatch(r.stderr, /\n\s+at /);
}

test("goldenFlows は読めない -flow.json と -init.json をファイル名つきで投げる", (t) => {
  for (const [golden, file] of [[brokenFlow, "a-flow.json"], [brokenInit, "a-init.json"], [{ ...brokenInit, "a.request.json": sidecar }, "a-init.json"]]) {
    const { root } = fixture(t, golden);
    assert.throws(() => goldenFlows(loadConfig(root, {})), new RegExp(`^Error: ${file} を JSON として読めない: `));
  }
});

for (const [label, golden, file] of [["-flow.json", brokenFlow, "a-flow.json"], ["-init.json", brokenInit, "a-init.json"]]) {
  test(`status は読めない ${label} を E2E のフェーズの事実にし、golden-check を次の一手にして本番投入まで出す`, (t) => {
    const { run } = fixture(t, golden);
    const r = run(status, "--json");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    const phases = JSON.parse(r.stdout).phases;
    const e2e = phases.find(p => p.name.startsWith("E2E"));
    assert.equal(e2e.state, "着手済");
    assert.equal(e2e.facts.length, 1);
    assert.match(e2e.facts[0], new RegExp(`^golden を読めない: ${file} を JSON として読めない: `));
    assert.equal(e2e.next, "cradle golden-check で壊れた golden を確かめる");
    assert.equal(phases.at(-1).name, "本番投入");
    const text = run(status);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /→ 次: cradle golden-check で壊れた golden を確かめる\n\n## 本番投入/);
  });

  test(`flows-from-golden --check は読めない ${label} を飛ばさず、ファイル名つきの 1 行で 1 で終わる`, (t) => {
    const { run } = fixture(t, golden);
    assertOneLine(run(flowsFromGolden, "--check"), file);
    assertOneLine(run(flowsFromGolden, "--check", "--json"), file);
  });
}

test("flows-from-golden の既定の出力も、読めない -flow.json と -init.json（sidecar の有無に依らず）をファイル名つきの 1 行で止める", (t) => {
  for (const [golden, file] of [[brokenFlow, "a-flow.json"], [brokenInit, "a-init.json"], [{ ...brokenInit, "a.request.json": sidecar }, "a-init.json"]]) {
    const { run } = fixture(t, golden);
    assertOneLine(run(flowsFromGolden), file);
    assertOneLine(run(flowsFromGolden, "--json"), file);
  }
});

test("壊れた golden が無ければ flows-from-golden --check は対応の取れた流れで 0 で終わる", (t) => {
  const { run } = fixture(t, {});
  const r = run(flowsFromGolden, "--check");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /golden の流れ 1 本のうち台本が対応しているのは 1 本/);
});

// JSON としては読めても golden の流れの応答の形ではない -flow.json: 名前の無い TypeError や偽の手にせず、ファイル名と崩れた所を言う（文の頭）
const wrongShapes = [
  ["null", "a-flow.json が golden の応答"],
  ["5", "a-flow.json が golden の応答"],
  ["[1]", "a-flow.json が golden の応答"],
  [JSON.stringify({ ok: { trace: 5 } }), "a-flow.json の ok.trace が配列ではない"],
  [JSON.stringify({ ok: { trace: [null] } }), "a-flow.json の ok.trace の 1 手目がオブジェクトではない"],
  [JSON.stringify({ ok: { trace: [{ actor: alice, command: { postNote: { title: "a" } } }, 5] } }), "a-flow.json の ok.trace の 2 手目がオブジェクトではない"],
  [JSON.stringify({ ok: { trace: [[1]] } }), "a-flow.json の ok.trace の 1 手目がオブジェクトではない"],
];

// 1 行で止まる: `cradle: <head>…`。stack trace を出さない
function assertShapeLine(r, head, label) {
  assert.equal(r.status, 1, label + "\n" + r.stdout + r.stderr);
  assert.ok(r.stderr.startsWith(`cradle: ${head}`), label + "\n" + r.stderr);
  assert.match(r.stderr, /^[^\n]+\n$/, label);
}

test("goldenFlows は形の違う -flow.json（オブジェクトでない・ok.trace が配列でない・手がオブジェクトでない）をファイル名つきで投げる", (t) => {
  for (const [text, head] of wrongShapes) {
    const { root } = fixture(t, { "a-flow.json": text });
    assert.throws(() => goldenFlows(loadConfig(root, {})), (e) => e.message.startsWith(head), text);
  }
});

test("goldenFlows は error の応答と trace の無い ok の応答を 0 手の流れとして受ける", (t) => {
  for (const text of [JSON.stringify({ error: "x" }), JSON.stringify({ ok: {} })]) {
    const { root } = fixture(t, { "a-flow.json": text });
    assert.deepEqual(goldenFlows(loadConfig(root, {})).map(f => [f.id, f.steps.length]), [["a", 0], ["ok", 1]], text);
  }
});

test("status は形の違う -flow.json をファイル名つきの E2E の事実にし、golden-check を次の一手にして本番投入まで出す", (t) => {
  for (const [text, head] of wrongShapes) {
    const { run } = fixture(t, { "a-flow.json": text });
    const r = run(status, "--json");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    const phases = JSON.parse(r.stdout).phases;
    const e2e = phases.find(p => p.name.startsWith("E2E"));
    assert.equal(e2e.facts.length, 1, text);
    assert.ok(e2e.facts[0].startsWith(`golden を読めない: ${head}`), `${text}\n${e2e.facts[0]}`);
    assert.equal(e2e.next, "cradle golden-check で壊れた golden を確かめる");
    assert.equal(phases.at(-1).name, "本番投入");
  }
});

test("flows-from-golden は形の違う -flow.json を既定の出力でも --check でもファイル名つきの 1 行で止める", (t) => {
  for (const [text, head] of wrongShapes) {
    const { run } = fixture(t, { "a-flow.json": text });
    for (const args of [[], ["--json"], ["--check"], ["--check", "--json"]]) assertShapeLine(run(flowsFromGolden, ...args), head, `${text} ${args.join(" ")}`);
  }
});

// golden-check: ok.trace の形が違う -flow.json は、status の事実と同じ理由（ファイル名つき）の error の行にして再生しない。
// 投げると stack trace だけで行が出ず、検査できる残りの golden（ok は sidecar が無いので skipped）の行も出ない
const goldenCheck = fileURLToPath(new URL("../.apm/skills/cradle/scripts/golden-check.mjs", import.meta.url));
const regenImpact = fileURLToPath(new URL("../.apm/skills/cradle/scripts/regen-impact.mjs", import.meta.url));
const okSkipped = { name: "ok", status: "skipped", reason: "ok.request.json が無い（再生できない golden）— モックアップで採り直すか --manifest で補う" };
const traceShapes = [
  [{ ok: { trace: 5 } }, "a-flow.json の ok.trace が配列ではない"],
  [{ ok: { trace: "abc" } }, "a-flow.json の ok.trace が配列ではない"],
  [{ ok: { trace: {} } }, "a-flow.json の ok.trace が配列ではない"],
  [{ ok: { trace: [null] } }, "a-flow.json の ok.trace の 1 手目がオブジェクトではない"],
];

test("golden-check は ok.trace が配列でない・手がオブジェクトでない -flow.json をファイル名つきの error の行にし、stack trace を出さずに残りの golden も出す", (t) => {
  for (const [shape, reason] of traceShapes) {
    const label = JSON.stringify(shape);
    const { run } = fixture(t, { "a-flow.json": JSON.stringify(shape), "a-init.json": init, "a.request.json": sidecar });
    const json = run(goldenCheck, "--json", "--build", "never");
    assert.equal(json.status, 1, label + "\n" + json.stderr);
    assert.equal(json.stderr, "", label);
    assert.deepEqual(JSON.parse(json.stdout), { failed: 1, report: [{ name: "a", kind: "flow", status: "error", reason }, okSkipped] }, label);
    const text = run(goldenCheck, "--build", "never");
    assert.equal(text.status, 1, label + "\n" + text.stderr);
    assert.equal(text.stderr, "", label);
    assert.ok(text.stdout.startsWith(`error    a-flow: ${reason}\nskipped  ok: ${okSkipped.reason}\n\n0 ok, 1 changed/error, 1 skipped\n`), label + "\n" + text.stdout);
  }
});

// ok がオブジェクトでない -init.json / -flow.json と ok.env.script が配列でない -init.json も同じ: ファイル名つきの error の行にして再生しない。
// flow の {"ok":null} は external の sidecar で障害契約の照合まで進むので、その sidecar で確かめる
const externalSidecar = JSON.stringify({ version: 1, init: { cmd: "external", version: 1, action: "init", scenario: "basic" }, flow: { cmd: "external", version: 1, action: "flow", scenario: "basic", inputs: [] } });
const okShapes = [
  [{ "a-init.json": JSON.stringify({ ok: null }), "a-flow.json": flow, "a.request.json": sidecar }, "init", "a-init.json の ok がオブジェクトではない"],
  [{ "a-init.json": JSON.stringify({ ok: null }), "a-flow.json": flow, "a.request.json": externalSidecar }, "init", "a-init.json の ok がオブジェクトではない"],
  [{ "a-init.json": JSON.stringify({ ok: 5 }), "a-flow.json": flow, "a.request.json": sidecar }, "init", "a-init.json の ok がオブジェクトではない"],
  [{ "a-init.json": JSON.stringify({ ok: { env: { script: 5 } } }), "a-flow.json": flow, "a.request.json": externalSidecar }, "init", "a-init.json の ok.env.script が配列ではない"],
  [{ "a-init.json": JSON.stringify({ ok: { env: { script: "abc" } } }), "a-flow.json": flow, "a.request.json": externalSidecar }, "init", "a-init.json の ok.env.script が配列ではない"],
  [{ "a-init.json": init, "a-flow.json": JSON.stringify({ ok: null }), "a.request.json": externalSidecar }, "flow", "a-flow.json の ok がオブジェクトではない"],
  [{ "a-init.json": init, "a-flow.json": JSON.stringify({ ok: [] }), "a.request.json": externalSidecar }, "flow", "a-flow.json の ok がオブジェクトではない"],
];

test("golden-check は ok がオブジェクトでない・ok.env.script が配列でない golden をファイル名つきの error の行にし、stack trace を出さずに残りの golden も出す", (t) => {
  for (const [golden, kind, reason] of okShapes) {
    const label = JSON.stringify(golden);
    const { run } = fixture(t, golden);
    const json = run(goldenCheck, "--json", "--build", "never");
    assert.equal(json.status, 1, label + "\n" + json.stderr);
    assert.equal(json.stderr, "", label);
    assert.deepEqual(JSON.parse(json.stdout), { failed: 1, report: [{ name: "a", kind, status: "error", reason }, okSkipped] }, label);
    const text = run(goldenCheck, "--build", "never");
    assert.equal(text.status, 1, label + "\n" + text.stderr);
    assert.equal(text.stderr, "", label);
    assert.ok(text.stdout.startsWith(`error    a-${kind}: ${reason}\nskipped  ok: ${okSkipped.reason}\n\n0 ok, 1 changed/error, 1 skipped\n`), label + "\n" + text.stdout);
  }
});

// ok.env.script が null の -init.json は外部能力の往復の無い応答で、形の error にせず再生へ進む（Lean CLI が無いので init / flow とも CLI の error）
test("golden-check は ok.env.script が null の -init.json を形の error にせず再生する", (t) => {
  const { run } = fixture(t, { "a-init.json": JSON.stringify({ ok: { env: { script: null } } }), "a-flow.json": flow, "a.request.json": sidecar });
  const { report } = JSON.parse(run(goldenCheck, "--json", "--build", "never").stdout);
  assert.deepEqual(report.map(r => [r.name, r.kind, r.status, r.reason?.startsWith("Lean CLI がありません")]),
    [["a", "init", "error", true], ["a", "flow", "error", true], ["ok", undefined, "skipped", false]], JSON.stringify(report));
});

// external の sidecar の flow.inputs が配列でない・手がオブジェクトでない: 障害契約の照合と連鎖で TypeError にせず、sidecar のファイル名つきの error の行にして再生しない
const externalSidecarWith = (inputs) => JSON.stringify({ ...JSON.parse(externalSidecar), flow: { ...JSON.parse(externalSidecar).flow, inputs } });
const inputShapes = [
  [5, "a.request.json の flow.inputs が配列ではない"],
  [{}, "a.request.json の flow.inputs が配列ではない"],
  [{ 0: { command: { postNote: { title: "a" } } } }, "a.request.json の flow.inputs が配列ではない"],
  ["ab", "a.request.json の flow.inputs が配列ではない"],
  [[5], "a.request.json の flow.inputs の 1 手目がオブジェクトではない"],
  [[{ command: { postNote: { title: "a" } } }, null], "a.request.json の flow.inputs の 2 手目がオブジェクトではない"],
  [[[1]], "a.request.json の flow.inputs の 1 手目がオブジェクトではない"],
];

test("golden-check は external の sidecar の flow.inputs が配列でない・手がオブジェクトでない golden をファイル名つきの error の行にし、stack trace を出さずに残りの golden も出す", (t) => {
  for (const [inputs, reason] of inputShapes) {
    const label = JSON.stringify(inputs);
    const { run } = fixture(t, { "a-init.json": init, "a-flow.json": flow, "a.request.json": externalSidecarWith(inputs) });
    const json = run(goldenCheck, "--json", "--build", "never");
    assert.equal(json.status, 1, label + "\n" + json.stderr);
    assert.equal(json.stderr, "", label);
    assert.deepEqual(JSON.parse(json.stdout), { failed: 1, report: [{ name: "a", status: "error", reason }, okSkipped] }, label);
    const text = run(goldenCheck, "--build", "never");
    assert.equal(text.status, 1, label + "\n" + text.stderr);
    assert.equal(text.stderr, "", label);
    assert.ok(text.stdout.startsWith(`error    a: ${reason}\nskipped  ok: ${okSkipped.reason}\n\n0 ok, 1 changed/error, 1 skipped\n`), label + "\n" + text.stdout);
  }
});

// inputs が null（無いのと同じ 0 手）は形の error にせず再生へ進む（Lean CLI が無いので init / flow とも CLI の error）
test("golden-check は external の sidecar の flow.inputs が null でも形の error にせず再生する", (t) => {
  const { run } = fixture(t, { "a-init.json": init, "a-flow.json": flow, "a.request.json": externalSidecarWith(null) });
  const { report } = JSON.parse(run(goldenCheck, "--json", "--build", "never").stdout);
  assert.deepEqual(report.map(r => [r.name, r.kind, r.status, r.reason?.startsWith("Lean CLI がありません")]),
    [["a", "init", "error", true], ["a", "flow", "error", true], ["ok", undefined, "skipped", false]], JSON.stringify(report));
});

test("regen-impact は external の sidecar の flow.inputs が配列でない golden を golden-check の error の行で golden 回帰に出し、stack trace を載せない", (t) => {
  const { root, run } = fixture(t, { "a-init.json": init, "a-flow.json": flow, "a.request.json": externalSidecarWith({}) });
  commitAll(root);
  const r = run(regenImpact, "--no-regen");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.ok(r.stdout.endsWith(`\ngolden 回帰: 1 件が changed/error（意図した変更か確かめる）\n  error    a: a.request.json の flow.inputs が配列ではない\n  skipped  ok: ${okSkipped.reason}\n`), r.stdout);
});

// sidecar の init / flow のリクエストが無い・オブジェクトでない: その片方を黙って飛ばさず（保存した応答を見ないまま通さず）、文字列を JSON の文として CLI に渡さず、
// ファイル名つきの error の行にする。もう片方は再生する（Lean CLI が無いので CLI の error）
const requestShapes = [
  [{ version: 1, init: { cmd: "init", scenario: "basic" } }, "flow", "a.request.json に flow のリクエストが無い"],
  [{ version: 1, init: { cmd: "init", scenario: "basic" }, flow: null }, "flow", "a.request.json に flow のリクエストが無い"],
  [{ version: 1, init: { cmd: "init", scenario: "basic" }, flow: 5 }, "flow", "a.request.json の flow がオブジェクトではない"],
  [{ version: 1, init: { cmd: "init", scenario: "basic" }, flow: [] }, "flow", "a.request.json の flow がオブジェクトではない"],
  [{ init: { cmd: "init", scenario: "basic" }, flow: "{\"cmd\":\"flow\",\"scenario\":\"basic\"}" }, "flow", "a.request.json の flow がオブジェクトではない"],
  [{ version: 1, flow: { cmd: "flow", scenario: "basic" } }, "init", "a.request.json に init のリクエストが無い"],
  [{ version: 1, init: "abc", flow: { cmd: "flow", scenario: "basic" } }, "init", "a.request.json の init がオブジェクトではない"],
  [{ ...JSON.parse(externalSidecar), flow: undefined }, "flow", "a.request.json に flow のリクエストが無い"],
];

test("golden-check は sidecar の init / flow のリクエストが無い・オブジェクトでない golden の片方をファイル名つきの error の行にし、もう片方は再生する", (t) => {
  for (const [request, kind, reason] of requestShapes) {
    const label = JSON.stringify(request);
    const { run } = fixture(t, { "a-init.json": init, "a-flow.json": flow, "a.request.json": JSON.stringify(request) });
    const json = run(goldenCheck, "--json", "--build", "never");
    assert.equal(json.status, 1, label + "\n" + json.stderr);
    assert.equal(json.stderr, "", label);
    const rows = { init: ["a", "init", "error", "cli"], flow: ["a", "flow", "error", "cli"], [kind]: ["a", kind, "error", reason] };
    assert.deepEqual(JSON.parse(json.stdout).report.map(r => [r.name, r.kind, r.status, r.reason?.startsWith("Lean CLI がありません") ? "cli" : r.reason]),
      [rows.init, rows.flow, ["ok", undefined, "skipped", okSkipped.reason]], label);
    const text = run(goldenCheck, "--build", "never");
    assert.equal(text.stderr, "", label);
    assert.ok(text.stdout.includes(`error    a-${kind}: ${reason}\n`), label + "\n" + text.stdout);
  }
});

test("golden-check --manifest は sidecar の無い golden の -flow.json が null でも手が null でも stack trace を出さず、error の行にする", (t) => {
  const top = { name: "a", kind: "flow", status: "error", reason: "トップレベルが {\"ok\": …} ではない（CLI の応答そのものを置く）" };
  const step = { name: "a", kind: "flow", status: "error", reason: "a-flow.json の ok.trace の 1 手目がオブジェクトではない" };
  for (const [text, row] of [["null", top], [JSON.stringify({ ok: { trace: [null] } }), step]]) {
    const { root, run } = fixture(t, { "a-flow.json": text, "a-init.json": init });
    writeTree(root, { "m.json": JSON.stringify({ a: { scenario: "basic" } }) });
    const r = run(goldenCheck, "--json", "--build", "never", "--manifest", "m.json");
    assert.equal(r.status, 1, text + "\n" + r.stderr);
    assert.equal(r.stderr, "", text);
    const { report } = JSON.parse(r.stdout);
    assert.deepEqual(report[0], row, text);
    assert.deepEqual(report.at(-1), okSkipped, text);
  }
  // 手の崩れた golden は再生しない（manifest から flow のリクエストを組まない）
  const { root, run } = fixture(t, { "a-flow.json": JSON.stringify({ ok: { trace: [null] } }), "a-init.json": init });
  writeTree(root, { "m.json": JSON.stringify({ a: { scenario: "basic" } }) });
  assert.deepEqual(JSON.parse(run(goldenCheck, "--json", "--build", "never", "--manifest", "m.json").stdout).report, [step, okSkipped]);
});

test("golden-check --manifest は sidecar の無い golden の ok がオブジェクトでなくても ok.env.script が配列でなくても stack trace を出さず、error の行にして再生しない", (t) => {
  const row = (kind, reason) => ({ name: "a", kind, status: "error", reason });
  for (const [golden, expected] of [
    [{ "a-init.json": JSON.stringify({ ok: null }), "a-flow.json": flow }, row("init", "a-init.json の ok がオブジェクトではない")],
    [{ "a-init.json": JSON.stringify({ ok: { env: { script: 5 } } }), "a-flow.json": flow }, row("init", "a-init.json の ok.env.script が配列ではない")],
    [{ "a-init.json": init, "a-flow.json": JSON.stringify({ ok: null }) }, row("flow", "a-flow.json の ok がオブジェクトではない")],
  ]) {
    const label = JSON.stringify(golden);
    const { root, run } = fixture(t, golden);
    writeTree(root, { "m.json": JSON.stringify({ a: { scenario: "basic" } }) });
    const r = run(goldenCheck, "--json", "--build", "never", "--manifest", "m.json");
    assert.equal(r.status, 1, label + "\n" + r.stderr);
    assert.equal(r.stderr, "", label);
    assert.deepEqual(JSON.parse(r.stdout).report, [expected, okSkipped], label);
  }
});

test("regen-impact は ok.trace が配列でない golden を golden-check の error の行で golden 回帰に出し、stack trace を載せない", (t) => {
  const { root, run } = fixture(t, { "a-flow.json": JSON.stringify({ ok: { trace: 5 } }), "a-init.json": init, "a.request.json": sidecar });
  commitAll(root);
  const r = run(regenImpact, "--no-regen");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.ok(r.stdout.endsWith(`\ngolden 回帰: 1 件が changed/error（意図した変更か確かめる）\n  error    a-flow: a-flow.json の ok.trace が配列ではない\n  skipped  ok: ${okSkipped.reason}\n`), r.stdout);
});

test("regen-impact は ok がオブジェクトでない -init.json を golden-check の error の行で golden 回帰に出し、stack trace を載せない", (t) => {
  const { root, run } = fixture(t, { "a-flow.json": flow, "a-init.json": JSON.stringify({ ok: null }), "a.request.json": sidecar });
  commitAll(root);
  const r = run(regenImpact, "--no-regen");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.ok(r.stdout.endsWith(`\ngolden 回帰: 1 件が changed/error（意図した変更か確かめる）\n  error    a-init: a-init.json の ok がオブジェクトではない\n  skipped  ok: ${okSkipped.reason}\n`), r.stdout);
});
