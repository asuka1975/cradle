// golden-check の --name は繰り返せる（`[--name N]...`）: 指定した順に、同じ名前は 1 度だけ検査する。値の無い --name は使い方の誤り。
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree } from "./helpers.mjs";
import { parseArgs } from "../.apm/skills/cradle/scripts/lib.mjs";

const goldenCheck = fileURLToPath(new URL("../.apm/skills/cradle/scripts/golden-check.mjs", import.meta.url));

test("parseArgs の list は空白の形も = の形も現れた順に積み、ほかの鍵は最後の値が勝つまま", () => {
  const spec = { name: "list", json: "bool" };
  assert.deepEqual(parseArgs(["--name", "a", "--name=b", "--json", "--name", "c", "x"], spec), { _: ["x"], name: ["a", "b", "c"], json: true });
  assert.deepEqual(parseArgs(["--name", "a"], spec), { _: [], name: ["a"] });
  assert.deepEqual(parseArgs(["--name", "--json"], spec), { _: [], name: [true], json: true });
  assert.deepEqual(parseArgs(["--name"], spec), { _: [], name: [true] });
  assert.deepEqual(parseArgs([], spec), { _: [] });
  assert.deepEqual(parseArgs(["--build", "never", "--build=always", "--json=1", "--manifest", "--json"], spec), { _: [], build: "always", json: true, manifest: true });
  assert.deepEqual(parseArgs(["--json=1"], spec), { _: [], json: "1" });
});

// 一時プロジェクト: sidecar の無い旧経路の golden a・b・c（どれも skipped になり、CLI は呼ばない）
function fixture(t) {
  const root = tempProject(t, "cradle-golden-names-");
  const golden = (name) => ({ [`lean/golden/${name}-init.json`]: JSON.stringify({ ok: { state: {}, views: {} } }), [`lean/golden/${name}-flow.json`]: JSON.stringify({ ok: { trace: [] } }) });
  writeTree(root, { ...golden("a"), ...golden("b"), ...golden("c") });
  return (...args) => runNode(goldenCheck, ["--build", "never", "--json", ...args], { cwd: root, env: cleanEnv() });
}

test("golden-check は繰り返した --name を全部、指定した順に 1 度ずつ検査する", (t) => {
  const run = fixture(t);
  const names = (...args) => { const r = run(...args); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout).report.map(x => x.name); };
  assert.deepEqual(names(), ["a", "b", "c"]);
  assert.deepEqual(names("--name", "b"), ["b"]);
  assert.deepEqual(names("--name", "c", "--name=a", "--name", "c"), ["c", "a"]);
});

test("値の無い --name は golden の名前が要ると言って止まる", (t) => {
  const run = fixture(t);
  for (const args of [["--name"], ["--name", "--update"], ["--name="], ["--name", "a", "--name"]]) {
    const r = run(...args);
    assert.equal(r.status, 1, args.join(" "));
    assert.equal(r.stdout, "", args.join(" "));
    assert.equal(r.stderr, "cradle: --name には golden の名前が要ります（--name N を繰り返せば複数）\n", args.join(" "));
  }
});
