// 読めない golden（壊れた -flow.json / -init.json）: status は E2E のフェーズにそれを出して後のフェーズも出し、
// flows-from-golden は既定の出力でも --check（門）でもファイル名つきの 1 行で 1 で終わる。
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree } from "./helpers.mjs";
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
