import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, tempProject, cleanEnv, runNode } from "./helpers.mjs";

const specQuery = fileURLToPath(new URL("../.apm/skills/cradle/scripts/spec-query.mjs", import.meta.url));

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

// 一時プロジェクト: Runtime/Scenarios.lean と空の Runtime/Json.lean、偽の CLI。PATH を空にして lake（#print）を呼べなくする —
// meta の commands / errors は空で返り、CLI の問い合わせ（views の口・external の版）だけが偽の CLI に届く
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
  return (...args) => {
    const r = runNode(specQuery, [...args, "--build", "never"], { cwd: root, env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout);
  };
}

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
