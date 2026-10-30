// テストの足場（helpers.mjs の cleanEnv と commitAll）が、利用者の git 設定と呼び手のリポジトリから切り離されていること。
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tempDir, writeTree, cleanEnv, commitAll } from "./helpers.mjs";

const gitOut = (cwd, ...args) => spawnSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8" });

test("commitAll は HOME の .gitconfig（除外・署名・作者の設定）も、git の hook が渡す GIT_DIR・GIT_INDEX_FILE も読まず、置き場のファイルを全部その置き場のリポジトリにコミットする", (t) => {
  const home = tempDir(t, "cradle-home-");
  writeFileSync(join(home, "ignore"), "*.ts\n");
  writeFileSync(join(home, ".gitconfig"), `[core]\n\texcludesFile = ${join(home, "ignore")}\n[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n[user]\n\tuseConfigOnly = true\n`);
  const outer = tempDir(t, "cradle-outer-");
  assert.equal(gitOut(outer, "init", "-q").status, 0);
  const root = tempDir(t, "cradle-commit-");
  writeTree(root, { "cradle.json": "{}\n", "e2e/flow.ts": "export {};\n" });
  const saved = { HOME: process.env.HOME, GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
  Object.assign(process.env, { HOME: home, GIT_DIR: join(outer, ".git"), GIT_INDEX_FILE: join(outer, ".git", "index") });
  try { commitAll(root); }
  finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  assert.equal(gitOut(root, "ls-files").stdout, "cradle.json\ne2e/flow.ts\n");
  assert.notEqual(gitOut(outer, "rev-parse", "--verify", "-q", "HEAD").status, 0);
});
