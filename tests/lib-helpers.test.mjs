// lib.mjs の小道具（複数の道具が共有する読み方・数え方）の単体テスト。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, chmodSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tempDir, writeTree } from "./helpers.mjs";
import { sha256, walk, leanSnapshot, readableEntries, ports, readText, DDD_FILES, countEvents, countStatusRows,
  goldenDirOf, goldenFlowFiles, stepOutcome, nominatedFault, cradleScript, renameScaffold, PRODUCT_PLACEHOLDER, findProjectRoot, loadConfig, aiNoteProblems, headerUsage, leanEval, contractTestWiring, goldenRowLines } from "../.apm/skills/cradle/scripts/lib.mjs";

test("sha256 は文字列と同じ中身の Buffer に同じ 16 進を返す", () => {
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256(Buffer.from("探索", "utf8")), sha256("探索"));
  assert.equal(sha256(""), createHash("sha256").update("").digest("hex"));
});

const lock = "user@host.1:2";
test("walk は Emacs のロックファイルだけを飛ばす。ほかの壊れたリンク・輪は投げ、検査の対象を黙って消さない", (t) => {
  const root = tempDir(t, "cradle-walk-");
  writeTree(root, { "a.md": "", ".#real.md": "" });
  symlinkSync(lock, join(root, ".#a.md"));
  // 同じ名前の形でも、実在するファイルは読む
  assert.deepEqual(walk(root), [join(root, ".#real.md"), join(root, "a.md")]);
  const broken = tempDir(t, "cradle-walk-");
  symlinkSync("/nowhere/gone.md", join(broken, "gone.md"));
  assert.throws(() => walk(broken), { code: "ENOENT" });
  const loop = tempDir(t, "cradle-walk-");
  writeTree(loop, { "sub/b.md": "" });
  symlinkSync("..", join(loop, "sub", "up"));
  assert.throws(() => walk(loop), { code: "ELOOP" });
});

test("walk は実行権の無いディレクトリで投げ、下のファイルを黙って消さない", { skip: process.getuid?.() === 0 }, (t) => {
  const root = tempDir(t, "cradle-walk-");
  writeTree(root, { "d/a.md": "" });
  chmodSync(join(root, "d"), 0o600);
  try {
    assert.throws(() => walk(root), { code: "EACCES" });
    assert.throws(() => leanSnapshot({ lean: { rootDir: root } }), { code: "EACCES" });
  } finally { chmodSync(join(root, "d"), 0o700); }
});

test("walk はリンクのディレクトリも読み、木の中を指すものは両方のパスで返す（パスで判定する道具が別名を見失わない）", (t) => {
  const root = tempDir(t, "cradle-walk-");
  writeTree(root, { "real/x.md": "" });
  symlinkSync("real", join(root, "z-link"));
  assert.deepEqual(walk(root), [join(root, "real", "x.md"), join(root, "z-link", "x.md")]);
});

test("leanSnapshot は Emacs のロックファイルを数えない", (t) => {
  const root = tempDir(t, "cradle-walk-");
  writeTree(root, { "lean/A.lean": "x" });
  const cfg = { lean: { rootDir: join(root, "lean") } };
  const before = leanSnapshot(cfg);
  symlinkSync(lock, join(root, "lean", ".#A.lean"));
  assert.deepEqual(leanSnapshot(cfg), before);
});

test("readableEntries は Emacs のロックファイルだけを除く。ports と goldenFlowFiles はそれを通す", (t) => {
  const root = tempDir(t, "cradle-walk-");
  writeTree(root, { "golden/a-flow.json": "{}", "golden/.#real-flow.json": "{}", "Model/Application/Port/Directory/Find.lean": "" });
  symlinkSync(lock, join(root, "golden", ".#b-flow.json"));
  assert.deepEqual(readableEntries(join(root, "golden")).sort(), [".#real-flow.json", "a-flow.json"]);
  assert.deepEqual(goldenFlowFiles(join(root, "golden")), [".#real-flow.json", "a-flow.json"]);
  // ほかの壊れたリンクは残す（読む道具が golden を読めないと言う）
  symlinkSync("/nowhere/gone.json", join(root, "golden", "gone-flow.json"));
  assert.ok(goldenFlowFiles(join(root, "golden")).includes("gone-flow.json"));
  const port = join(root, "Model/Application/Port");
  symlinkSync(lock, join(port, ".#x"));
  symlinkSync(lock, join(port, "Directory", ".#Find.lean"));
  const found = ports({ lean: { modelDir: join(root, "Model"), root: "Model" } });
  assert.deepEqual(found.map(p => [p.name, p.operations.map(o => o.name)]), [["Directory", ["Find"]]]);
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
  for (const name of ["unslop-lint.mjs", "golden-check.mjs", "ddd-clean-check.mjs", "spec-query.mjs", "hook.mjs", "doctor.mjs", "refs.mjs", "contract-skeleton.mjs"]) {
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

test("headerUsage は shebang の次から続くコメント行を `// ` を外して返し、コードの後の本文のコメントは含めない", (t) => {
  const root = tempDir(t, "cradle-usage-");
  writeTree(root, { "tool.mjs": "#!/usr/bin/env node\n// tool — 一行の説明。\n//   tool run [--json]\n//\n// 続きの説明\nimport x from \"y\";\n// 本文のコメント\n  // 字下げしたコメント\n" });
  assert.equal(headerUsage(pathToFileURL(join(root, "tool.mjs")).href), "tool — 一行の説明。\n  tool run [--json]\n\n続きの説明");
  // 先頭の 1 行は shebang として読み飛ばす（コメントでも使い方に入れない）
  writeTree(root, { "plain.mjs": "// 1 行目\n// 2 行目\n" });
  assert.equal(headerUsage(pathToFileURL(join(root, "plain.mjs")).href), "2 行目");
});

test("leanEval は評価が終わらなかった理由を error に返す — lake が無い・時間切れ・signal で止まった。終われば undefined", (t) => {
  const root = tempDir(t, "cradle-lean-eval-");
  const bin = join(root, "bin");
  // 偽の lake: 本文を引数で選ぶ（PATH は bin だけなので shebang は node の絶対パス）
  const lake = (body) => { writeTree(root, { "bin/lake": `#!${process.execPath}\n${body}\n` }); chmodSync(join(bin, "lake"), 0o755); };
  const path = process.env.PATH;
  t.after(() => { process.env.PATH = path; });
  process.env.PATH = bin;
  const cfg = { lean: { rootDir: root } };
  writeTree(root, { "bin/.keep": "" });
  assert.match(leanEval(cfg, "#print X\n").error, /ENOENT/);
  lake(`process.stdout.write("printed " + require("fs").readFileSync(process.argv[4], "utf8"))`);
  assert.deepEqual(leanEval(cfg, "#print X\n"), { status: 0, stdout: "printed #print X\n", stderr: "", error: undefined });
  lake("setTimeout(() => {}, 10000)");
  const slow = leanEval(cfg, "", { timeoutMs: 300 });
  assert.equal(slow.status, null);
  assert.match(slow.error, /ETIMEDOUT/);
  lake(`process.kill(process.pid, "SIGKILL")`);
  assert.deepEqual(leanEval(cfg, ""), { status: null, stdout: "", stderr: "", error: "killed by SIGKILL" });
});

test("findProjectRoot と loadConfig はルートを指す変数を渡された env から読み、空の env なら cradle.json を持つ祖先と root の cradle.json だけで決める", (t) => {
  const root = tempDir(t, "cradle-root-env-");
  writeTree(root, { "a/cradle.json": JSON.stringify({ project: "A" }), "a/b/c/.keep": "", "x/cradle.json": JSON.stringify({ project: "X" }) });
  const start = join(root, "a/b/c");
  assert.equal(findProjectRoot(start, {}), join(root, "a"));
  assert.equal(findProjectRoot(start, { CLAUDE_PROJECT_DIR: join(root, "x") }), join(root, "x"));
  assert.equal(findProjectRoot(start, { CRADLE_PROJECT_DIR: join(root, "a/b"), CLAUDE_PROJECT_DIR: join(root, "x") }), join(root, "a/b"));
  assert.equal(loadConfig(join(root, "a"), {}).project, "A");
  assert.equal(loadConfig(join(root, "a"), { CRADLE_CONFIG: join(root, "x/cradle.json") }).project, "X");
});

test("loadConfig は配列のキーに書いた文字列 1 つを 1 要素の配列として読み、配列・既定値・書いていないキーはそのまま、cradle.json の中身（raw）は書き換えない", (t) => {
  const root = tempDir(t, "cradle-config-lists-");
  const unslop = { disable: "empty-catch", extraHedges: "ほげ", ignorePaths: "tmp/**", skipFiles: "vendor/**" };
  writeTree(root, { "cradle.json": JSON.stringify({
    project: "Example", protected: "owners/**",
    lean: { entityImportAllow: "Application/View.lean", forbiddenMentions: "Kotlin" },
    backend: { generated: "api/out" }, frontend: { generated: "web/out" },
    api: { outletsWithoutEndpoint: "dashboard" }, infra: { containers: "app-local" }, unslop,
  }) });
  const cfg = loadConfig(root, {});
  assert.deepEqual([cfg.protected, cfg.backend.generated, cfg.frontend.generated], [["owners/**"], ["api/out"], ["web/out"]]);
  assert.deepEqual([cfg.lean.entityImportAllow, cfg.lean.forbiddenMentions, cfg.api.outletsWithoutEndpoint, cfg.infra.containers], [["Application/View.lean"], ["Kotlin"], ["dashboard"], ["app-local"]]);
  assert.deepEqual(cfg.unslop, { disable: ["empty-catch"], extraHedges: ["ほげ"], ignorePaths: ["tmp/**"], skipFiles: ["vendor/**"] });
  assert.deepEqual(cfg.raw.unslop, unslop);
  writeTree(root, { "cradle.json": JSON.stringify({ project: "Example", protected: ["a/**", "b/**"], unslop: { disable: [] } }) });
  const plain = loadConfig(root, {});
  assert.deepEqual([plain.protected, plain.backend.generated, plain.frontend.generated, plain.lean.forbiddenMentions], [["a/**", "b/**"], ["backend/src/generated"], ["frontend/src/api/generated"], ["Lean2Kotlin"]]);
  assert.deepEqual([plain.infra.containers, plain.unslop], [undefined, { disable: [] }]);
});

test("aiNoteProblems は ai-notes の下のノートの名前と冒頭 800 字の断りを見て、README.md・TEMPLATE.md（末尾の一致）と ai-notes の外は null を返す", () => {
  const dir = "documents/ai-notes";
  const header = "> **これは規約ではありません。**\n";
  assert.deepEqual(aiNoteProblems(dir, `${dir}/20260101-01-topic.md`, header), { name: "20260101-01-topic.md", badName: false, noHeader: false });
  assert.deepEqual(aiNoteProblems(dir, `${dir}/memo.md`, "# 件名\n"), { name: "memo.md", badName: true, noHeader: true });
  assert.deepEqual(aiNoteProblems(dir, `${dir}/sub/20260101-01-topic.md`, header), { name: "sub/20260101-01-topic.md", badName: true, noHeader: false });
  assert.equal(aiNoteProblems(dir, `${dir}/20260101-01-Topic.md`, header).badName, true);
  // 拡張子の絞り込みは呼ぶ側。ここに来た .yaml は名前の規則に合わない
  assert.equal(aiNoteProblems(dir, `${dir}/20260101-01-topic.yaml`, header).badName, true);
  // 読めない（null）なら断りは問わない
  assert.equal(aiNoteProblems(dir, `${dir}/memo.md`, null).noHeader, false);
  assert.equal(aiNoteProblems(dir, `${dir}/20260101-01-topic.md`, "x".repeat(791) + "規約ではありません").noHeader, false);
  assert.equal(aiNoteProblems(dir, `${dir}/20260101-01-topic.md`, "x".repeat(792) + "規約ではありません").noHeader, true);
  for (const p of [`${dir}/README.md`, `${dir}/TEMPLATE.md`, `${dir}/sub/X-README.md`, `${dir}-old/memo.md`, "documents/memo.md", dir]) assert.equal(aiNoteProblems(dir, p, "# 件名\n"), null, p);
});

test("contractTestWiring は `: <名前>(` の継承を、Adapter の適合テストは src/adapterTest に、ほかの契約テストは src/test にだけ探す", (t) => {
  const root = tempDir(t, "cradle-wiring-");
  writeTree(root, {
    "cradle.json": JSON.stringify({ project: "Example" }),
    "backend/src/test/kotlin/p/Impls.kt": "class A : BookRepositoryContractTest() {\n}\nclass B :LoanContractTest (\n) {}\nval x: OtherContractTest = y\nclass C : MailAdapterContractTest()\n",
    "backend/src/adapterTest/kotlin/p/DirectoryImpl.kt": "class D : DirectoryAdapterContractTest() {\n}\nclass E : CartContractTest()\n",
    // src/main からは test のソースセットの抽象テストが見えないので、同じ形でも配線ではない
    "backend/src/main/kotlin/p/Wrong.kt": "class F : MainOnlyContractTest()\n",
  });
  const cfg = loadConfig(root, {});
  const names = ["BookRepositoryContractTest", "LoanContractTest", "OtherContractTest", "MissingContractTest", "MailAdapterContractTest", "DirectoryAdapterContractTest", "CartContractTest", "MainOnlyContractTest"];
  assert.deepEqual(contractTestWiring(cfg, names).map(w => [w.name, w.adapter, w.wired]), [
    ["BookRepositoryContractTest", false, true], ["LoanContractTest", false, true], ["OtherContractTest", false, false], ["MissingContractTest", false, false],
    ["MailAdapterContractTest", true, false], ["DirectoryAdapterContractTest", true, true], ["CartContractTest", false, false], ["MainOnlyContractTest", false, false],
  ]);
  assert.deepEqual(contractTestWiring(cfg, []), []);
});

test("goldenRowLines は golden-check の report の 1 行を状態ごとの言い方にし、changed は食い違いを 1 つ 1 行で続け、observation の手には接頭辞を付ける", () => {
  assert.deepEqual(goldenRowLines({ name: "a", kind: "init", status: "ok" }), ["ok       a-init"]);
  assert.deepEqual(goldenRowLines({ name: "a", kind: "flow", status: "updated", diffs: 3 }), ["updated  a-flow (3 diffs)"]);
  assert.deepEqual(goldenRowLines({ name: "b", status: "skipped", reason: "r" }), ["skipped  b: r"]);
  assert.deepEqual(goldenRowLines({ name: "c", kind: "chain", status: "error", reason: "boom" }), ["error    c-chain: boom"]);
  assert.deepEqual(goldenRowLines({ name: "c", status: "error", reason: "boom" }), ["error    c: boom"]);
  const diffs = [{ path: "/ok/trace/1/state", expected: { n: 1 }, actual: "x" }, { path: "/ok/env", expected: null, actual: [1] }];
  assert.deepEqual(goldenRowLines({ name: "d", kind: "flow", status: "changed", firstDivergence: "/ok/trace/1/state", step: 2, command: "tick", inputKind: "observation", diffs }), [
    "CHANGED  d-flow: first divergence at /ok/trace/1/state (step #2 observation tick)",
    '           /ok/trace/1/state: expected {"n":1} / actual "x"',
    "           /ok/env: expected null / actual [1]",
  ]);
  // 手でない食い違い（step 無し）は括弧を付けず、command の手には接頭辞を付けない
  assert.deepEqual(goldenRowLines({ name: "e", kind: "init", status: "changed", firstDivergence: "/ok/views", diffs: [] }), ["CHANGED  e-init: first divergence at /ok/views"]);
  assert.deepEqual(goldenRowLines({ name: "e", kind: "chain", status: "changed", firstDivergence: "/ok/trace/0", step: 1, command: "post", inputKind: "command", diffs: [] }), ["CHANGED  e-chain: first divergence at /ok/trace/0 (step #1 post)"]);
});
