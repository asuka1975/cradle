import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempProject, cleanEnv, runNode, commitAll } from "./helpers.mjs";

const hook = fileURLToPath(new URL("../.apm/skills/cradle/scripts/hook.mjs", import.meta.url));

function fixture(t, config) {
  const root = tempProject(t, "cradle-hook-", config);
  mkdirSync(join(root, "documents/ddd"), { recursive: true });
  function invoke(mode, tool_name, tool_input = {}, extra = {}, claude = false) {
    const result = runNode(hook, [mode], {
      cwd: root, env: cleanEnv(claude ? { CLAUDE_PROJECT_DIR: root } : {}),
      input: JSON.stringify({ cwd: root, tool_name, tool_input, ...extra }), timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    return result.stdout ? JSON.parse(result.stdout) : null;
  }
  return { root, invoke };
}

function denied(result) {
  assert.equal(result?.hookSpecificOutput?.hookEventName, "PreToolUse");
  assert.equal(result?.hookSpecificOutput?.permissionDecision, "deny");
  assert.ok(result.hookSpecificOutput.permissionDecisionReason.length > 0);
}

test("生成物・人間専用領域・golden応答は拒否し、通常のコードとrequestは許可する", (t) => {
  const { root, invoke } = fixture(t);
  for (const path of ["backend/src/generated/A.kt", "frontend/src/api/generated/a.ts", "backend/build/generated/a.kt", "documents/developer/new.md", "lean/golden/basic-init.json", "lean/golden/basic-flow.json"]) {
    denied(invoke("pre-guard", "Write", { file_path: path }));
    denied(invoke("pre-guard", "Edit", { file_path: join(root, path) }, {}, true));
  }
  for (const path of ["backend/src/main/A.kt", "frontend/src/a.ts", "lean/golden/basic.request.json", "documents/ddd/ux-review.md", "documents/ddd/model-review.md"]) {
    assert.equal(invoke("pre-guard", "Write", { file_path: path }), null);
  }
});

test("探索の正式ドキュメントはセッション印がある間だけ編集できる", (t) => {
  const { root, invoke } = fixture(t);
  const paths = ["event-timeline.md", "hotspots.md", "ubiquitous-language.md"];
  for (const name of paths) denied(invoke("pre-guard", "Write", { file_path: `documents/ddd/${name}` }));
  writeFileSync(join(root, "documents/ddd/.session"), "{}");
  for (const name of paths) assert.equal(invoke("pre-guard", "Write", { file_path: `documents/ddd/${name}` }), null);
});

test("Codexパッチの追加・変更・削除・移動先を検査する", (t) => {
  const { invoke } = fixture(t);
  for (const header of ["Add File", "Update File", "Delete File", "Move to"]) {
    denied(invoke("pre-guard", "apply_patch", { command: `*** Begin Patch\n*** ${header}: documents/developer/a.md\n*** End Patch` }));
  }
  assert.equal(invoke("pre-guard", "apply_patch", { command: "*** Begin Patch\n*** Add File: frontend/src/a.ts\n+x\n*** End Patch" }), null);
});

test("探索役の起動と中継操作に対する既存制約を維持する", (t) => {
  const { invoke } = fixture(t);
  denied(invoke("pre-guard", "Agent", { subagent_type: "ddd-domain-explorer", run_in_background: true }));
  assert.equal(invoke("pre-guard", "spawn_agent", { agent_type: "ddd-domain-explorer" }), null);
  denied(invoke("pre-guard", "Bash", { command: "node ddd.mjs end" }, { agent_type: "ddd-domain-explorer" }));
  assert.equal(invoke("pre-guard", "Bash", { command: "node ddd.mjs end" }), null);
});

test("ビルド後のレビューとgolden促しを失敗時には出さない", (t) => {
  const { invoke } = fixture(t);
  const gradle = invoke("post-bash", "Bash", { command: "./gradlew build" }, { tool_response: "BUILD SUCCESSFUL" });
  assert.equal(gradle.decision, "block");
  assert.match(gradle.reason, /sql-perf-review/);
  assert.match(gradle.reason, /backend-design-review/);
  assert.equal(invoke("post-bash", "Bash", { command: "./gradlew build" }, { tool_response: "BUILD FAILED" }), null);
  const lake = invoke("post-bash", "Bash", { command: "lake build" }, { tool_response: "Build completed successfully" });
  assert.equal(lake.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(lake.hookSpecificOutput.additionalContext, /golden-check/);
  assert.match(lake.hookSpecificOutput.additionalContext, /lean-modeling-evaluator/);
  assert.equal(invoke("post-bash", "Bash", { command: "lake build" }, { tool_response: "error: failed" }), null);
});

test("編集後の促しとStop再入時の許可を維持する", (t) => {
  const { invoke } = fixture(t);
  const lean = invoke("post-edit", "Edit", { file_path: "lean/Example.lean" });
  assert.equal(lean.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(lean.hookSpecificOutput.additionalContext, /lean-check/);
  const api = invoke("post-edit", "Write", { file_path: "documents/codebase/openapi.yaml" });
  assert.match(api.hookSpecificOutput.additionalContext, /generateApi/);
  assert.equal(invoke("stop", "", {}, { stop_hook_active: true }), null);
});

test("protected・backend.generated・frontend.generated に文字列 1 つを書いても、1 要素の配列と同じく拒否する", (t) => {
  const { invoke } = fixture(t, { project: "Example", protected: "documents/developer/**" });
  denied(invoke("pre-guard", "Write", { file_path: "backend/src/generated/A.kt" }));
  denied(invoke("pre-guard", "Edit", { file_path: "documents/developer/x.md" }));
  const generated = fixture(t, { project: "Example", backend: { generated: "api/out" }, frontend: { generated: "web/out" } });
  denied(generated.invoke("pre-guard", "Write", { file_path: "api/out/A.kt" }));
  denied(generated.invoke("pre-guard", "Write", { file_path: "web/out/a.ts" }));
  denied(generated.invoke("pre-guard", "Edit", { file_path: "documents/developer/x.md" }, {}, true));
  assert.equal(generated.invoke("pre-guard", "Write", { file_path: "backend/src/generated/A.kt" }), null);
});

test("cradle.json の型が文書と違えば（protected が数）、投げる検査から先は黙って通し、それより前の拒否は変えない", (t) => {
  const { invoke } = fixture(t, { project: "Example", protected: 5 });
  denied(invoke("pre-guard", "Write", { file_path: "backend/src/generated/A.kt" }));
  assert.equal(invoke("pre-guard", "Edit", { file_path: "documents/developer/x.md" }), null);
});

test("骨格が置く ai-notes の TEMPLATE.md と README.md の編集には促さず、同じ中身でも名前の規則に合わないノートには促す", (t) => {
  const { root, invoke } = fixture(t);
  const scaffold = (name) => fileURLToPath(new URL(`../.apm/skills/cradle-init/assets/documents/ai-notes/${name}`, import.meta.url));
  mkdirSync(join(root, "documents/ai-notes"), { recursive: true });
  for (const name of ["TEMPLATE.md", "README.md"]) {
    copyFileSync(scaffold(name), join(root, "documents/ai-notes", name));
    assert.equal(invoke("post-edit", "Write", { file_path: `documents/ai-notes/${name}` }), null, name);
  }
  copyFileSync(scaffold("TEMPLATE.md"), join(root, "documents/ai-notes/memo.md"));
  assert.equal(invoke("post-edit", "Write", { file_path: "documents/ai-notes/memo.md" }).hookSpecificOutput.additionalContext,
    "ai-notes の規約: ファイル名は YYYYMMDD-NN-<topic>.md（いまは memo.md）。ai-notes は規約ではない — ユーザーが承認したものだけが規約になる。");
});

test("pre-guard は lake build が書いた lean/lake-manifest.json だけの差分では backend の本番コードの編集を確かめず、追跡している Lean の変更では確かめる", (t) => {
  const { root, invoke } = fixture(t);
  mkdirSync(join(root, "lean"), { recursive: true });
  writeFileSync(join(root, "lean/Example.lean"), "def x := 1\n");
  commitAll(root);
  writeFileSync(join(root, "lean/lake-manifest.json"), "{}\n");
  for (const claude of [true, false]) assert.equal(invoke("pre-guard", "Edit", { file_path: "backend/src/main/kotlin/A.kt" }, {}, claude), null);
  writeFileSync(join(root, "lean/Example.lean"), "def x := 2\n");
  const asked = invoke("pre-guard", "Edit", { file_path: "backend/src/main/kotlin/A.kt" }, {}, true);
  assert.equal(asked?.hookSpecificOutput?.permissionDecision, "ask");
  assert.match(asked.hookSpecificOutput.permissionDecisionReason, /^lean\/ に未コミットの差分があります/);
});
