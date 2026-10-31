// sorry / axiom / partial / unsafe の行の規則はコメントを消した行で見る。status の sorry は lean-check の sorryMax と同じ数え方（行・Main.lean 込み）。
import test from "node:test";
import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree } from "./helpers.mjs";
import { leanSorryLines } from "../.apm/skills/cradle/scripts/lib.mjs";

const scripts = new URL("../.apm/skills/cradle/scripts/", import.meta.url);
const leanCheck = fileURLToPath(new URL("lean-check.mjs", scripts));
const status = fileURLToPath(new URL("status.mjs", scripts));
const goldenCheck = fileURLToPath(new URL("golden-check.mjs", scripts));

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

// 文字列の中の /-（GitLab の /-/ の道）でブロックを開くと、ファイルの残りの sorry と axiom が消える
const urlModel = [
  "namespace Example",
  'def issueTracker : String := "https://gitlab.example.com/team/app/-/issues"',
  "/-- 後で証明する。 -/",
  "theorem t : True := sorry",
  "axiom bad : False",
  "end Example",
  "",
].join("\n");

test("lean-check と status は文字列リテラルの中の /- でコメントを開かず、あとの sorry と axiom を数える", (t) => {
  assert.equal(leanSorryLines(urlModel), 1);
  const root = tempProject(t, "cradle-sorry-string-");
  writeTree(root, { "lean/Example/Domain/A.lean": urlModel });
  const r = runNode(leanCheck, ["--json"], { cwd: root, env: cleanEnv() });
  assert.equal(r.status, 1, r.stdout);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.findings.filter(f => ["sorry", "axiom"].includes(f.rule)).map(f => `${f.rule} ${f.file}:${f.line}`),
    ["sorry lean/Example/Domain/A.lean:4", "axiom lean/Example/Domain/A.lean:5"]);
  assert.equal(j.sorry, 1);
  const s = runNode(status, ["--json"], { cwd: root, env: cleanEnv() });
  assert.equal(s.status, 0, s.stderr);
  assert.ok(JSON.parse(s.stdout).phases.find(p => p.name === "Lean 実行可能仕様").facts.includes("sorry 1"), s.stdout);
});

// 生文字列（\ は逃がしでなく、r#"…"# は中の " で閉じない）の対を取り違えると、次の文字列の /-/ からファイルの残りが消える
const rawModel = (line) => ["namespace Example", line, 'def issueTracker : String := "https://gitlab.example.com/team/app/-/issues"', "theorem t : True := sorry", "axiom bad : False", "end Example", ""].join("\n");

test("lean-check と status は生文字列 r\"C:\\\" と r#\"say \"hi\"# の後の sorry と axiom を数える", (t) => {
  const files = { "lean/Example/Domain/A.lean": rawModel('def winRoot : String := r"C:\\"'), "lean/Example/Domain/B.lean": rawModel('def quoteOnly : String := r#"say "hi"#') };
  for (const text of Object.values(files)) assert.equal(leanSorryLines(text), 1);
  const root = tempProject(t, "cradle-sorry-raw-");
  writeTree(root, files);
  const r = runNode(leanCheck, ["--json"], { cwd: root, env: cleanEnv() });
  assert.equal(r.status, 1, r.stdout);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.findings.filter(f => ["sorry", "axiom"].includes(f.rule)).map(f => `${f.rule} ${f.file}:${f.line}`).sort(),
    ["axiom lean/Example/Domain/A.lean:5", "axiom lean/Example/Domain/B.lean:5", "sorry lean/Example/Domain/A.lean:4", "sorry lean/Example/Domain/B.lean:4"]);
  assert.equal(j.sorry, 2);
  const s = runNode(status, ["--json"], { cwd: root, env: cleanEnv() });
  assert.equal(s.status, 0, s.stderr);
  assert.ok(JSON.parse(s.stdout).phases.find(p => p.name === "Lean 実行可能仕様").facts.includes("sorry 2"), s.stdout);
});

test("lean-check と status は、空白なしのブロックコメントに続く sorry・axiom も拾い、名前を分けるブロックからは sorry を作らない", (t) => {
  const root = tempProject(t, "cradle-sorry-");
  writeTree(root, { "lean/Example/Domain/A.lean": "namespace Example\ntheorem t : True := by/- 後で証明 -/sorry\naxiom/- 説明 -/bad : False\ndef sor := 1\ndef ry := sor/- x -/ry\nend Example\n" });
  const j = JSON.parse(runNode(leanCheck, ["--json"], { cwd: root, env: cleanEnv() }).stdout);
  assert.deepEqual(j.findings.filter(f => ["sorry", "axiom"].includes(f.rule)).map(f => `${f.rule} ${f.line}`), ["sorry 2", "axiom 3"]);
  assert.equal(j.sorry, 1);
  const s = runNode(status, ["--json"], { cwd: root, env: cleanEnv() });
  assert.ok(JSON.parse(s.stdout).phases.find(p => p.name === "Lean 実行可能仕様").facts.includes("sorry 1"), s.stdout);
});

test("lean-check と status は親を指すリンクがあってもファイルを重ねて数えない", (t) => {
  const root = tempProject(t, "cradle-sorry-");
  writeTree(root, { "lean/Example/Domain/A.lean": "namespace Example\ntheorem t : True := sorry\nend Example\n" });
  symlinkSync("..", join(root, "lean", "Example", "Domain", "up"));
  const j = JSON.parse(runNode(leanCheck, ["--json"], { cwd: root, env: cleanEnv() }).stdout);
  assert.equal(j.sorry, 1);
  const s = runNode(status, ["--json"], { cwd: root, env: cleanEnv() });
  assert.ok(JSON.parse(s.stdout).phases.find(p => p.name === "Lean 実行可能仕様").facts.includes("sorry 1"), s.stdout);
});

// walk を通らず readdirSync で読む置き場（UseCase・Port・その操作）にも、編集中は Emacs のロックファイルが置かれる
test("lean-check・status・golden-check は UseCase と Port の置き場の Emacs のロックファイルで落ちない", (t) => {
  const root = tempProject(t, "cradle-sorry-");
  writeTree(root, { "lean/Example/Application/UseCase/Foo/UseCase.lean": "namespace Example\nend Example\n", "lean/Example/Application/Port/Directory/Find.lean": "namespace Example\nstructure Request where\n  x : Nat\nstructure Outcome where\n  y : Nat\nend Example\n" });
  const lock = "user@host.1:2";
  symlinkSync(lock, join(root, "lean/Example/Application/UseCase/.#Foo.lean"));
  symlinkSync(lock, join(root, "lean/Example/Application/Port/.#x"));
  symlinkSync(lock, join(root, "lean/Example/Application/Port/Directory/.#Find.lean"));
  const r = runNode(leanCheck, ["--json"], { cwd: root, env: cleanEnv() });
  assert.doesNotMatch(r.stderr, /^\s+at /m);
  assert.deepEqual(JSON.parse(r.stdout).findings.filter(f => f.file?.includes(".#")), []);
  const s = runNode(status, ["--json"], { cwd: root, env: cleanEnv() });
  assert.equal(s.status, 0, s.stderr);
  assert.ok(JSON.parse(s.stdout).phases.find(p => p.name === "Lean 実行可能仕様").facts.some(f => f.endsWith("/ UseCase 1 件")), s.stdout);
  const g = runNode(goldenCheck, ["--json", "--build", "never"], { cwd: root, env: cleanEnv() });
  assert.doesNotMatch(g.stderr, /^\s+at /m);
});
