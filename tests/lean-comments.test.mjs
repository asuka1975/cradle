// Lean のコメントの消し方（lib の stripLeanComments）と、それを使う lean-check・leanVocabulary の読み方。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, tempProject, writeTree, cleanEnv, runNode } from "./helpers.mjs";
import { stripLeanComments, leanVocabulary } from "../.apm/skills/cradle/scripts/lib.mjs";

const leanCheck = fileURLToPath(new URL("../.apm/skills/cradle/scripts/lean-check.mjs", import.meta.url));
const init = fileURLToPath(new URL("../.apm/skills/cradle-init/scripts/init.mjs", import.meta.url));

test("stripLeanComments は複数行の docstring・入れ子のブロック・行コメントを消し、改行と同じ行のコードを残す", () => {
  assert.equal(stripLeanComments("/-- 確認する。\n  ActorContext は受けない -/\ndef x := 1\n"), "\n\ndef x := 1\n");
  assert.equal(stripLeanComments("def a := 1 -- see https://gitlab.com/x/-/issues/12\n| post\n"), "def a := 1 \n| post\n");
  assert.equal(stripLeanComments("/- 外 /- 内 -/ まだ外 -/def b := 2"), "def b := 2");
  assert.equal(stripLeanComments("/-- doc -/ theorem t : True := sorry"), " theorem t : True := sorry");
  assert.equal(stripLeanComments("/- -- 行コメントに見える -/import X\n"), "import X\n");
  assert.equal(stripLeanComments("x -- 末尾に改行が無い"), "x ");
  assert.equal(stripLeanComments("/- 閉じない\nブロック"), "\n");
});

test("stripLeanComments はコードの文字列リテラルと文字リテラルをそのまま写し、その中の -- と /- でコメントを開かない", () => {
  // GitLab の /-/ を持つ文字列のあとの docstring だけを消し、sorry と axiom はコードに残す
  const url = 'def u : String := "https://gitlab.example.com/team/app/-/issues"\n';
  assert.equal(stripLeanComments(url + "/-- 後で証明する。 -/\ntheorem t : True := sorry\naxiom bad : False\n"), url + "\ntheorem t : True := sorry\naxiom bad : False\n");
  assert.equal(stripLeanComments('def s := "a -- b /- c" ++ t -- 消す\n'), 'def s := "a -- b /- c" ++ t \n');
  // \" と \\ では文字列を閉じない
  assert.equal(stripLeanComments('def e := "q\\"/-\\\\" /- 消す -/x\n'), 'def e := "q\\"/-\\\\" x\n');
  // 名前の ' は文字リテラルを開かない（直後の " から文字列）
  const primed = "theorem h' : x' = y' := sorry\ndef v' : String := f x'\"/-\" ++ \"it's /- fine\"\naxiom bad : False\n";
  assert.equal(stripLeanComments(primed), primed);
  // '"' と '\"' と '\'' は文字リテラルで、中の " から文字列を開かない
  assert.equal(stripLeanComments("def q := ['\"', '\\\"', '\\'']\n/- 消す -/axiom bad : False\n"), "def q := ['\"', '\\\"', '\\'']\naxiom bad : False\n");
  // コメントの中の " は数えない
  assert.equal(stripLeanComments('-- "閉じない\ndef x := 1 /- " -/\naxiom bad : False\n'), '\ndef x := 1 \naxiom bad : False\n');
  // 文字列の中の改行もそのまま（行番号が動かない）。閉じない文字列は最後まで写す
  assert.equal(stripLeanComments('def m := "1 行目\n-- 2 行目"\naxiom bad : False -- 消す\n'), 'def m := "1 行目\n-- 2 行目"\naxiom bad : False \n');
  assert.equal(stripLeanComments('def n := "閉じない -- /-\naxiom bad : False\n'), 'def n := "閉じない -- /-\naxiom bad : False\n');
});

test("leanVocabulary は行コメントの中の /- でブロックを開かない", (t) => {
  const root = tempDir(t, "cradle-lean-vocab-");
  writeTree(root, { "Example/Runtime/Command.lean": "inductive Command where\n  -- see https://gitlab.com/x/-/issues/1\n  | post\n  /-- 閉じる。 -/\n  | close\nderiving Repr\n" });
  assert.deepEqual(leanVocabulary({ lean: { modelDir: join(root, "Example") } }).map(v => [v.name, v.line, v.doc]), [["post", 3, ""], ["close", 5, "閉じる"]]);
});

// 一時プロジェクトに lean/Example の下のファイルを置き、lean-check --json の指摘を返す
function check(t, files) {
  const root = tempProject(t, "cradle-lean-comments-");
  writeTree(join(root, "lean/Example"), files);
  const r = runNode(leanCheck, ["--json"], { cwd: root, env: cleanEnv() });
  return JSON.parse(r.stdout).findings;
}

test("lean-check は内部入力の UseCase の複数行の docstring に書いた名義を、受けているとは数えない", (t) => {
  const findings = check(t, {
    "Application/UseCase/ConfirmUseCase/Observation.lean": "structure Observation where\n  attempt : Nat\n",
    "Application/UseCase/ConfirmUseCase/UseCase.lean": "/-- 確認する。\n  ActorContext は受けない -/\ndef validate (o : Observation) : Except DomainError Unit := sorry\ndef execute (o : Observation) : Except DomainError Unit := sorry\n",
  });
  assert.deepEqual(findings.filter(f => f.rule === "usecase"), []);
});

test("lean-check は Port の要求の複数行の docstring を関数フィールドや生成器への言及と数えない", (t) => {
  const findings = check(t, {
    "Application/Port/Directory/Find.lean": "/-- 社員を引く。\n  lookup : Nat → String は Lean2Kotlin が写す -/\nstructure Request where\n  employee : Nat\n\ninductive Outcome where\n  | found (name : String)\n",
  });
  assert.deepEqual(findings.filter(f => ["port", "mentions"].includes(f.rule)), []);
});

test("lean-check は Command の構成子の docstring の中の | 行を構成子と数えない", (t) => {
  const findings = check(t, {
    "Runtime/Command.lean": "inductive Command where\n  /-- 投稿する。\n    | legacyPost は廃止 -/\n  | post (c : PostUseCase.Command)\nderiving Repr\n",
    "Runtime/Json.lean": "instance : FromJson Command where\n  fromJson? j := match (j.getObjVal? \"post\").toOption with | some p => (fromJson? p).map Command.post | none => .error \"unknown command\"\n",
    "Runtime/Machine.lean": "def Snapshot.applyCommand (cmd : Command) (s : Snapshot) : Except DomainError Snapshot :=\n  match cmd with\n  | .post c => sorry\n",
  });
  assert.deepEqual(findings.filter(f => f.rule === "wiring"), []);
});

test("lean-check の wiring は Json.lean のコメントの中の \"<構成子>\" をワイヤ形式と数えない", (t) => {
  const root = tempDir(t, "cradle-lean-wire-");
  assert.equal(runNode(init, ["--project", "Demo", "--dir", root], { cwd: root, env: cleanEnv() }).status, 0);
  const wiring = () => JSON.parse(runNode(leanCheck, ["--json"], { cwd: root, env: cleanEnv() }).stdout).findings.filter(f => f.rule === "wiring").map(f => `${f.file} ${f.message}`);
  assert.deepEqual(wiring(), []);
  // ワイヤの文字列を "closeNoteX" に変え、古い名前はコメントにだけ残す
  const json = join(root, "lean/Demo/Runtime/Json.lean");
  writeFileSync(json, readFileSync(json, "utf8").replaceAll('"closeNote"', '"closeNoteX"') + '-- 旧: "closeNote"\n/- 旧: "closeNote" -/\n');
  assert.deepEqual(wiring(), ['lean/Demo/Runtime/Json.lean 構成子 closeNote のワイヤ形式（"closeNote"）が Json.lean に無い']);
});
