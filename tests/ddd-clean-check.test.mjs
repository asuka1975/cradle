import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ddd = fileURLToPath(new URL("../.apm/skills/ddd/scripts/ddd.mjs", import.meta.url));
const check = fileURLToPath(new URL("../.apm/skills/cradle/scripts/ddd-clean-check.mjs", import.meta.url));
const COMMAND = "inductive Command where\n  /-- 何かする。 -/\n  | foo\n";

// 一時プロジェクト: cradle.json・documents/ddd の 5 ファイル・lean/ の Command.lean と README・コミット 1 つ。
// 環境変数を落とすのは、Claude Code の中で走るとプロジェクトルートが cradle 自身に解決されるため
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cradle-ddd-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "cradle.json"), JSON.stringify({ project: "Example" }));
  mkdirSync(join(root, "documents/ddd"), { recursive: true });
  for (const f of ["event-timeline.md", "hotspots.md", "ux-review.md", "model-review.md"]) writeFileSync(join(root, "documents/ddd", f), `# ${f}\n`);
  writeFileSync(join(root, "documents/ddd/ubiquitous-language.md"), "# 用語集\n\n| 用語 | 英語 | 意味 |\n|---|---|---|\n");
  mkdirSync(join(root, "lean/Example/Runtime"), { recursive: true });
  writeFileSync(join(root, "lean/Example/Runtime/Command.lean"), COMMAND);
  writeFileSync(join(root, "lean/README.md"), "# lean\n");
  const env = { ...process.env };
  for (const key of ["CRADLE_PROJECT_DIR", "CRADLE_CONFIG", "CLAUDE_PROJECT_DIR"]) delete env[key];
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  const lean = (p) => join(root, "lean", p);
  return { root, run, lean, marker: join(root, "documents/ddd/.session") };
}

test("HEAD と違っても start の時点と同じなら end は通る", (t) => {
  const { run, lean, marker } = fixture(t);
  writeFileSync(lean("Example/Runtime/Command.lean"), COMMAND + "  | bar\n");
  const start = run(ddd, "start");
  assert.equal(start.status, 0, start.stderr);
  assert.match(start.stdout, /未コミットの差分/);
  assert.match(start.stdout, /git checkout \/ stash/);
  assert.equal(JSON.parse(readFileSync(marker, "utf8")).lean["Example/Runtime/Command.lean"].length, 64);
  const end = run(ddd, "end", "--no-build");
  assert.equal(end.status, 0, end.stdout + end.stderr);
  assert.match(end.stdout, /^OK /m);
  assert.equal(existsSync(marker), false);
});

test("start の後の変更・追加・削除は end で出て、手で戻すまで .session が残る", (t) => {
  const { run, lean, marker } = fixture(t);
  assert.equal(run(ddd, "start").status, 0);
  writeFileSync(lean("Example/Runtime/Command.lean"), COMMAND + "  | bar\n");
  writeFileSync(lean("Example/Extra.lean"), "def x := 1\n");
  unlinkSync(lean("README.md"));
  const ng = run(ddd, "end", "--no-build");
  assert.equal(ng.status, 1);
  assert.match(ng.stdout, /lean\/ が ddd\.mjs start の時点と違います/);
  assert.match(ng.stdout, /^ M lean\/Example\/Runtime\/Command\.lean$/m);
  assert.match(ng.stdout, /^ A lean\/Example\/Extra\.lean$/m);
  assert.match(ng.stdout, /^ D lean\/README\.md$/m);
  assert.doesNotMatch(ng.stdout, /\.session が残っています/);
  assert.equal(existsSync(marker), true);
  writeFileSync(lean("Example/Runtime/Command.lean"), COMMAND);
  unlinkSync(lean("Example/Extra.lean"));
  writeFileSync(lean("README.md"), "# lean\n");
  const ok = run(ddd, "end", "--no-build");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(existsSync(marker), false);
});

test("ベースライン無しの ddd-clean-check は HEAD と比べていると言う", (t) => {
  const { run, lean } = fixture(t);
  writeFileSync(lean("Example/Runtime/Command.lean"), COMMAND + "  | bar\n");
  const r = run(check);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /HEAD と比べている/);
  assert.match(r.stdout, /^ M lean\/Example\/Runtime\/Command\.lean$/m);
  assert.match(run(check, "--baseline").stderr, /usage/);
});

test("印が残ったままの start は止まり、最初の記録が残る", (t) => {
  const { run, lean, marker } = fixture(t);
  assert.equal(run(ddd, "start").status, 0);
  const first = readFileSync(marker, "utf8");
  writeFileSync(lean("Example/Runtime/Command.lean"), COMMAND + "  | bar\n");
  const again = run(ddd, "start");
  assert.equal(again.status, 1);
  assert.match(again.stderr, /end されていません/);
  assert.equal(readFileSync(marker, "utf8"), first);
});

test("git が無くても start の時点と比べる", (t) => {
  const { root, run, lean } = fixture(t);
  rmSync(join(root, ".git"), { recursive: true, force: true });
  assert.equal(run(ddd, "start").status, 0);
  assert.match(run(ddd, "end", "--no-build").stdout, /^OK /m);
  assert.equal(run(ddd, "start").status, 0);
  writeFileSync(lean("Example/Runtime/Command.lean"), COMMAND + "  | bar\n");
  const ng = run(ddd, "end", "--no-build");
  assert.equal(ng.status, 1);
  assert.match(ng.stdout, /^ M lean\/Example\/Runtime\/Command\.lean$/m);
});

test("問いが残っていても --abandon なら片付けて通る", (t) => {
  const { root, run } = fixture(t);
  assert.equal(run(ddd, "start").status, 0);
  const qjson = join(root, "q.json");
  writeFileSync(qjson, JSON.stringify({ questions: [{ question: "どちら", options: [{ label: "a" }, { label: "b" }] }] }));
  assert.equal(run(ddd, "questions", `@${qjson}`).status, 0);
  assert.match(run(ddd, "end", "--no-build").stderr, /まだ中継されていません/);
  const r = run(ddd, "end", "--no-build", "--abandon");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(existsSync(join(root, "documents/ddd/questions.md")), false);
  assert.equal(existsSync(join(root, "documents/ddd/.session")), false);
});

test("記録の無い印は消して HEAD と比べる", (t) => {
  const { run, lean, marker } = fixture(t);
  writeFileSync(marker, JSON.stringify({ theme: null }) + "\n");
  writeFileSync(lean("Example/Runtime/Command.lean"), COMMAND + "  | bar\n");
  const r = run(ddd, "end", "--no-build");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /HEAD と比べている/);
  assert.equal(existsSync(marker), false);
});
