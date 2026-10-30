import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree, commitAll } from "./helpers.mjs";

// 大きな出力をパイプ越しに読む: process.exit で終える道具は、パイプにまだ書いていない stdout を捨てて 64KB 前後で切れる。
// 出力はパイプの容量を大きく超え、spawnSync の maxBuffer（1MB）より小さく組む。
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

test("ddd end は ddd-clean-check の大きな出力をパイプ越しに全部写し、その終了コードで終わる", (t) => {
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
  // start の後に足したファイルは 1 つずつ ` A lean/<path>` の行になる
  writeTree(root, Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`lean/${long(i)}.lean`, "def x := 1\n"])));
  const r = run("end", "--no-build");
  big(r);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout.split("\n").filter(l => / A lean\/N/.test(l)).length, 1500);
  assert.match(r.stdout, /\n後片付けが残っています\n$/);
});
