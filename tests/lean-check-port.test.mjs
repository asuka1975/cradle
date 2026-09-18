import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const leanCheck = fileURLToPath(new URL("../.apm/skills/cradle/scripts/lean-check.mjs", import.meta.url));

// 一時プロジェクト: Port の操作モジュール 1 つだけの Lean モデル（lake build はしない）
function fixture(t, findLean) {
  const root = mkdtempSync(join(tmpdir(), "cradle-lean-check-port-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example" }));
  const port = join(root, "lean/Example/Application/Port/Directory");
  mkdirSync(port, { recursive: true });
  writeFileSync(join(port, "Find.lean"), findLean);
  const env = { ...process.env };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  const r = spawnSync(process.execPath, [leanCheck, "--json"], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  return JSON.parse(r.stdout).findings.filter(f => f.rule === "port");
}

test("要求と観測が純データなら port 規則の指摘は無い", (t) => {
  const findings = fixture(t, "namespace Example.Application.Port.Directory.Find\n\nstructure Request where\n  employee : Nat\n\ninductive Outcome where\n  | found (name : String)\n  | missing\n\nend Example.Application.Port.Directory.Find\n");
  assert.deepEqual(findings, []);
});

test("構成子の引数の関数型と、括弧の中の関数フィールドを拾う", (t) => {
  const findings = fixture(t, "namespace Example.Application.Port.Directory.Find\n\nstructure Request where\n  employee : Nat\n  render : Option (Nat → String)\n\ninductive Outcome where\n  | found (name : String)\n  | callback (f : Nat → Nat)\n\nend Example.Application.Port.Directory.Find\n");
  assert.deepEqual(findings.map(f => f.message.split("（")[0]), ["関数フィールドを持つ", "関数を引数に取る構成子がある"]);
  assert.match(findings[0].message, /render : Option \(Nat → String\)/);
  assert.match(findings[1].message, /callback \(f : Nat → Nat\)/);
});
