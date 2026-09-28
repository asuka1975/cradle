import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const status = fileURLToPath(new URL("../.apm/skills/cradle/scripts/status.mjs", import.meta.url));

const HOTSPOTS = `| ID | 種別 | 問い | 関連 | 状態 | 解決 |
|---|---|---|---|---|---|
| HS-001 | 未決 | 閉じられるのは誰か | | resolved | 書いた本人だけ |
| HS-002 | 未決 | 題は重なってよいか | | resolved | 重ならない |
| HS-003 | 未決 | 消せるか | | open | |
| HS-004 | 未決 | 開き直せるか | | 撤回 | |
`;

// 一時プロジェクト: hotspots.md と Lean のモデル（ビルド済みの印・一覧の口 1 つ）。laws は Laws/Guarantees.lean の本文
function fixture(t, { laws, entity = "" }) {
  const root = mkdtempSync(join(tmpdir(), "cradle-status-guarantee-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (rel, text) => { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), text); };
  put("cradle.json", JSON.stringify({ project: "Example" }));
  put("documents/ddd/hotspots.md", HOTSPOTS);
  put("lean/Example/Runtime/Views.lean", "structure Views where\n  notes : Option (List Nat)\nderiving Repr\n");
  put("lean/Example/Domain/Entity/Note.lean", entity);
  put("lean/Example/Laws/Guarantees.lean", laws);
  put("lean/.lake/build/bin/example", "");
  const env = { ...process.env };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  const r = spawnSync(process.execPath, [status, "--json"], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).phases.find(p => p.name === "Lean 実行可能仕様");
}

test("resolved HS のうち Laws/ の保証の定理が出典に引くものを数え、無い HS を次の一手にする", (t) => {
  const lean = fixture(t, { laws: "/-- [HS-001] メモを閉じられるのは書いた本人だけ。 -/\ntheorem close_only_by_author : True := trivial\n" });
  assert.ok(lean.facts.includes("保証の定理: resolved HS 1/2（無い: HS-002）"), lean.facts.join(" / "));
  assert.match(lean.next, /保証の定理の無い resolved HS 1 件（HS-002）/);
});

test("@[contract] の定理と Laws/ の外の定理は保証の定理と数えない", (t) => {
  const lean = fixture(t, {
    laws: "/-- [HS-001] 閉じられるのは書いた本人だけ。 -/\n@[contract] theorem close_author : True := trivial\n",
    entity: "/-- [HS-002] 題は重ならない。 -/\ntheorem titles_nodup : True := trivial\n",
  });
  assert.ok(lean.facts.includes("保証の定理: resolved HS 0/2（無い: HS-001, HS-002）"), lean.facts.join(" / "));
});

test("resolved HS がすべて保証の定理を持てば、Lean の段は次の段へ進む", (t) => {
  const lean = fixture(t, { laws: "/-- [HS-001] [HS-002] 閉じられるのは本人だけで、題は重ならない。 -/\n@[simp] theorem rules : True := trivial\n" });
  assert.ok(lean.facts.includes("保証の定理: resolved HS 2/2"), lean.facts.join(" / "));
  assert.doesNotMatch(lean.next, /保証の定理/);
});
