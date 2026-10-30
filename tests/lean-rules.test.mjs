// lean-check の規則（lean-rules.mjs の checkLean）の単体テスト。プロセスを起こさず、指摘の並び（--json の findings の順）を直に見る。
import test from "node:test";
import assert from "node:assert/strict";
import { tempProject, writeTree } from "./helpers.mjs";
import { loadConfig, rel } from "../.apm/skills/cradle/scripts/lib.mjs";
import { checkLean } from "../.apm/skills/cradle/scripts/lean-rules.mjs";

// どの規則にも 1 つずつ掛かる Lean モデル。Orphan.lean だけがルートから辿れない
const model = {
  "lean/Example.lean": ["Application.Port.Mailer.Send", "Application.ReadModel", "Application.UseCase.ShowUseCase.QueryService", "Application.UseCase.ShowUseCase.UseCase", "Domain.Entity.Item", "Domain.Rules", "Runtime.Command", "Runtime.Json", "Runtime.Machine"].map(m => `import Example.${m}\n`).join(""),
  "lean/Example/Application/Port/Mailer/Send.lean": "structure Request where\n  to : Nat\n",
  "lean/Example/Application/ReadModel.lean": "import Example.Domain.Entity.Item\ndef lean2kotlinName : Nat := sorry\nstructure Row where\n  n : Nat\nderiving Repr, ToJson\n",
  "lean/Example/Application/UseCase/ShowUseCase/QueryService.lean": "def query := 1\n",
  "lean/Example/Application/UseCase/ShowUseCase/UseCase.lean": "def validate := 1\ndef execute := 1\n",
  "lean/Example/Domain/Entity/Item.lean": "/- Cradle の骨格のサンプルドメイン -/\nstructure Item where\n  id : Nat\n",
  // 行頭の -- が structure の切れ目になる（元の文面で探す）ので、Who のフィールドはコメントの 1 行だけ
  "lean/Example/Domain/Rules.lean": "import Example.Application.ReadModel\naxiom bad : False\n@[actorContext]\nstructure Who where\n  -- id : Nat\n-- note\n  age : Nat\n",
  "lean/Example/Orphan.lean": "def x := 1\n",
  "lean/Example/Runtime/Command.lean": "inductive Command where\n  | start (n : Nat)\n  | ghost (n : Nat)\nderiving Repr\n",
  "lean/Example/Runtime/Json.lean": 'def wire := "start"\n',
  "lean/Example/Runtime/Machine.lean": "def Snapshot.applyCommand (c : Command) : Nat :=\n  match c with\n  | .start n => n\n  | .ghost n => n\n",
  "lean/Main.lean": "def main : IO Unit := sorry\n",
  "documents/ddd/event-timeline.md": "| 1 | 出来事 |\n",
};

function setup(t, files = model) {
  const root = tempProject(t, "cradle-lean-rules-");
  writeTree(root, files);
  return loadConfig(root, {});
}
const brief = (findings) => findings.map(f => [f.rule, f.severity, f.file, f.line]);

test("checkLean は行の規則・walls・cqrs をファイルごとに続けて（Main.lean は最後）、そのあと actor・annot/json・wiring・usecase・port・scaffold・orphan の順に並べる", (t) => {
  const cfg = setup(t);
  const { files, findings } = checkLean(cfg);
  assert.deepEqual(brief(findings), [
    ["sorry", "info", "lean/Example/Application/ReadModel.lean", 2],
    ["mentions", "error", "lean/Example/Application/ReadModel.lean", 2],
    ["cqrs", "error", "lean/Example/Application/ReadModel.lean", 1],
    ["axiom", "error", "lean/Example/Domain/Rules.lean", 2],
    ["walls", "error", "lean/Example/Domain/Rules.lean", 1],
    ["sorry", "info", "lean/Main.lean", 1],
    ["actor", "error", "lean/Example/Domain/Rules.lean", 3],
    ["json", "error", "lean/Example/Application/ReadModel.lean", 5],
    ["wiring", "error", "lean/Example/Runtime/Json.lean", 1],
    ["wiring", "error", "lean/Example/Runtime/Environment.lean", 1],
    ["usecase", "error", "lean/Example/Application/UseCase/ShowUseCase", 1],
    ["port", "error", "lean/Example/Application/Port/Mailer/Send.lean", 1],
    ["scaffold", "warn", "lean/Example/Domain/Entity/Item.lean", 1],
    ["orphan", "warn", "lean/Example/Orphan.lean", 1],
  ]);
  assert.match(findings[8].message, /^構成子 ghost のワイヤ形式/);
  assert.match(findings[11].message, /^固定名 Outcome（観測）が無い/);
  // files は modelDir の下の .lean だけ（Main.lean とルートの Example.lean は入らない）
  assert.deepEqual(files.map(f => rel(cfg.root, f)), Object.keys(model).filter(f => f.startsWith("lean/Example/")).sort());
});

test("checkLean の読み置きは 1 回の検査の中だけで、書き換えたファイルは次の検査で読み直す", (t) => {
  const cfg = setup(t, { "lean/Example/Domain/A.lean": "theorem a : True := sorry\n" });
  assert.deepEqual(brief(checkLean(cfg).findings), [["sorry", "info", "lean/Example/Domain/A.lean", 1]]);
  writeTree(cfg.root, { "lean/Example/Domain/A.lean": "theorem a : True := trivial\naxiom b : False\n" });
  assert.deepEqual(brief(checkLean(cfg).findings), [["axiom", "error", "lean/Example/Domain/A.lean", 2]]);
});
