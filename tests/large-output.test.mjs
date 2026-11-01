import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree, commitAll } from "./helpers.mjs";

// 大きな出力をパイプ越しに読む: process.exit で終える道具は、パイプにまだ書いていない stdout を捨てて 64KB 前後で切れる。
// 出力はパイプの容量を大きく超え、1MB より小さく組む（1MB を超える出力は末尾の組: 道具が子の出力を読む上限の確かめ）。
// 1 回の大きな書き込み（--json）は runNode（spawnSync。hook や regen-impact と同じ読み方）でも切れる。行ごとの書き込みは読み手が速いと
// 書くそばから読まれて切れないので、slowRead で読み始めを遅らせ、子が書き終える前にパイプを埋める（| less などの遅い読み手）
const scripts = new URL("../.apm/skills/", import.meta.url);
const script = (p) => fileURLToPath(new URL(p, scripts));
const leanCheck = script("cradle/scripts/lean-check.mjs");
const goldenCheck = script("cradle/scripts/golden-check.mjs");
const refs = script("cradle/scripts/refs.mjs");
const regenImpact = script("cradle/scripts/regen-impact.mjs");
const specQuery = script("cradle/scripts/spec-query.mjs");
const contractCheck = script("api-contract/scripts/contract-check.mjs");
const flowsFromGolden = script("e2e-parity/scripts/flows-from-golden.mjs");
const ddd = script("ddd/scripts/ddd.mjs");
const dddCleanCheck = script("cradle/scripts/ddd-clean-check.mjs");

const big = (r) => assert.ok(r.stdout.length > 256 * 1024, `パイプ越しに読めたのが ${r.stdout.length} バイト（途中で切れたか、組んだ出力がパイプの容量を超えない）`);
/** 読み始めを 500ms 遅らせて子を走らせる。data は先に受けて pause で止める（子が先に終われば、パイプに残った分はそのとき読める）。 */
function slowRead(script, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [script, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.setEncoding("utf8"); p.stderr.setEncoding("utf8");
    p.stdout.on("data", d => { stdout += d; }); p.stderr.on("data", d => { stderr += d; });
    p.stdout.pause();
    setTimeout(() => p.stdout.resume(), 500);
    const kill = setTimeout(() => p.kill(), 20_000);
    p.on("error", reject);
    p.on("close", (status) => { clearTimeout(kill); resolve({ status, stdout, stderr }); });
  });
}
// 長い名前で 1 行・1 要素あたりのバイト数を稼ぐ（ファイル名の上限 255 バイトに収める）
const long = (i) => `N${"x".repeat(180)}${i}`;

test("lean-check --json は sorry が多くてもパイプ越しに全件の JSON を出し、1 で終わる", (t) => {
  const root = tempProject(t, "cradle-large-lean-check-");
  writeTree(root, { "lean/Example/Domain/A.lean": Array.from({ length: 2500 }, (_, i) => `theorem t${i} : True := sorry\n`).join("") });
  const r = runNode(leanCheck, ["--json"], { cwd: root, env: cleanEnv() });
  big(r);
  assert.equal(r.status, 1, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.sorry, 2500);
  assert.equal(j.findings.filter(f => f.rule === "sorry").length, 2500);
});

test("golden-check --json は golden が多くてもパイプ越しに全行の report を出す", (t) => {
  const root = tempProject(t, "cradle-large-golden-");
  // init の無い flow だけの golden は 1 本ごとに error の行になる（Lean も要らない）
  writeTree(root, Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`lean/golden/${long(i)}-flow.json`, JSON.stringify({ ok: { trace: [] } })])));
  const r = runNode(goldenCheck, ["--json", "--build", "never"], { cwd: root, env: cleanEnv() });
  big(r);
  assert.equal(r.status, 1, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(new Set(j.report.map(x => x.name)).size, 500);
});

test("contract-check --json は契約に無いコマンドが多くてもパイプ越しに全件の JSON を出し、1 で終わる", (t) => {
  const root = tempProject(t, "cradle-large-contract-");
  const commands = Array.from({ length: 2000 }, (_, i) => long(i));
  writeTree(root, {
    "documents/codebase/openapi.yaml": "openapi: 3.1.0\ninfo:\n  title: t\n  version: 0.0.1\npaths: {}\n",
    "meta.json": JSON.stringify({ project: "Example", commands, observations: [], views: { outlets: [] } }),
  });
  const r = runNode(contractCheck, ["--meta", "@meta.json", "--json"], { cwd: root, env: cleanEnv() });
  big(r);
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).commandsWithoutOp, commands);
});

test("refs は一致が多くても遅い読み手のパイプに全行と結びの行を出し、0 で終わる", async (t) => {
  const root = tempProject(t, "cradle-large-refs-");
  writeTree(root, { "documents/ddd/hotspots.md": Array.from({ length: 2000 }, (_, i) => `| HS-001 | ${long(i)} |\n`).join("") });
  commitAll(root);
  const r = await slowRead(refs, ["HS-001"], { cwd: root, env: cleanEnv() });
  big(r);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split("\n");
  assert.equal(lines[0], "HS-001: 2000 箇所");
  assert.equal(lines.filter(l => l.startsWith("  documents/ddd/hotspots.md:")).length, 2000);
  assert.match(r.stdout, /洗い直すこと。\n$/);
});

test("contract-skeleton は抽象メソッドが多くても遅い読み手のパイプに閉じ括弧まで出し、0 で終わる", async (t) => {
  const root = tempProject(t, "cradle-large-skeleton-");
  const file = "HugeContractTest.kt";
  writeTree(root, { [file]: `package p\n\nabstract class HugeContractTest {\n${Array.from({ length: 3000 }, (_, i) => `\tprotected abstract fun ${long(i)}(): Int\n`).join("")}}\n` });
  const r = await slowRead(script("cradle/scripts/contract-skeleton.mjs"), [file], { cwd: root, env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  big(r);
  assert.match(r.stdout, /override fun N.*2999\(\): Int = TODO\(.*\)\n\}\n+$/);
});

test("regen-impact --json は変わった生成シンボルが多くてもパイプ越しに全件の JSON を出す", (t) => {
  const root = tempProject(t, "cradle-large-regen-");
  commitAll(root);
  writeTree(root, { "backend/src/generated/kotlin-main/Big.kt": "package p\n\n" + Array.from({ length: 2000 }, (_, i) => `data class ${long(i)}(val x: Int)\n`).join("") });
  const r = runNode(regenImpact, ["--no-regen", "--no-golden", "--json"], { cwd: root, env: cleanEnv() });
  big(r);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).symbols.length, 2000);
});

test("flows-from-golden --check は対応の無い流れが多くてもパイプ越しに全件を出して 1 で終わり、台本の一覧には落ちない", async (t) => {
  const root = tempProject(t, "cradle-large-flows-");
  // 長い actor は --check の行（手ごとに actor を JSON で出す）を --json と同じ桁で太らせる
  const trace = Array.from({ length: 8 }, () => ({ actor: { user: { id: 1, name: "y".repeat(200) } }, command: { postNote: { title: "a" } }, state: {}, views: { notes: [] } }));
  writeTree(root, Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`lean/golden/${long(i)}-flow.json`, JSON.stringify({ ok: { trace } })])));
  const json = runNode(flowsFromGolden, ["--check", "--json"], { cwd: root, env: cleanEnv() });
  big(json);
  assert.equal(json.status, 1, json.stderr);
  assert.equal(JSON.parse(json.stdout).uncovered.length, 150);
  const text = await slowRead(flowsFromGolden, ["--check"], { cwd: root, env: cleanEnv() });
  big(text);
  assert.equal(text.status, 1, text.stderr);
  assert.equal(text.stdout.split("\n").filter(l => l.startsWith("  対応する台本が無い: ")).length, 150);
  assert.equal(text.stdout.split("\n").filter(l => /^ {4}\d+\. postNote by /.test(l)).length, 150 * 8);
  // 台本の一覧（既定の出力）の `# <名前>` の行は続かない
  assert.doesNotMatch(text.stdout, /^# /m);
});

test("spec-query print は #print の出力が大きくてもパイプ越しに全部を出し、lake の終了コードで終わる", (t) => {
  const root = tempProject(t, "cradle-large-print-");
  mkdirSync(join(root, "lean"), { recursive: true });
  const tools = join(root, "tools");
  mkdirSync(tools);
  // 偽の lake（`lake env lean <file>`）: 長い行を 2000 行出して終わる
  writeFileSync(join(tools, "lake"), `#!${process.execPath}\nfor (let i = 0; i < 2000; i++) process.stdout.write("${"y".repeat(180)}" + i + "\\n");\n`);
  chmodSync(join(tools, "lake"), 0o755);
  const r = runNode(specQuery, ["print", "Example.Runtime.Command", "--build", "never"], { cwd: root, env: cleanEnv({ PATH: tools }) });
  big(r);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout.split("\n").filter(Boolean).length, 2000);
});

test("spec-query run の ok でない応答は応答だけを出して 1 で終わる（要約に落ちない）", (t) => {
  const root = tempProject(t, "cradle-large-run-");
  const bin = join(root, "lean/.lake/build/bin");
  mkdirSync(bin, { recursive: true });
  const response = { error: "flow failed", detail: Array.from({ length: 2000 }, (_, i) => long(i)) };
  writeFileSync(join(bin, "example"), `#!${process.execPath}\nrequire("fs").readFileSync(0);\nprocess.stdout.write(${JSON.stringify(JSON.stringify(response))});\n`);
  chmodSync(join(bin, "example"), 0o755);
  const r = runNode(specQuery, ["run", "--scenario", "basic", "--commands", "[]", "--build", "never"], { cwd: root, env: cleanEnv() });
  big(r);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stderr, "");
  assert.deepEqual(JSON.parse(r.stdout), response);
});

// ddd start の後に n 本のファイルを lean/ に足して ddd end を走らせる。足したファイルは 1 つずつ ` A lean/<path>` の行になる
function dddEnd(t, n) {
  const root = tempProject(t, "cradle-large-ddd-");
  writeTree(root, {
    ...Object.fromEntries(["hotspots.md", "ux-review.md", "model-review.md"].map(f => [`documents/ddd/${f}`, `# ${f}\n`])),
    "documents/ddd/event-timeline.md": "# event-timeline.md\n\nプロダクト: テスト用の一言\n",
    "documents/ddd/ubiquitous-language.md": "# 用語集\n\n| 用語 | 英語 | 意味 |\n|---|---|---|\n",
    "lean/README.md": "# lean\n",
  });
  commitAll(root);
  const run = (...args) => runNode(ddd, args, { cwd: root, env: cleanEnv() });
  assert.equal(run("start").status, 0);
  writeTree(root, Object.fromEntries(Array.from({ length: n }, (_, i) => [`lean/${long(i)}.lean`, "def x := 1\n"])));
  return run("end", "--no-build");
}

test("ddd end は ddd-clean-check の大きな出力をパイプ越しに全部写し、その終了コードで終わる", (t) => {
  const r = dddEnd(t, 1500);
  big(r);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout.split("\n").filter(l => / A lean\/N/.test(l)).length, 1500);
  assert.match(r.stdout, /\n後片付けが残っています\n$/);
});

// 1MB を超える出力: 道具が子（ddd-clean-check・golden-check・spec-query meta・lake・git・再生成）の出力を spawnSync / execFileSync で読むと、
// 既定の maxBuffer（1MB）を超えたところで子が止まって途中で切れる。lib の CHILD_OUTPUT_MAX まで読んで、全部を出すか判定に使う
const huge = (r) => assert.ok(r.stdout.length > 1024 * 1024, `読めたのが ${r.stdout.length} バイト（1MB を超える出力を組めていないか、途中で切れた）`);

test("ddd end は ddd-clean-check の 1MB を超える出力を行の途中で切らずに全部出し、締めの行と検査の終了コード 1 で終わる", (t) => {
  const r = dddEnd(t, 7000);
  huge(r);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout.split("\n").filter(l => / A lean\/N/.test(l)).length, 7000);
  assert.match(r.stdout, /\n後片付けが残っています\n$/);
});

test("ベースライン無しの ddd-clean-check は HEAD との差分（git status）が 1MB を超えても OK と言わず、全部の行を出して 1 で終わる", (t) => {
  const root = tempProject(t, "cradle-large-clean-");
  writeTree(root, { "lean/README.md": "# lean\n" });
  commitAll(root);
  writeTree(root, Object.fromEntries(Array.from({ length: 7000 }, (_, i) => [`lean/${long(i)}.lean`, "def x := 1\n"])));
  const r = runNode(dddCleanCheck, [], { cwd: root, env: cleanEnv() });
  huge(r);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout.split("\n").filter(l => /^\?\? lean\/N/.test(l)).length, 7000);
  assert.match(r.stdout, /\n後片付けが残っています\n$/);
});

test("regen-impact は golden-check --json が 1MB を超えても golden 回帰を読む", (t) => {
  const root = tempProject(t, "cradle-large-regen-golden-");
  writeTree(root, Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`lean/golden/${long(i)}-flow.json`, JSON.stringify({ ok: { trace: [] } })])));
  commitAll(root);
  const r = runNode(regenImpact, ["--no-regen", "--json"], { cwd: root, env: cleanEnv() });
  huge(r);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  const { golden } = JSON.parse(r.stdout);
  assert.equal(golden.error, undefined);
  assert.equal(golden.failed, 1500);
  assert.equal(new Set(golden.report.map(x => x.name)).size, 1500);
});

test("regen-impact は再生成の出力が 1MB を超えても再生成を止めず、失敗と言わない", (t) => {
  const root = tempProject(t, "cradle-large-regen-out-", { project: "Example", backend: { regenerate: "yes y | head -c 2000000" } });
  writeTree(root, { "backend/README.md": "# backend\n" });
  commitAll(root);
  const r = runNode(regenImpact, ["--no-golden", "--json"], { cwd: root, env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.deepEqual(JSON.parse(r.stdout).changedGeneratedFiles, []);
});

test("contract-check は spec-query meta が 1MB を超えても読み切って照合する", (t) => {
  const root = tempProject(t, "cradle-large-contract-meta-");
  writeTree(root, {
    "documents/codebase/openapi.yaml": "openapi: 3.1.0\ninfo:\n  title: t\n  version: 0.0.1\npaths: {}\n",
    "lean/Example/Runtime/Scenarios.lean": "namespace Example.Runtime\ndef scenarioByName : String → Option Snapshot\n  | \"basic\" => some Scenario.basic\n  | _       => none\nend Example.Runtime\n",
    "lean/Example/Runtime/Json.lean": "",
  });
  const bin = join(root, "lean/.lake/build/bin");
  mkdirSync(bin, { recursive: true });
  // 偽の Lean CLI: init には空の state と views、ほかの cmd は知らない cmd と断る
  writeFileSync(join(bin, "example"), `#!${process.execPath}\nconst req = JSON.parse(require("fs").readFileSync(0, "utf8"));\nprocess.stdout.write(JSON.stringify(req.cmd === "init" ? { ok: { state: {}, views: {} } } : { error: "unknown cmd: " + req.cmd }));\n`);
  chmodSync(join(bin, "example"), 0o755);
  const tools = join(root, "tools");
  mkdirSync(tools);
  // 偽の lake（`lake env lean <file>`）: Command の #print は長い名前の構成子を 6000 個、ほかの #print は構成子 1 つの inductive を出す
  const commands = Array.from({ length: 6000 }, (_, i) => long(i));
  writeFileSync(join(tools, "lake"), `#!${process.execPath}
const commands = ${JSON.stringify(commands)};
for (const [, n] of require("fs").readFileSync(process.argv[4], "utf8").matchAll(/^#print (\\S+)$/gm)) {
  const ctors = n === "Example.Runtime.Command" ? commands : ["only"];
  process.stdout.write(\`inductive \${n} : Type\\nnumber of parameters: 0\\nconstructors:\\n\` + ctors.map(c => \`\${n}.\${c} : \${n}\\n\`).join(""));
}
`);
  chmodSync(join(tools, "lake"), 0o755);
  const r = runNode(contractCheck, ["--json"], { cwd: root, env: cleanEnv({ PATH: tools }) });
  huge(r);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stderr, "");
  assert.deepEqual(JSON.parse(r.stdout).commandsWithoutOp, commands);
});

test("mockup-build --meta-only は meta が 1MB を超えても meta.js に全部を書き、手元の絶対パスを持ち込まない", (t) => {
  const root = tempProject(t, "cradle-large-mockup-meta-");
  // meta の大きさは用語集で稼ぐ（長い英語候補を 6000 行）。spec-query の #print には偽の lake、CLI には偽の実行ファイルで答える
  const rows = Array.from({ length: 6000 }, (_, i) => `| 用語${i} | ${long(i)} | 説明 |`).join("\n");
  const tools = join(root, "tools");
  writeTree(root, {
    "documents/ddd/ubiquitous-language.md": `| 用語 | 英語候補 | 意味 |\n|---|---|---|\n${rows}\n`,
    "lean/Example/Runtime/Json.lean": "\n",
    "lean/.lake/build/bin/example": `#!${process.execPath}\nrequire("fs").readFileSync(0);\nprocess.stdout.write('{"error":"unknown scenario"}');\n`,
    "tools/lake": `#!${process.execPath}\n`,
  });
  chmodSync(join(root, "lean/.lake/build/bin/example"), 0o755);
  chmodSync(join(tools, "lake"), 0o755);
  const r = runNode(script("cradle/scripts/mockup-build.mjs"), ["--meta-only", "--build", "never"], { cwd: root, env: cleanEnv({ PATH: tools }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "lean/mockup/public/meta.js を作り直した\n");
  const text = readFileSync(join(root, "lean/mockup/public/meta.js"), "utf8");
  const head = "// GENERATED by cradle mockup-build — DO NOT EDIT\nglobalThis.CRADLE_META = ";
  assert.ok(text.startsWith(head) && text.endsWith(";\n"));
  huge({ stdout: text });
  const meta = JSON.parse(text.slice(head.length, -2));
  assert.equal(Object.keys(meta.glossary).length, 6000);
  assert.equal(meta.lean.bin, undefined);
  assert.ok(!text.includes(root), "meta.js に手元のパスが残っている");
});

test("mockup-build の meta.js は生成物の印を持ち、unslop --all は写した文言を人のコードとして測らない", (t) => {
  const root = tempProject(t, "cradle-mockup-meta-unslop-");
  const tools = join(root, "tools");
  writeTree(root, {
    "documents/ddd/ubiquitous-language.md": "| 用語 | 英語候補 | 意味 |\n|---|---|---|\n| 握りつぶし | catch (e) {} | 説明 |\n",
    "lean/Example/Runtime/Json.lean": "\n",
    "lean/.lake/build/bin/example": `#!${process.execPath}\nrequire("fs").readFileSync(0);\nprocess.stdout.write('{"error":"unknown scenario"}');\n`,
    "tools/lake": `#!${process.execPath}\n`,
  });
  chmodSync(join(root, "lean/.lake/build/bin/example"), 0o755);
  chmodSync(join(tools, "lake"), 0o755);
  const env = cleanEnv({ PATH: tools });
  const r = runNode(script("cradle/scripts/mockup-build.mjs"), ["--meta-only", "--build", "never"], { cwd: root, env });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(readFileSync(join(root, "lean/mockup/public/meta.js"), "utf8").includes("catch(e){}"));
  const lint = runNode(script("cradle/scripts/unslop-lint.mjs"), ["--all"], { cwd: root, env });
  assert.doesNotMatch(lint.stdout, /meta\.js/);
});

test("lean-check --build は lake build の出力が 1MB を超えても、通ったビルドを失敗と言わない", (t) => {
  const root = tempProject(t, "cradle-large-lake-build-");
  writeTree(root, { "lean/Example/Domain/A.lean": "theorem t : True := trivial\n" });
  const tools = join(root, "tools");
  mkdirSync(tools);
  // 偽の lake（`lake build`）: 長い行を 7000 行出して 0 で終わる
  writeFileSync(join(tools, "lake"), `#!${process.execPath}\nfor (let i = 0; i < 7000; i++) process.stdout.write("${"y".repeat(180)}" + i + "\\n");\n`);
  chmodSync(join(tools, "lake"), 0o755);
  const r = runNode(leanCheck, ["--build", "--json"], { cwd: root, env: cleanEnv({ PATH: tools }) });
  assert.equal(r.stderr, "");
  assert.equal(JSON.parse(r.stdout).build, "ok");
});

test("spec-query print は #print の出力が 1MB を超えても全部を出し、0 で終わる", (t) => {
  const root = tempProject(t, "cradle-large-print-huge-");
  mkdirSync(join(root, "lean"));
  const tools = join(root, "tools");
  mkdirSync(tools);
  writeFileSync(join(tools, "lake"), `#!${process.execPath}\nfor (let i = 0; i < 7000; i++) process.stdout.write("${"y".repeat(180)}" + i + "\\n");\n`);
  chmodSync(join(tools, "lake"), 0o755);
  const r = runNode(specQuery, ["print", "Example.Runtime.Command", "--build", "never"], { cwd: root, env: cleanEnv({ PATH: tools }) });
  huge(r);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout.split("\n").filter(Boolean).length, 7000);
});

test("refs は git grep の一致が 1MB を超えても全行と結びの行を出し、0 で終わる", (t) => {
  const root = tempProject(t, "cradle-large-refs-huge-");
  writeTree(root, { "documents/ddd/hotspots.md": Array.from({ length: 7000 }, (_, i) => `| HS-001 | ${long(i)} |\n`).join("") });
  commitAll(root);
  const r = runNode(refs, ["HS-001"], { cwd: root, env: cleanEnv() });
  huge(r);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split("\n")[0], "HS-001: 7000 箇所");
  assert.match(r.stdout, /洗い直すこと。\n$/);
});
