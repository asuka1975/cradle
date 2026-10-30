import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree } from "./helpers.mjs";

const status = fileURLToPath(new URL("../.apm/skills/cradle/scripts/status.mjs", import.meta.url));
const sample = "/-- Cradle の骨格のサンプルドメイン（メモ）。 -/\nnamespace Example\nend Example\n";
const beforeExploring = "ddd スキルで探索する（サンプルは探索の根拠にしない）。事実が集まったら lean-domain-model スキルで置き換える";

const leanPhase = (root) => {
  const r = runNode(status, ["--json"], { cwd: root, env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  return JSON.parse(r.stdout).phases.find(p => p.name === "Lean 実行可能仕様");
};

// init --only lean の後や、documents.ddd が出来事の表の無い置き場を指すとき
test("骨格のサンプルが残っていて event-timeline.md が無ければ、出来事 0 件として探索を次の一手にする", (t) => {
  const root = tempProject(t, "cradle-status-notimeline-");
  writeTree(root, { "lean/Example/Memo.lean": sample });
  const lean = leanPhase(root);
  assert.equal(lean.state, "骨格のサンプル");
  assert.equal(lean.next, beforeExploring);
  const text = runNode(status, [], { cwd: root, env: cleanEnv() });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /## Lean 実行可能仕様 — 骨格のサンプル/);
});

test("探索のファイルがあっても event-timeline.md だけが無ければ、探索は出来事 0 件の着手済で、サンプルの次の一手は探索", (t) => {
  const root = tempProject(t, "cradle-status-notimeline-");
  writeTree(root, { "lean/Example/Memo.lean": sample, "documents/ddd/hotspots.md": "| HS-001 | x | open |\n" });
  assert.equal(leanPhase(root).next, beforeExploring);
  const r = runNode(status, ["--json"], { cwd: root, env: cleanEnv() });
  const ddd = JSON.parse(r.stdout).phases.find(p => p.name === "探索 (DDD)");
  assert.equal(ddd.state, "着手済");
  assert.ok(ddd.facts.includes("出来事 0 件"), ddd.facts.join(" / "));
});

test("event-timeline.md に出来事があれば、サンプルの次の一手は置き換え", (t) => {
  const root = tempProject(t, "cradle-status-notimeline-");
  writeTree(root, { "lean/Example/Memo.lean": sample, "documents/ddd/event-timeline.md": "| # | 出来事 |\n|---|---|\n| 1 | 本が登録された |\n" });
  assert.equal(leanPhase(root).next, "lean-domain-model スキルで骨格のサンプルを丸ごと置き換える");
});
