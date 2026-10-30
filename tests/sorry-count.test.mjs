// sorry / axiom / partial / unsafe の行の規則はコメントを消した行で見る。status の sorry は lean-check の sorryMax と同じ数え方（行・Main.lean 込み）。
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree } from "./helpers.mjs";
import { leanSorryLines } from "../.apm/skills/cradle/scripts/lib.mjs";

const scripts = new URL("../.apm/skills/cradle/scripts/", import.meta.url);
const leanCheck = fileURLToPath(new URL("lean-check.mjs", scripts));
const status = fileURLToPath(new URL("status.mjs", scripts));

const model = [
  "namespace Example",
  "/-- この定理は",
  "  sorry を使わずに閉じる -/",
  "theorem a : True := trivial",
  "/-- doc -/ theorem t : True := sorry",
  "def pair : Nat × Nat := ⟨sorry, sorry⟩",
  "/- 証明は後で sorry を外す -/",
  "/-",
  "axiom bad : False",
  "partial def loop : Nat → Nat",
  "unsafe def u := 1",
  "-/",
  "end Example",
  "",
].join("\n");

test("leanSorryLines はコメントの外で sorry を含む行を数える", () => {
  assert.equal(leanSorryLines(model), 2);
  assert.equal(leanSorryLines("theorem x : P := sorry -- TODO(proof): 帰納法\n"), 1);
  assert.equal(leanSorryLines(""), 0);
});

test("lean-check はコメントの中の sorry と axiom / partial / unsafe を数えず、status の sorry は lean-check と同じ数", (t) => {
  const root = tempProject(t, "cradle-sorry-");
  writeTree(root, { "lean/Example/Domain/A.lean": model, "lean/Main.lean": "def main : IO Unit := sorry\n" });
  const r = runNode(leanCheck, ["--json"], { cwd: root, env: cleanEnv() });
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.findings.filter(f => ["sorry", "axiom", "partial", "unsafe"].includes(f.rule)).map(f => `${f.rule} ${f.file}:${f.line}`),
    ["sorry lean/Example/Domain/A.lean:5", "sorry lean/Example/Domain/A.lean:6", "sorry lean/Main.lean:1"]);
  assert.equal(j.sorry, 3);
  const s = runNode(status, ["--json"], { cwd: root, env: cleanEnv() });
  assert.equal(s.status, 0, s.stderr);
  assert.ok(JSON.parse(s.stdout).phases.find(p => p.name === "Lean 実行可能仕様").facts.includes("sorry 3"), s.stdout);
});
