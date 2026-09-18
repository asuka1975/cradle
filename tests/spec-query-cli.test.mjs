import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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
  const root = mkdtempSync(join(tmpdir(), "cradle-spec-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example" }));
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
  const env = { ...process.env, PATH: noTools };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  return (...args) => {
    const r = spawnSync(process.execPath, [specQuery, ...args, "--build", "never"], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
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
