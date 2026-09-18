import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ddd = fileURLToPath(new URL("../.apm/skills/ddd/scripts/ddd.mjs", import.meta.url));
const status = fileURLToPath(new URL("../.apm/skills/cradle/scripts/status.mjs", import.meta.url));
const init = fileURLToPath(new URL("../.apm/skills/cradle-init/scripts/init.mjs", import.meta.url));

// 一時プロジェクト: cradle.json と documents/ddd の 5 ファイル。event-timeline.md の冒頭は引数で差し替える。
// 環境変数を落とすのは、Claude Code の中で走るとプロジェクトルートが cradle 自身に解決されるため
function fixture(t, timelineHead) {
  const root = mkdtempSync(join(tmpdir(), "cradle-product-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example" }));
  mkdirSync(join(root, "documents/ddd"), { recursive: true });
  for (const f of ["hotspots.md", "ux-review.md", "model-review.md"]) writeFileSync(join(root, "documents/ddd", f), `# ${f}\n`);
  writeFileSync(join(root, "documents/ddd/ubiquitous-language.md"), "# 用語集\n\n| 用語 | 英語 | 意味 |\n|---|---|---|\n");
  writeFileSync(join(root, "documents/ddd/event-timeline.md"), timelineHead);
  mkdirSync(join(root, "lean"), { recursive: true });
  const env = { ...process.env };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  return { root, run, timeline: join(root, "documents/ddd/event-timeline.md"), marker: join(root, "documents/ddd/.session") };
}

const TABLE = "\n| # | ドメインイベント (過去形) | 主体 | トリガー | 備考 / 関連 |\n|---|---|---|---|---|\n";

test("プロダクトの一言が置き場のままなら start は止まり、書き方を示す", (t) => {
  const { run, marker } = fixture(t, `# イベント時系列マップ\n\nプロダクト: （一言で）\n${TABLE}`);
  const r = run(ddd, "start");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /プロダクトの一言が無い/);
  assert.match(r.stderr, /--domain/);
  assert.equal(existsSync(marker), false);
});

test("プロダクトの行そのものが無くても start は止まる", (t) => {
  const { run, marker } = fixture(t, `# イベント時系列マップ\n${TABLE}`);
  const r = run(ddd, "start");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /「プロダクト:」行が無い/);
  assert.equal(existsSync(marker), false);
});

test("start --domain は置き場の行を書き換えて始め、status がその一言を出す", (t) => {
  const { run, timeline, marker } = fixture(t, `# イベント時系列マップ\n\nプロダクト: （一言で）\n${TABLE}`);
  const r = run(ddd, "start", "--domain", "吹奏楽団の練習出欠と楽譜貸出の管理");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^プロダクト: 吹奏楽団の練習出欠と楽譜貸出の管理$/m);
  assert.equal(existsSync(marker), true);
  const text = readFileSync(timeline, "utf8");
  assert.equal(text, `# イベント時系列マップ\n\nプロダクト: 吹奏楽団の練習出欠と楽譜貸出の管理\n${TABLE}`);
  assert.equal(JSON.parse(run(ddd, "status").stdout).product, "吹奏楽団の練習出欠と楽譜貸出の管理");
  const s = JSON.parse(run(status, "--json").stdout);
  assert.ok(s.phases[0].facts.includes("プロダクト: 吹奏楽団の練習出欠と楽譜貸出の管理"), JSON.stringify(s.phases[0]));
});

test("行が無いところへ start --domain は見出しの直後に差し込む", (t) => {
  const { run, timeline } = fixture(t, `# イベント時系列マップ\n${TABLE}`);
  const r = run(ddd, "start", "--domain", "図書の貸出");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(timeline, "utf8"), `# イベント時系列マップ\n\nプロダクト: 図書の貸出\n${TABLE}`);
});

test("一言が書いてあれば start はそれを出して始まり、書き換えない", (t) => {
  const { run, timeline } = fixture(t, `# イベント時系列マップ\n\nプロダクト: 図書の貸出\n${TABLE}`);
  const r = run(ddd, "start");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^プロダクト: 図書の貸出$/m);
  assert.equal(readFileSync(timeline, "utf8"), `# イベント時系列マップ\n\nプロダクト: 図書の貸出\n${TABLE}`);
});

test("一言が無い status は探索フェーズにその事実を出す", (t) => {
  const { run } = fixture(t, `# イベント時系列マップ\n\nプロダクト: （一言で）\n${TABLE}`);
  const s = JSON.parse(run(status, "--json").stdout);
  assert.ok(s.phases[0].facts.some(f => f.startsWith("プロダクトの一言が無い")), JSON.stringify(s.phases[0]));
});

test("init --domain は一言を event-timeline.md の冒頭に書き、project.instructions.md にドメインの行は無い", (t) => {
  const root = mkdtempSync(join(tmpdir(), "cradle-init-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  const r = spawnSync(process.execPath, [init, "--project", "Demo", "--domain", "吹奏楽団の練習出欠と楽譜貸出の管理", "--dir", root, "--only", "documents"], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(root, "documents/ddd/event-timeline.md"), "utf8"), /^# イベント時系列マップ\n\nプロダクト: 吹奏楽団の練習出欠と楽譜貸出の管理\n\n/);
  assert.doesNotMatch(r.stdout, /一言は書いていない/);
  const withoutDomain = mkdtempSync(join(tmpdir(), "cradle-init-"));
  t.after(() => rmSync(withoutDomain, { recursive: true, force: true }));
  const r2 = spawnSync(process.execPath, [init, "--project", "Demo", "--dir", withoutDomain], { cwd: withoutDomain, env, encoding: "utf8", timeout: 20_000 });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(readFileSync(join(withoutDomain, "documents/ddd/event-timeline.md"), "utf8"), /^# イベント時系列マップ\n\nプロダクト: （一言で）\n\n/);
  assert.match(r2.stdout, /一言は書いていない/);
  assert.doesNotMatch(readFileSync(join(withoutDomain, ".apm/instructions/project.instructions.md"), "utf8"), /ドメイン:/);
  const bad = spawnSync(process.execPath, [init, "--project", "Demo", "--dir", withoutDomain, "--domain", "  "], { cwd: withoutDomain, env, encoding: "utf8", timeout: 20_000 });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--domain/);
  // event-timeline.md を敷かない実行（骨格の一部だけ敷き直す）では、書いていないという案内も出ない
  const again = spawnSync(process.execPath, [init, "--project", "Demo", "--dir", withoutDomain, "--only", "lean/mockup", "--force"], { cwd: withoutDomain, env, encoding: "utf8", timeout: 20_000 });
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /一言は書いていない/);
});
