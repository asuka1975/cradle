// lib.mjs の小道具（複数の道具が共有する読み方・数え方）の単体テスト。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, writeTree } from "./helpers.mjs";
import { sha256, walk, leanSnapshot, readText, DDD_FILES, countEvents, countStatusRows,
  goldenDirOf, goldenFlowFiles, stepOutcome, nominatedFault, cradleScript, renameScaffold, PRODUCT_PLACEHOLDER } from "../.apm/skills/cradle/scripts/lib.mjs";

test("sha256 は文字列と同じ中身の Buffer に同じ 16 進を返す", () => {
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256(Buffer.from("探索", "utf8")), sha256("探索"));
  assert.equal(sha256(""), createHash("sha256").update("").digest("hex"));
});

test("walk の既定はビルド成果物と VCS の置き場を見ない。leanSnapshot はそれに lake-manifest.json を足す", (t) => {
  const root = tempDir(t, "cradle-walk-");
  writeTree(root, {
    "lean/A.lean": "a", "lean/lake-manifest.json": "{}",
    "lean/.lake/x": "", "lean/node_modules/x": "", "lean/build/x": "", "lean/.git/x": "", "lean/dist/x": "",
  });
  assert.deepEqual(walk(join(root, "lean")), [join(root, "lean", "A.lean"), join(root, "lean", "lake-manifest.json")]);
  assert.deepEqual(leanSnapshot({ lean: { rootDir: join(root, "lean") } }), { "A.lean": sha256("a") });
});

test("readText は無いファイルで fallback（既定は空文字）を返し、ディレクトリは無いものとして扱わず投げる", (t) => {
  const root = tempDir(t, "cradle-read-text-");
  writeTree(root, { "a.md": "中身\n", "d/x": "" });
  assert.equal(readText(join(root, "a.md")), "中身\n");
  assert.equal(readText(join(root, "a.md"), null), "中身\n");
  assert.equal(readText(join(root, "none.md")), "");
  assert.equal(readText(join(root, "none.md"), null), null);
  assert.throws(() => readText(join(root, "d")), { code: "EISDIR" });
});

test("DDD_FILES は探索の 5 ファイルを欠けている一覧の順で持ち、書き換えられない", () => {
  assert.deepEqual([...DDD_FILES], ["event-timeline.md", "hotspots.md", "ubiquitous-language.md", "ux-review.md", "model-review.md"]);
  assert.ok(Object.isFrozen(DDD_FILES));
});

test("countEvents はどの表でも行頭のセルが番号の行を数え、字下げした行は数えない。text が無ければ投げる", () => {
  const text = [
    "| # | 出来事 |", "|---|---|", "| 1 | 注文した |", "| 2.1 | 撤回: 取り消した |", "| 3a | 届いた |",
    "  | 4 | 字下げ |", "| A | 番号でない |", "",
    "| # | 方針 |", "|---|---|", "|  10  | 別の表 |",
  ].join("\n");
  assert.equal(countEvents(text), 4);
  assert.equal(countEvents(""), 0);
  assert.throws(() => countEvents(null), TypeError);
});

test("countStatusRows は行頭の ID と 3 列目以降のちょうど一致する状態の行を数え、text が無ければ 0", () => {
  const text = [
    "| ID | 問い | 状態 |", "|---|---|---|", "| HS-001 | a | open |", "| HS-002 | b | resolved |", "| HS-003 | open | resolved |",
    "| HS-004 | c | opened |", "| MQ-001 | d | open |", "  | HS-005 | e | open |", "| open | f | open |",
  ].join("\n");
  assert.equal(countStatusRows(text, "HS-\\d+", "open"), 1);
  assert.equal(countStatusRows(text, "HS-\\d+", "resolved"), 2);
  assert.equal(countStatusRows(text, "(?:HS|UX|MQ)-\\d+", "open"), 2);
  assert.equal(countStatusRows(null, "HS-\\d+", "open"), 0);
  assert.equal(countStatusRows("", "HS-\\d+", "open"), 0);
});

test("goldenDirOf はプロジェクトルートから lean.golden を引く", () => {
  assert.equal(goldenDirOf({ root: "/p", lean: { golden: "lean/golden" } }), join("/p", "lean", "golden"));
});

test("goldenFlowFiles は -flow.json だけを、接尾辞を外す前のファイル名の順に返す", (t) => {
  const dir = tempDir(t, "cradle-golden-files-");
  writeTree(dir, { "pay-flow.json": "{}", "pay-alt-flow.json": "{}", "pay-init.json": "{}", "pay.request.json": "{}", "a-flow.json.bak": "" });
  assert.deepEqual(goldenFlowFiles(dir), ["pay-alt-flow.json", "pay-flow.json"]);
});

test("stepOutcome は文字列の result を優先し、無ければ domainError / error から判定する", () => {
  assert.equal(stepOutcome({ result: "fault", domainError: "x" }), "fault");
  assert.equal(stepOutcome({ result: 1, domainError: "x" }), "refused");
  assert.equal(stepOutcome({ error: "bad" }), "protocol-error");
  assert.equal(stepOutcome({}), "applied");
});

test("nominatedFault は trace の文字列、無ければ入力の文字列を返し、どちらも文字列でなければ undefined", () => {
  assert.equal(nominatedFault({ fault: "a" }, { fault: "b" }), "a");
  assert.equal(nominatedFault({ fault: 1 }, { fault: "b" }), "b");
  assert.equal(nominatedFault({}, { fault: null }), undefined);
  assert.equal(nominatedFault({}, undefined), undefined);
  assert.equal(nominatedFault({}, "s"), undefined);
});

test("cradleScript は lib と同じ置き場（cradle/scripts）の道具を指す", () => {
  const scripts = dirname(fileURLToPath(new URL("../.apm/skills/cradle/scripts/lib.mjs", import.meta.url)));
  for (const name of ["unslop-lint.mjs", "golden-check.mjs", "ddd-clean-check.mjs", "spec-query.mjs", "hook.mjs"]) {
    assert.equal(cradleScript(name), join(scripts, name));
    assert.ok(existsSync(cradleScript(name)), name);
  }
});

test("renameScaffold は Sprout・sprout・__PROJECT__・__PROJECT_LOWER__ をプロジェクト名に、__DOMAIN__ を一言（$ はそのまま）に置き換える", () => {
  const text = "Sprout.Main sprout __PROJECT__ __PROJECT_LOWER__\nプロダクト: __DOMAIN__\n";
  assert.equal(renameScaffold(text, { project: "MonoWa", domain: "  楽団の $1 と $& の管理 " }), "MonoWa.Main monowa MonoWa monowa\nプロダクト: 楽団の $1 と $& の管理\n");
  assert.equal(renameScaffold(text, { project: "MonoWa" }), `MonoWa.Main monowa MonoWa monowa\nプロダクト: ${PRODUCT_PLACEHOLDER}\n`);
  assert.equal(PRODUCT_PLACEHOLDER, "（一言で）");
});
