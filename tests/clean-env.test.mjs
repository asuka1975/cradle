// テストの足場（helpers.mjs の cleanEnv と commitAll）が、利用者の git 設定と呼び手のリポジトリから切り離されていること。
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
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

test("commitAll は git が設定に名前が無くても読む既定の場所の除外と属性（$XDG_CONFIG_HOME/git/、XDG_CONFIG_HOME が無ければ ~/.config/git/）も読まない", (t) => {
  const home = tempDir(t, "cradle-home-");
  writeTree(home, { ".config/git/ignore": "*.ts\n", ".config/git/attributes": "*.ts foo=bar\n" });
  const xdg = tempDir(t, "cradle-xdg-");
  writeTree(xdg, { "git/ignore": "*.ts\n", "git/attributes": "*.ts foo=bar\n" });
  const got = {};
  for (const [label, outer] of [["~/.config/git", { HOME: home, XDG_CONFIG_HOME: undefined }], ["$XDG_CONFIG_HOME/git", { HOME: home, XDG_CONFIG_HOME: xdg }]]) {
    const root = tempDir(t, "cradle-commit-");
    writeTree(root, { "cradle.json": "{}\n", "e2e/flow.ts": "export {};\n" });
    const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
    for (const [k, v] of Object.entries(outer)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    let attr;
    try { commitAll(root); attr = gitOut(root, "check-attr", "foo", "e2e/flow.ts").stdout; }
    finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    got[label] = [gitOut(root, "ls-files").stdout, attr];
  }
  const want = ["cradle.json\ne2e/flow.ts\n", "e2e/flow.ts: foo: unspecified\n"];
  assert.deepEqual(got, { "~/.config/git": want, "$XDG_CONFIG_HOME/git": want });
});

test("commitAll は環境の GIT_TEMPLATE_DIR の雛形（info/exclude・hooks）を git init に写さず、cleanEnv は system の属性ファイル（$(prefix)/etc/gitattributes）も切る", (t) => {
  const template = tempDir(t, "cradle-template-");
  writeTree(template, { "info/exclude": "*.ts\n", "hooks/pre-commit": "#!/bin/sh\nexit 0\n" });
  const root = tempDir(t, "cradle-commit-");
  writeTree(root, { "cradle.json": "{}\n", "e2e/flow.ts": "export {};\n" });
  const saved = process.env.GIT_TEMPLATE_DIR;
  process.env.GIT_TEMPLATE_DIR = template;
  let env;
  try { env = cleanEnv(); commitAll(root); }
  finally { if (saved === undefined) delete process.env.GIT_TEMPLATE_DIR; else process.env.GIT_TEMPLATE_DIR = saved; }
  assert.equal(gitOut(root, "ls-files").stdout, "cradle.json\ne2e/flow.ts\n");
  assert.equal(existsSync(join(root, ".git", "hooks", "pre-commit")), false);
  assert.equal(env.GIT_TEMPLATE_DIR, undefined);
  // system の属性ファイルはテストから書けないので、git が読まない印が立っていることを見る
  assert.equal(env.GIT_ATTR_NOSYSTEM, "1");
  assert.equal(cleanEnv({ GIT_TEMPLATE_DIR: template }).GIT_TEMPLATE_DIR, template);
});
