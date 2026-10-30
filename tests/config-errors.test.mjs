// 設定が読めない・git の外: 道具は `cradle: <理由>` の 1 行と exit 1 で止まり、スタックトレースを出さない。
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, tempProject, cleanEnv, runNode } from "./helpers.mjs";

const skill = (p) => fileURLToPath(new URL(`../.apm/skills/${p}`, import.meta.url));
const cradle = skill("cradle/scripts/cradle.mjs");
const entries = [
  [cradle, ["status"]], [cradle, ["golden-check", "--build", "never"]], [cradle, ["spec-query"]], [cradle, ["lean-check"]],
  [cradle, ["regen-impact", "--no-regen"]], [cradle, ["unslop", "--all"]], [cradle, ["ddd-clean-check"]], [cradle, ["doctor", "--local"]],
  [skill("api-contract/scripts/contract-check.mjs"), []], [skill("e2e-parity/scripts/flows-from-golden.mjs"), []], [skill("ddd/scripts/ddd.mjs"), ["status"]],
];

test("cradle.json も lean/lakefile.toml も無い置き場では、どの道具も project が要る理由の 1 行で止まる", (t) => {
  const root = tempDir(t, "cradle-config-missing-");
  for (const [script, args] of entries) {
    const r = runNode(script, args, { cwd: root, env: cleanEnv() });
    const label = [script.split("/").pop(), ...args].join(" ");
    assert.equal(r.status, 1, label);
    assert.equal(r.stdout, "", label);
    assert.equal(r.stderr, "cradle: cradle.json に project（Lean のルート名前空間）が要ります\n", label);
  }
});

test("JSON として読めない cradle.json は、読めないファイルと理由の 1 行で止まる", (t) => {
  const root = tempDir(t, "cradle-config-broken-");
  writeFileSync(join(root, "cradle.json"), "{");
  for (const [script, args] of entries) {
    const r = runNode(script, args, { cwd: root, env: cleanEnv() });
    const label = [script.split("/").pop(), ...args].join(" ");
    assert.equal(r.status, 1, label);
    assert.equal(r.stdout, "", label);
    assert.match(r.stderr, /^cradle: cradle\.json を読めません: .*cradle\.json: [^\n]+\n$/, label);
  }
});

test("git の外の regen-impact は失敗した git の呼び出しの 1 行で止まる", (t) => {
  const root = tempProject(t, "cradle-config-nogit-");
  const r = runNode(cradle, ["regen-impact", "--no-regen"], { cwd: root, env: cleanEnv() });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "cradle: Command failed: git status --porcelain -- backend/src/generated\n");
});
