import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, tempProject, cleanEnv, runNode } from "./helpers.mjs";

const specQuery = fileURLToPath(new URL("../.apm/skills/cradle/scripts/spec-query.mjs", import.meta.url));
const contractCheck = fileURLToPath(new URL("../.apm/skills/api-contract/scripts/contract-check.mjs", import.meta.url));

// 偽の Lean CLI: canned.json から cmd（external なら external:<action>）で引いた応答を返す
const fakeCli = `#!${process.execPath}
const fs = require("fs"); const path = require("path");
const req = JSON.parse(fs.readFileSync(0, "utf8"));
const canned = JSON.parse(fs.readFileSync(path.join(__dirname, "canned.json"), "utf8"));
const key = req.cmd === "external" ? "external:" + req.action : req.cmd;
process.stdout.write(JSON.stringify(canned[key] ?? { error: "unknown cmd: " + req.cmd }));
`;

const scenariosLean = `namespace Example.Runtime
def scenarioByName : String → Option Snapshot
  | "basic" => some Scenario.basic
  | "other" => some Scenario.other
  | _       => none

def environmentByName : String → Option Environment
  | "paymentAuthorized" => some Environment.paymentAuthorized
  | "paymentLost"       => some Environment.paymentLost
  | _                   => none
end Example.Runtime
`;

// 偽の lake（`lake env lean <file>`）: ファイルの #print ごとに構成子 1 つ（only）の inductive を出す
const fakeLake = `#!${process.execPath}
const src = require("fs").readFileSync(process.argv[4], "utf8");
for (const m of src.matchAll(/^#print (\\S+)$/gm)) process.stdout.write(\`inductive \${m[1]} : Type\\nnumber of parameters: 0\\nconstructors:\\n\${m[1]}.only : \${m[1]}\\n\`);
`;

// 一時プロジェクト: Runtime/Scenarios.lean と空の Runtime/Json.lean、偽の CLI。PATH を空にして lake（#print）を呼べなくする —
// meta の commands / errors は空で理由は evalErrors に返り、CLI の問い合わせ（views の口・external の版）だけが偽の CLI に届く。
// run.raw は子プロセスの結果そのまま、run.lake() は PATH に偽の lake を置く
function fixture(t, canned) {
  const root = tempProject(t, "cradle-spec-query-");
  const runtime = join(root, "lean/Example/Runtime");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, "Scenarios.lean"), scenariosLean);
  writeFileSync(join(runtime, "Json.lean"), "");
  const bin = join(root, "lean/.lake/build/bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "example"), fakeCli);
  chmodSync(join(bin, "example"), 0o755);
  writeFileSync(join(bin, "canned.json"), JSON.stringify(canned));
  const noTools = join(root, "no-tools");
  mkdirSync(noTools);
  const env = cleanEnv({ PATH: noTools });
  const raw = (...args) => runNode(specQuery, [...args, "--build", "never"], { cwd: root, env });
  const run = (...args) => {
    const r = raw(...args);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout);
  };
  const lake = (script = fakeLake) => { writeFileSync(join(noTools, "lake"), script); chmodSync(join(noTools, "lake"), 0o755); };
  return Object.assign(run, { raw, root, lake });
}

// 偽の lake: decls に書いた宣言の #print の出力を返し（書いていない名前は fakeLake と同じ構成子 1 つの inductive）、kill の宣言を #print する回は
// SIGKILL で止まる（時間切れ・signal の代わり）。構成子の #print とペイロードの #print は別の `lake env lean` なので、構成子だけが通る。before は #print より先に走る行
const scriptedLake = (decls, { kill = [], before = "" } = {}) => `#!${process.execPath}
${before}
const names = [...require("fs").readFileSync(process.argv[4], "utf8").matchAll(/^#print (\\S+)$/gm)].map(m => m[1]);
if (names.some(n => ${JSON.stringify(kill)}.includes(n))) process.kill(process.pid, "SIGKILL");
const decls = ${JSON.stringify(decls)};
for (const n of names) process.stdout.write(decls[n] ?? \`inductive \${n} : Type\\nnumber of parameters: 0\\nconstructors:\\n\${n}.only : \${n}\\n\`);
`;

const init = { ok: { state: { notes: [] }, views: { notes: [] } } };

test("scenarios はシナリオ名の配列、environments は名前付きの環境の配列を出す", (t) => {
  const run = fixture(t, { init });
  assert.deepEqual(run("scenarios"), ["basic", "other"]);
  assert.deepEqual(run("environments"), ["paymentAuthorized", "paymentLost"]);
});

test("meta の external は CLI への問い合わせで決まる — 未知の cmd と断る実行器なら null、応じる実行器なら version 1", (t) => {
  const legacy = fixture(t, { init });
  const m = legacy("meta");
  assert.deepEqual({ scenarios: m.scenarios, environments: m.environments, external: m.external, views: m.views.outlets }, { scenarios: ["basic", "other"], environments: ["paymentAuthorized", "paymentLost"], external: null, views: ["notes"] });
  const current = fixture(t, { init, "external:views": { error: "external views requires state" } });
  assert.deepEqual(current("meta").external, { version: 1 });
});

test("lake を起動できなければ #print の失敗を空の一覧で済ませない — commands は error、meta は末尾の evalErrors（0 のまま）、print は理由と 1", (t) => {
  const run = fixture(t, { init });
  const commands = run("commands");
  assert.deepEqual(commands.constructors, []);
  assert.match(commands.error, /lake/);
  const m = run("meta");
  assert.equal(Object.keys(m).at(-1), "evalErrors");
  // Runtime/Observation.lean の無い置き場は観測を #print しない
  assert.deepEqual(Object.keys(m.evalErrors), ["commands", "errors"]);
  assert.match(m.evalErrors.commands, /lake/);
  assert.deepEqual({ commands: m.commands, errors: m.errors, views: m.views.outlets }, { commands: [], errors: [], views: ["notes"] });
  const print = run.raw("print", "Example.Runtime.Command");
  assert.equal(print.status, 1);
  assert.equal(print.stdout, "");
  assert.match(print.stderr, /^cradle: `lake env lean` で評価できない: .*lake/m);
  writeFileSync(join(run.root, "lean/Example/Runtime/Observation.lean"), "");
  assert.deepEqual(Object.keys(run("meta").evalErrors), ["commands", "observations", "errors"]);
  // #print が通れば evalErrors の鍵ごと出さない
  run.lake();
  const ok = run("meta");
  assert.deepEqual({ commands: ok.commands, observations: ok.observations, errors: ok.errors, last: Object.keys(ok).at(-1) }, { commands: ["only"], observations: ["only"], errors: ["only"], last: "observationSchemas" });
  assert.equal(run.raw("print", "Example.Runtime.Command").status, 0);
});

test("ペイロードの #print が評価しきれなければ入力の形を「構造体でない」で済ませない — 構成子の error、meta の evalErrors.schemas、schemas は 1", (t) => {
  const run = fixture(t, { init });
  const decls = {
    "Example.Runtime.Command": "inductive Example.Runtime.Command : Type\nnumber of parameters: 0\nconstructors:\nExample.Runtime.Command.postNote : Example.PostNote → Example.Runtime.Command\nExample.Runtime.Command.ping : Example.Runtime.Command\n",
    "Example.Runtime.Observation": "inductive Example.Runtime.Observation : Type\nnumber of parameters: 0\nconstructors:\nExample.Runtime.Observation.paid : Example.Paid → Example.Runtime.Observation\n",
    "Example.PostNote": "structure Example.PostNote : Type\nnumber of parameters: 0\nfields:\n  Example.PostNote.slot : Example.Slot\nconstructor:\n  Example.PostNote.mk : Example.Slot → Example.PostNote\n",
    "Example.Paid": "structure Example.Paid : Type\nnumber of parameters: 0\nfields:\n  Example.Paid.amount : Nat\nconstructor:\n  Example.Paid.mk : Nat → Example.Paid\n",
    "Example.Slot": "structure Example.Slot : Type\nnumber of parameters: 0\nfields:\n  Example.Slot.at : Example.Date\nconstructor:\n  Example.Slot.mk : Example.Date → Example.Slot\n",
  };
  // 全部通れば error も evalErrors も無く 0
  run.lake(scriptedLake(decls));
  const okSchemas = run.raw("schemas");
  assert.equal(okSchemas.status, 0, okSchemas.stderr);
  assert.deepEqual(JSON.parse(okSchemas.stdout), { postNote: { type: "Example.PostNote", fields: [{ name: "slot", type: "Example.Slot", optional: false, kind: "object", fields: [{ name: "at", type: "Example.Date", optional: false, kind: "date" }] }] }, ping: { fields: [] } });
  assert.equal(run("meta").evalErrors, undefined);
  // ペイロードが構造体でないのは評価の失敗ではない（fields: null で error は無い）
  run.lake(scriptedLake({ ...decls, "Example.PostNote": "inductive Example.PostNote : Type\nnumber of parameters: 0\nconstructors:\nExample.PostNote.a : Nat → Example.PostNote\n" }));
  assert.deepEqual(run("schemas").postNote, { type: "Example.PostNote", fields: null });
  // ペイロードの #print が止まった: その構成子に理由、引数の無い構成子はそのまま、schemas は写像を出して 1
  run.lake(scriptedLake(decls, { kill: ["Example.PostNote"] }));
  const killed = run.raw("schemas");
  assert.equal(killed.status, 1);
  assert.deepEqual(JSON.parse(killed.stdout), { postNote: { type: "Example.PostNote", fields: null, error: "#print を評価できない: killed by SIGKILL" }, ping: { fields: [] } });
  assert.equal(killed.stderr, "cradle: #print を評価できない: killed by SIGKILL\n");
  const m = run("meta");
  assert.deepEqual({ evalErrors: m.evalErrors, last: Object.keys(m).at(-1), commands: m.commands }, { evalErrors: { schemas: "killed by SIGKILL" }, last: "evalErrors", commands: ["postNote", "ping"] });
  assert.equal(m.schemas.postNote.error, "#print を評価できない: killed by SIGKILL");
  // 1 段展開する値オブジェクトの #print が止まった: 欄は json に落ち、その構成子に理由
  run.lake(scriptedLake(decls, { kill: ["Example.Slot"] }));
  const partial = run.raw("schemas");
  assert.equal(partial.status, 1);
  assert.deepEqual(JSON.parse(partial.stdout).postNote, { type: "Example.PostNote", fields: [{ name: "slot", type: "Example.Slot", optional: false, kind: "json" }], error: "#print を評価できない: killed by SIGKILL" });
  assert.deepEqual(run("meta").evalErrors, { schemas: "killed by SIGKILL" });
  // 内部入力のペイロードは observationSchemas の鍵で
  writeFileSync(join(run.root, "lean/Example/Runtime/Observation.lean"), "");
  run.lake(scriptedLake(decls, { kill: ["Example.Paid"] }));
  const obs = run("meta");
  assert.deepEqual(obs.evalErrors, { observationSchemas: "killed by SIGKILL" });
  assert.deepEqual(obs.observationSchemas, { paid: { type: "Example.Paid", fields: null, error: "#print を評価できない: killed by SIGKILL" } });
});

test("meta はバイナリが無ければ lake build のあとに構成子と入力の形を #print する（build 前の import の失敗を evalErrors にしない）", (t) => {
  const run = fixture(t, { init });
  const bin = join(run.root, "lean/.lake/build/bin/example");
  const cli = readFileSync(bin, "utf8");
  rmSync(bin);
  writeFileSync(join(run.root, "lean/Example/Runtime/Observation.lean"), "");
  // lake build が CLI を置くまで、`lake env lean` は import できずに 1 で終わる
  const before = `const fs = require("fs");
if (process.argv[2] === "build") { fs.writeFileSync(${JSON.stringify(bin)}, ${JSON.stringify(cli)}, { mode: 0o755 }); process.exit(0); }
if (!fs.existsSync(${JSON.stringify(bin)})) { process.stdout.write("error: unknown module prefix 'Example'\\n"); process.exit(1); }`;
  run.lake(scriptedLake({
    "Example.Runtime.Command": "inductive Example.Runtime.Command : Type\nnumber of parameters: 0\nconstructors:\nExample.Runtime.Command.postNote : Example.PostNote → Example.Runtime.Command\n",
    "Example.Runtime.Observation": "inductive Example.Runtime.Observation : Type\nnumber of parameters: 0\nconstructors:\nExample.Runtime.Observation.paid : Example.Paid → Example.Runtime.Observation\n",
    "Example.PostNote": "structure Example.PostNote : Type\nnumber of parameters: 0\nfields:\n  Example.PostNote.title : String\n",
    "Example.Paid": "structure Example.Paid : Type\nnumber of parameters: 0\nfields:\n  Example.Paid.amount : Nat\n",
  }, { before }));
  const env = cleanEnv({ PATH: join(run.root, "no-tools") });
  const r = runNode(specQuery, ["meta"], { cwd: run.root, env });
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.deepEqual({ commands: m.commands, observations: m.observations, errors: m.errors, schemas: m.schemas, observationSchemas: m.observationSchemas, evalErrors: m.evalErrors },
    { commands: ["postNote"], observations: ["paid"], errors: ["only"], schemas: { postNote: { type: "Example.PostNote", fields: [{ name: "title", type: "String", optional: false, kind: "text" }] } },
      observationSchemas: { paid: { type: "Example.Paid", fields: [{ name: "amount", type: "Nat", optional: false, kind: "number" }] } }, evalErrors: undefined });
  // 新しい checkout の 1 回目の contract-check（--meta 無し）も、build 前の観測の #print の失敗を「評価しきれていない」の 2 にしない
  rmSync(bin);
  mkdirSync(join(run.root, "documents/codebase"), { recursive: true });
  writeFileSync(join(run.root, "documents/codebase/openapi.yaml"), "openapi: 3.1.0\ninfo:\n  title: t\n  version: 0.0.1\npaths:\n  /notes:\n    get:\n      operationId: notes\n    post:\n      operationId: postNote\n      x-cradle-kind: command\n      x-cradle-model: Example.Runtime.Command.postNote\n");
  const cc = runNode(contractCheck, [], { cwd: run.root, env });
  assert.equal(cc.status, 0, cc.stdout + cc.stderr);
});

test("lake を起動できなければ schemas は空の写像と構成子の #print の理由で 1（入力の無いモデルと読ませない）", (t) => {
  const run = fixture(t, { init });
  const r = run.raw("schemas");
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "{}\n");
  assert.match(r.stderr, /^cradle: #print を評価できない: .*lake/);
});

test("使い方は先頭のコメントだけを出し、プロジェクトの外でも引ける（コマンド無しは 0、知らないコマンドは 1）。知っているコマンドは設定を読む", (t) => {
  const outside = tempDir(t, "cradle-spec-query-usage-");
  const run = (...args) => runNode(specQuery, args, { cwd: outside, env: cleanEnv() });
  const usage = run();
  assert.equal(usage.status, 0, usage.stderr);
  assert.equal(usage.stderr, "");
  assert.match(usage.stdout, /^spec-query — Lean 実行可能仕様への決定論的な問い合わせ。\n/);
  assert.match(usage.stdout, /\n  共通: --build always\|auto\|never（既定 auto = バイナリが無ければ lake build）\n$/);
  assert.doesNotMatch(usage.stdout, /同じ #print を繰り返さない/);
  const unknown = run("bogus");
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stdout, usage.stdout);
  for (const cmd of ["scenarios", "environments", "commands", "errors", "outlets", "schemas", "meta", "external", "print", "init", "run", "step", "views", "raw"]) {
    const r = run(cmd);
    assert.equal(r.status, 1, cmd);
    assert.equal(r.stdout, "", cmd);
    assert.match(r.stderr, /^cradle: cradle\.json に project/, cmd);
  }
});
