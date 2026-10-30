// 用語集（ubiquitous-language.md）が無いプロジェクト: 形式化が付けた名前はどれも用語集に行が無いものとして数え、道具は落ちない。
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, tempProject, cleanEnv, runNode, writeTree, commitAll } from "./helpers.mjs";
import { glossaryEnglish } from "../.apm/skills/cradle/scripts/lib.mjs";

const scripts = new URL("../.apm/skills/", import.meta.url);
const unslop = fileURLToPath(new URL("cradle/scripts/unslop-lint.mjs", scripts));
const hook = fileURLToPath(new URL("cradle/scripts/hook.mjs", scripts));
const ddd = fileURLToPath(new URL("ddd/scripts/ddd.mjs", scripts));

const command = "namespace Example.Runtime\ninductive Command where\n  | postNote (c : PostNoteUseCase.Command)\n  | closeNote (c : CloseNoteUseCase.Command)\nend Example.Runtime\n";

// 一時プロジェクト: 実ドメインの Command.lean と出来事の表。用語集は置かない
function fixture(t) {
  const root = tempProject(t, "cradle-glossary-missing-");
  writeTree(root, {
    "documents/ddd/event-timeline.md": "# イベント時系列マップ\n\nプロダクト: メモ\n\n| # | 出来事 |\n|---|---|\n| 1 | 書いた |\n",
    "lean/Example/Runtime/Command.lean": command,
    "e2e/flow.ts": "export const y = 1;\n",
  });
  return root;
}

test("glossaryEnglish は用語集が無ければ空の対応を返し、ディレクトリは無いものとして扱わず投げる", (t) => {
  const root = tempDir(t, "cradle-glossary-");
  const cfg = { root, documents: { ddd: "documents/ddd" } };
  assert.equal(glossaryEnglish(cfg).size, 0);
  writeTree(root, { "documents/ddd/ubiquitous-language.md/x": "" });
  assert.throws(() => glossaryEnglish(cfg), { code: "EISDIR" });
});

test("用語集が無ければ unslop --all は形式化が付けた名前を全部 lean-name-unlisted で挙げ、ddd status は全部を命名の確認待ちに数える", (t) => {
  const root = fixture(t);
  const r = runNode(unslop, ["--all", "--json"], { cwd: root, env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.deepEqual(JSON.parse(r.stdout).findings.filter(f => f.rule === "lean-name-unlisted").map(f => [f.line, f.severity]), [[3, "warn"], [4, "warn"]]);
  const s = runNode(ddd, ["status"], { cwd: root, env: cleanEnv() });
  assert.equal(s.status, 0, s.stderr);
  assert.equal(JSON.parse(s.stdout).namingPending, 2);
});

test("用語集が無くても Stop は差分の Command.lean と並ぶ unslop error で差し戻す", (t) => {
  const root = fixture(t);
  commitAll(root);
  writeTree(root, { "lean/Example/Runtime/Command.lean": command.replace("end Example", "  | archiveNote (c : ArchiveNoteUseCase.Command)\nend Example"), "e2e/flow.ts": "// 手は未決\nexport const y = 1;\n" });
  const r = runNode(hook, ["stop"], { cwd: root, env: cleanEnv(), input: JSON.stringify({ cwd: root }) });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /e2e\/flow\.ts:1 \[comment-status\]/);
});
