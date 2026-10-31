// lib の lakeBuild が落ちたときの文: lake を起動できなければ（PATH に無い）spawn の理由を同じ行に載せ、lake が走って落ちたときは lake の出力の末尾だけ（以前どおり）。
// spec-query は --build の auto（バイナリが無い）で build を走らせ、lean-check は --build で走らせる
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, writeTree } from "./helpers.mjs";

const scripts = new URL("../.apm/skills/cradle/scripts/", import.meta.url);
const specQuery = fileURLToPath(new URL("spec-query.mjs", scripts));
const leanCheck = fileURLToPath(new URL("lean-check.mjs", scripts));

// Lean CLI のバイナリ（lean/.lake/build/bin/example）の無い一時プロジェクトと、lake を置かない PATH（tools）
function fixture(t) {
  const root = tempProject(t, "cradle-lake-build-failure-");
  writeTree(root, { "lean/Example/Domain/A.lean": "theorem t : True := trivial\n", "lean/Example/Runtime/Json.lean": "" });
  const tools = join(root, "tools");
  mkdirSync(tools);
  return { root, tools, env: cleanEnv({ PATH: tools }) };
}

const queries = [["commands"], ["errors"], ["schemas"], ["print", "Example.Runtime.Command"], ["meta"]];

test("PATH に lake が無ければ、spec-query の commands / errors / schemas / print / meta は auto の lake build の失敗の行に spawn の理由を載せて 2 で終わる", (t) => {
  const { root, env } = fixture(t);
  for (const args of queries) {
    const r = runNode(specQuery, args, { cwd: root, env });
    assert.equal(r.status, 2, `${args}: ${r.stderr}`);
    assert.equal(r.stdout, "", args.join(" "));
    assert.equal(r.stderr, "cradle: lake build が失敗しました: spawnSync lake ENOENT\n\n\n", args.join(" "));
  }
});

test("lake が走って落ちれば、lake build の失敗の文は以前どおり lake の stdout と stderr の末尾だけ", (t) => {
  const { root, tools, env } = fixture(t);
  writeFileSync(join(tools, "lake"), `#!${process.execPath}\nprocess.stdout.write("out\\n"); process.stderr.write("err\\n"); process.exit(1);\n`);
  chmodSync(join(tools, "lake"), 0o755);
  for (const args of queries) {
    const r = runNode(specQuery, args, { cwd: root, env });
    assert.equal(r.status, 2, `${args}: ${r.stderr}`);
    assert.equal(r.stderr, "cradle: lake build が失敗しました:\nout\n\nerr\n\n", args.join(" "));
  }
  const json = runNode(leanCheck, ["--build", "--json"], { cwd: root, env });
  assert.equal(json.status, 1, json.stderr);
  assert.equal(JSON.parse(json.stdout).build, "lake build が失敗しました:\nout\n\nerr\n");
});

test("PATH に lake が無ければ、lean-check --build は lake build の FAILED の下に spawn の理由を出して NG と 1", (t) => {
  const { root, env } = fixture(t);
  const json = runNode(leanCheck, ["--build", "--json"], { cwd: root, env });
  assert.equal(json.status, 1, json.stderr);
  assert.equal(json.stderr, "");
  const result = JSON.parse(json.stdout);
  assert.equal(result.ok, false);
  assert.equal(result.build, "lake build が失敗しました: spawnSync lake ENOENT\n\n");
  const text = runNode(leanCheck, ["--build"], { cwd: root, env });
  assert.equal(text.status, 1, text.stderr);
  assert.match(text.stdout, /\nlake build: FAILED\nlake build が失敗しました: spawnSync lake ENOENT\n\n\nNG\n$/);
});
