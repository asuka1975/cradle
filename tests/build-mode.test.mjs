// spec-query・golden-check の --build は auto | always | never だけを受け、値の無い --build や綴りの違う値は auto と読み替えずに止まる。
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree } from "./helpers.mjs";
import { buildMode } from "../.apm/skills/cradle/scripts/lib.mjs";

const scripts = new URL("../.apm/skills/cradle/scripts/", import.meta.url);
const specQuery = fileURLToPath(new URL("spec-query.mjs", scripts));
const goldenCheck = fileURLToPath(new URL("golden-check.mjs", scripts));

test("buildMode は無ければ auto、auto / always / never はそのまま", () => {
  assert.equal(buildMode(undefined), "auto");
  for (const v of ["auto", "always", "never"]) assert.equal(buildMode(v), v);
});

test("spec-query と golden-check は値の無い --build と知らない値を使い方の誤りにし、never はいまのまま受ける", (t) => {
  const root = tempProject(t, "cradle-build-mode-");
  writeTree(root, {
    "lean/Example/Runtime/Scenarios.lean": "def scenarioByName : String → Option Snapshot\n  | \"basic\" => some Scenario.basic\n",
    "lean/golden/a-init.json": JSON.stringify({ ok: { state: {}, views: {} } }), "lean/golden/a-flow.json": JSON.stringify({ ok: { trace: [] } }),
  });
  const run = (script, ...args) => runNode(script, args, { cwd: root, env: cleanEnv() });
  for (const [script, args] of [[specQuery, ["scenarios"]], [goldenCheck, ["--json"]]]) {
    for (const [build, shown] of [[["--build"], "値が無い"], [["--build", "nevr"], "nevr"], [["--build=sometimes"], "sometimes"], [["--build", "--json"], "値が無い"]]) {
      const r = run(script, ...args, ...build);
      const label = [script.split("/").pop(), ...args, ...build].join(" ");
      assert.equal(r.status, 1, label);
      assert.equal(r.stdout, "", label);
      assert.equal(r.stderr, `cradle: --build は auto | always | never のどれか（${shown}）\n`, label);
    }
    assert.equal(run(script, ...args, "--build", "never").status, 0);
  }
  assert.deepEqual(JSON.parse(run(specQuery, "scenarios").stdout), ["basic"]);
});
