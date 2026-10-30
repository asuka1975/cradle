// 出発点と名前付きの環境の名前（scenarioByName / environmentByName の文字列の腕）の読み方。
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tempDir, writeTree } from "./helpers.mjs";
import { leanStringArms, scenarioNames, environmentNames } from "../.apm/skills/cradle/scripts/lib.mjs";

const scenarios = `namespace Example.Runtime
def scenarioByName : String → Option Snapshot
  | "basic" => some Scenario.basic
  -- | "legacy" => some Scenario.legacy
  | "other" => some Scenario.other
  | _ => none

def environmentByName : String → Option Environment
  | "paymentLost" => some Environment.paymentLost
  | "paymentLost" => some Environment.paymentLost
  | _ => none
end Example.Runtime
`;

test("leanStringArms は最初の def の、次の字下げの無い行までの文字列の腕を元テキストのまま読む", () => {
  assert.deepEqual(leanStringArms(scenarios, "scenarioByName"), ["basic", "legacy", "other"]);
  assert.deepEqual(leanStringArms(scenarios, "environmentByName"), ["paymentLost", "paymentLost"]);
  assert.deepEqual(leanStringArms(scenarios + "def scenarioByName : String → Option Snapshot\n  | \"late\" => some x\n", "scenarioByName"), ["basic", "legacy", "other"]);
  assert.deepEqual(leanStringArms(scenarios, "missingByName"), []);
});

test("scenarioNames は lean/ の全ファイルの scenarioByName の腕を walk の順に重ねて重複を除き、environmentNames は Runtime/Scenarios.lean だけを読む", (t) => {
  const root = tempDir(t, "cradle-lean-arms-");
  const cfg = { lean: { rootDir: join(root, "lean"), modelDir: join(root, "lean/Example") } };
  assert.deepEqual([scenarioNames(cfg), environmentNames(cfg)], [[], []]);
  writeTree(root, {
    "lean/Example/Runtime/Scenarios.lean": scenarios,
    "lean/Example/Domain/Extra.lean": "def scenarioByName : String → Option Snapshot\n  | \"other\" => some x\n  | \"extra\" => some y\n",
    "lean/Example/Domain/Env.lean": "def environmentByName : String → Option Environment\n  | \"elsewhere\" => some e\n",
  });
  assert.deepEqual(scenarioNames(cfg), ["other", "extra", "basic", "legacy"]);
  assert.deepEqual(environmentNames(cfg), ["paymentLost"]);
});
