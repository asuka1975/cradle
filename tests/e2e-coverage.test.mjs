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
