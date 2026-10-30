import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, cleanEnv, runNode } from "./helpers.mjs";

const init = fileURLToPath(new URL("../.apm/skills/cradle-init/scripts/init.mjs", import.meta.url));
const next = "\n次: apm install（固有の事実を rules に写す。Codex は apm compile --single-agents）  →  cd lean && lake build  →  cradle status  →  ddd スキルで探索を始める\n";
const mockupLines = "  + lean/mockup/public/index.html\n  + lean/mockup/server.mjs\n";

test("init は --k=v も --k v と同じに読み、--only=lean/mockup --force はモックアップだけを敷き直して残りを据え置く", (t) => {
  const root = tempDir(t, "cradle-init-eq-");
  // 呼ぶ場所は敷く先と別にする（--dir=… を読まなければ cwd に敷く）
  const cwd = tempDir(t, "cradle-init-cwd-");
  const env = cleanEnv();
  const dry = runNode(init, ["--project=Demo", `--dir=${root}`, "--only=lean/mockup", "--dry-run"], { cwd, env });
  assert.deepEqual([dry.status, dry.stdout, dry.stderr], [0, `Cradle init — Demo (${root}) [dry-run]\n${mockupLines}${next}`, ""]);
  assert.deepEqual(readdirSync(root), []);
  const full = runNode(init, ["--project", "Demo", "--dir", root], { cwd, env });
  assert.equal(full.status, 0, full.stderr);
  const hotspots = join(root, "documents/ddd/hotspots.md");
  writeFileSync(hotspots, "# 書き込んだ HS\n");
  const forced = runNode(init, ["--project", "Demo", `--dir=${root}`, "--only=lean/mockup", "--force"], { cwd, env });
  assert.deepEqual([forced.status, forced.stdout, forced.stderr], [0, `Cradle init — Demo (${root})\n${mockupLines}${next}`, ""]);
  assert.equal(readFileSync(hotspots, "utf8"), "# 書き込んだ HS\n");
  assert.deepEqual(readdirSync(cwd), []);
});

test("init は値の無い --dir と --only を何も書かずに 1 で止め、値の無い --only --force で骨格を丸ごと上書きしない", (t) => {
  const env = cleanEnv();
  const cwd = tempDir(t, "cradle-init-bare-");
  const dir = runNode(init, ["--project", "Demo", "--dir"], { cwd, env });
  assert.deepEqual([dir.status, dir.stdout, dir.stderr], [1, "", "--dir <path> が要ります（骨格を敷くディレクトリ）\n"]);
  const dirThenFlag = runNode(init, ["--project", "Demo", "--dir", "--dry-run"], { cwd, env });
  assert.deepEqual([dirThenFlag.status, dirThenFlag.stdout, dirThenFlag.stderr], [1, "", "--dir <path> が要ります（骨格を敷くディレクトリ）\n"]);
  const only = runNode(init, ["--project", "Demo", "--dir", cwd, "--only", "--force"], { cwd, env });
  assert.deepEqual([only.status, only.stdout, only.stderr], [1, "", "--only <prefix> が要ります（例: lean/mockup）\n"]);
  assert.deepEqual(readdirSync(cwd), []);
});

test("init は値を付けた --force / --dry-run（--force=false など）と値の無い --backend を何も書かずに 1 で止め、手で書いた内容を上書きしない", (t) => {
  const env = cleanEnv();
  const root = tempDir(t, "cradle-init-flagval-");
  const full = runNode(init, ["--project", "Demo", "--dir", root], { cwd: root, env });
  assert.equal(full.status, 0, full.stderr);
  const hotspots = join(root, "documents/ddd/hotspots.md");
  writeFileSync(hotspots, "# 書き込んだ HS\n");
  for (const [flag, line] of [["--force=false", "--force は値を取りません（--force=false）\n"], ["--force=true", "--force は値を取りません（--force=true）\n"], ["--dry-run=x", "--dry-run は値を取りません（--dry-run=x）\n"]]) {
    const r = runNode(init, ["--project", "Demo", "--dir", root, "--only", "documents/ddd/hotspots.md", flag], { cwd: root, env });
    assert.deepEqual([r.status, r.stdout, r.stderr], [1, "", line], flag);
    assert.equal(readFileSync(hotspots, "utf8"), "# 書き込んだ HS\n", flag);
  }
  const cwd = tempDir(t, "cradle-init-nobackend-");
  for (const args of [["--backend"], ["--backend", "--dry-run"]]) {
    const r = runNode(init, ["--project", "Demo", "--dir", cwd, ...args], { cwd, env });
    assert.deepEqual([r.status, r.stdout, r.stderr], [1, "", "--backend <package> が要ります（例: com.example.notes）\n"], args.join(" "));
  }
  assert.deepEqual(readdirSync(cwd), []);
});
