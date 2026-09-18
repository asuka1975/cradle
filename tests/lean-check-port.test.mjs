import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const leanCheck = fileURLToPath(new URL("../.apm/skills/cradle/scripts/lean-check.mjs", import.meta.url));

// 一時プロジェクト: Port の操作モジュール 1 つだけの Lean モデル（lake build はしない）。runtime は Runtime/ に置く追加ファイル
function fixture(t, findLean, runtime = {}, rule = "port") {
  const root = mkdtempSync(join(tmpdir(), "cradle-lean-check-port-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example" }));
  const port = join(root, "lean/Example/Application/Port/Directory");
  mkdirSync(port, { recursive: true });
  writeFileSync(join(port, "Find.lean"), findLean);
  for (const [name, text] of Object.entries(runtime)) {
    mkdirSync(join(root, "lean/Example/Runtime"), { recursive: true });
    writeFileSync(join(root, "lean/Example/Runtime", name), text);
  }
  const env = { ...process.env };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  const r = spawnSync(process.execPath, [leanCheck, "--json"], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  return JSON.parse(r.stdout).findings.filter(f => f.rule === rule);
}
const pureFind = "namespace Example.Application.Port.Directory.Find\n\nstructure Request where\n  employee : Nat\n\ninductive Outcome where\n  | found (name : String)\n  | missing\n\nend Example.Application.Port.Directory.Find\n";

test("要求と観測が純データなら port 規則の指摘は無い", (t) => {
  assert.deepEqual(fixture(t, pureFind), []);
});

test("Runtime/Environment.lean を持つなら、Port の操作ごとに \"<Port>\" と \"<操作>\"（小文字始まり）の文字列が Json.lean に要る", (t) => {
  const environment = "namespace Example.Runtime\nstructure Environment where\n  script : List Interaction\n  cursor : Nat\nend Example.Runtime\n";
  const json = (port, op) => `instance : ToJson Interaction where\n  toJson\n    | .directoryFind r o => interaction "${port}" "${op}" (toJson r) (toJson o)\n`;
  assert.deepEqual(fixture(t, pureFind, { "Environment.lean": environment, "Json.lean": json("Directory", "find") }, "wiring"), []);
  const missingOp = fixture(t, pureFind, { "Environment.lean": environment, "Json.lean": json("Directory", "Find") }, "wiring");
  assert.equal(missingOp.length, 1, JSON.stringify(missingOp));
  assert.match(missingOp[0].message, /^Port の往復 Directory\.find のワイヤ形式（"find"）が Json\.lean に無い/);
  assert.equal(missingOp[0].file, "lean/Example/Runtime/Json.lean");
  const missingBoth = fixture(t, pureFind, { "Environment.lean": environment, "Json.lean": json("Gateway", "authorize") }, "wiring");
  assert.match(missingBoth[0].message, /（"Directory" と "find"）/);
  // Runtime/Environment.lean が無ければ文字列は見ない — 代わりに、Port の置き場があるのに環境が無いことが配線の誤り
  const noEnv = fixture(t, pureFind, { "Json.lean": json("Gateway", "authorize") }, "wiring");
  assert.deepEqual(noEnv.map(f => f.message), ["Port の置き場（Application/Port か Domain/Port）があるのに Runtime/Environment.lean（外部能力の script と cursor）が無い"]);
});

test("構成子の引数の関数型と、括弧の中の関数フィールドを拾う", (t) => {
  const findings = fixture(t, "namespace Example.Application.Port.Directory.Find\n\nstructure Request where\n  employee : Nat\n  render : Option (Nat → String)\n\ninductive Outcome where\n  | found (name : String)\n  | callback (f : Nat → Nat)\n\nend Example.Application.Port.Directory.Find\n");
  assert.deepEqual(findings.map(f => f.message.split("（")[0]), ["関数フィールドを持つ", "関数を引数に取る構成子がある"]);
  assert.match(findings[0].message, /render : Option \(Nat → String\)/);
  assert.match(findings[1].message, /callback \(f : Nat → Nat\)/);
});
