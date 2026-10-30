// hook の判定（hook-decide.mjs）の単体テスト。プロセスを起こさず、ファイル・git・unslop を ctx で差し替えて判定の順序と正規表現を見る。
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tempProject } from "./helpers.mjs";
import { loadConfig } from "../.apm/skills/cradle/scripts/lib.mjs";
import { decide, targetPaths } from "../.apm/skills/cradle/scripts/hook-decide.mjs";

function setup(t, config) {
  const root = tempProject(t, "cradle-hook-decide-", config);
  return { root, cfg: loadConfig(root, {}) };
}

const reasonOf = (r) => r?.hookSpecificOutput?.permissionDecisionReason;
const contextOf = (r) => r?.hookSpecificOutput?.additionalContext;
const patch = (...files) => ({ command: `*** Begin Patch\n${files.map(f => `*** Update File: ${f}`).join("\n")}\n*** End Patch` });
// 呼ばれたら落ちる差し替え（try の中で呼ばれても気づけるよう、呼ばれたことを記録する）
function forbidden(calls, what) { return () => { calls.push(what); throw new Error(`${what} は呼ばない`); }; }

test("targetPaths は file_path → notebook_path → path の 1 つを取り、Codex のパッチは Add / Update / Delete の行の後に Move to の行を並べる", () => {
  assert.deepEqual(targetPaths({ tool_input: { file_path: "a", notebook_path: "b", path: "c" } }), ["a"]);
  assert.deepEqual(targetPaths({ tool_input: { notebook_path: "b", path: "c" } }), ["b"]);
  assert.deepEqual(targetPaths({ tool_input: { path: "c" } }), ["c"]);
  assert.deepEqual(targetPaths({}), []);
  // 単一のパスがあればパッチの本文は見ない
  assert.deepEqual(targetPaths({ tool_input: { file_path: "a", command: "*** Begin Patch\n*** Add File: b\n*** End Patch" } }), ["a"]);
  const body = "*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: src/b.ts\n@@\n-x\n+y\n*** Add File:  new.md  \n+z\n*** Delete File: old.md\n*** End Patch";
  assert.deepEqual(targetPaths({ tool_input: { command: body } }), ["src/a.ts", "new.md", "old.md", "src/b.ts"]);
  // Begin Patch の無い本文・文字列でない command・行頭でない見出しはパッチとして読まない
  assert.deepEqual(targetPaths({ tool_input: { command: "*** Add File: a.md" } }), []);
  assert.deepEqual(targetPaths({ tool_input: { command: ["*** Begin Patch\n*** Add File: a.md"] } }), []);
  assert.deepEqual(targetPaths({ tool_input: { command: "*** Begin Patch\n  *** Add File: a.md\n+*** Add File: b.md\n*** End Patch" } }), []);
});

test("pre-guard の Agent / spawn_agent と Bash はパスを見ずに決める", (t) => {
  const { cfg } = setup(t);
  const calls = [];
  const d = (payload) => decide("pre-guard", payload, { cfg, isClaude: false, exists: forbidden(calls, "exists"), gitStatus: forbidden(calls, "gitStatus"), leanStatus: forbidden(calls, "leanStatus") });
  assert.match(reasonOf(d({ tool_name: "Agent", tool_input: { subagent_type: "ddd-domain-explorer", run_in_background: true } })), /フォアグラウンド/);
  assert.match(reasonOf(d({ tool_name: "spawn_agent", tool_input: { subagent_type: "ddd-domain-explorer", run_in_background: true } })), /フォアグラウンド/);
  assert.equal(d({ tool_name: "Agent", tool_input: { subagent_type: "ddd-domain-explorer", file_path: "documents/developer/x.md" } }), null);
  assert.equal(d({ tool_name: "spawn_agent", tool_input: { agent_type: "ddd-domain-explorer", run_in_background: true } }), null);
  for (const command of ["node ddd.mjs start", "node x/ddd.mjs  answers", "node ddd-clean-check.mjs", "cat documents/ddd/questions.md", "ls documents/ddd/.session"]) {
    assert.match(reasonOf(d({ tool_name: "Bash", agent_type: "ddd-domain-explorer", tool_input: { command } })), /^探索役/, command);
  }
  assert.equal(d({ tool_name: "Bash", agent_type: "ddd-domain-explorer", tool_input: { command: "node ddd.mjs status" } }), null);
  assert.equal(d({ tool_name: "Bash", tool_input: { command: "node ddd.mjs end", file_path: "documents/developer/x.md" } }), null);
  assert.deepEqual(calls, []);
});

test("pre-guard はパスごとに生成物 → 保護領域 → golden → 探索の正式ドキュメントの順に見て、先に並ぶパスの拒否を返す", (t) => {
  const { root, cfg } = setup(t, { project: "Example", protected: ["backend/**", "documents/developer/**"] });
  const d = (tool_input, ctx = {}) => decide("pre-guard", { tool_name: "Write", tool_input }, { cfg, isClaude: false, exists: () => false, ...ctx });
  assert.match(reasonOf(d({ file_path: "backend/src/generated/A.kt" })), /^backend\/src\/generated\/A\.kt は生成物です/);
  assert.match(reasonOf(d({ file_path: "frontend/x/build/generated/a.ts" })), /は生成物です/);
  assert.match(reasonOf(d({ file_path: "backend/src/main/A.kt" })), /は保護領域です/);
  assert.match(reasonOf(d({ file_path: "lean/golden/basic-init.json" })), /は golden/);
  assert.equal(d({ file_path: "lean/golden/basic.request.json" }), null);
  assert.match(reasonOf(d(patch("documents/developer/x.md", "frontend/src/api/generated/a.ts"))), /^documents\/developer\/x\.md は保護領域です/);
  assert.match(reasonOf(d(patch("lean/golden/basic-flow.json", "documents/developer/x.md"))), /^lean\/golden\/basic-flow\.json は golden/);
  assert.match(reasonOf(d(patch("documents/ddd/hotspots.md", "lean/golden/basic-flow.json"))), /^documents\/ddd\/hotspots\.md は探索の正式ドキュメント/);
  // 正式ドキュメントはセッション印（documents/ddd/.session）がある間だけ通す。受信箱は印を見ない
  const seen = [];
  assert.match(reasonOf(d({ file_path: "documents/ddd/event-timeline.md" }, { exists: (p) => { seen.push(p); return false; } })), /探索の正式ドキュメント/);
  assert.deepEqual(seen, [join(root, "documents/ddd", ".session")]);
  assert.equal(d({ file_path: "documents/ddd/ubiquitous-language.md" }, { exists: () => true }), null);
  const calls = [];
  assert.equal(d({ file_path: "documents/ddd/ux-review.md" }, { exists: forbidden(calls, "exists") }), null);
  assert.deepEqual(calls, []);
});

test("pre-guard は相対パスを payload の cwd に繋いでルートからの位置で見て、ルートの外（../）は見ない", (t) => {
  const { root, cfg } = setup(t, { project: "Example", protected: ["../shared/**", "documents/developer/**"] });
  const d = (payload) => decide("pre-guard", { tool_name: "Edit", ...payload }, { cfg, isClaude: false });
  assert.match(reasonOf(d({ cwd: join(root, "backend"), tool_input: { file_path: "src/generated/A.kt" } })), /^backend\/src\/generated\/A\.kt は生成物です/);
  assert.match(reasonOf(d({ tool_input: { file_path: join(root, "documents/developer/x.md") } })), /保護領域/);
  assert.equal(d({ tool_input: { file_path: "../shared/x.md" } }), null);
  assert.equal(d({ tool_input: { file_path: "/etc/passwd" } }), null);
  assert.equal(d({ tool_input: {} }), null);
});

test("pre-guard は全パスの拒否を見てから、Lean に未コミットの差分があるまま触る backend の本番コードを確かめる（Claude Code は ask、Codex は文脈）", (t) => {
  const { cfg } = setup(t);
  const asked = [], calls = [];
  const dirty = () => { asked.push("lean"); return " M lean/A.lean\n"; };
  // Lean の差分は leanStatus（lake-manifest.json を外した lean/ の git status）で見て、frontend 用の gitStatus は呼ばない
  const d = (tool_input, ctx) => decide("pre-guard", { tool_name: "apply_patch", tool_input }, { cfg, isClaude: false, exists: () => false, gitStatus: forbidden(calls, "gitStatus"), ...ctx });
  assert.match(reasonOf(d(patch("backend/src/main/A.kt", "documents/developer/x.md"), { leanStatus: dirty })), /^documents\/developer\/x\.md は保護領域です/);
  assert.deepEqual(asked, []);
  const claude = decide("pre-guard", { tool_name: "Edit", tool_input: { file_path: "backend/src/main/A.kt" } }, { cfg, isClaude: true, gitStatus: forbidden(calls, "gitStatus"), leanStatus: dirty });
  assert.equal(claude.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(claude.hookSpecificOutput.permissionDecision, "ask");
  assert.match(claude.hookSpecificOutput.permissionDecisionReason, /^lean\/ に未コミットの差分があります/);
  assert.deepEqual(d(patch("frontend/src/a.ts", "backend/src/main/A.kt"), { leanStatus: dirty }),
    { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: claude.hookSpecificOutput.permissionDecisionReason } });
  assert.deepEqual(asked, ["lean", "lean"]);
  // 差分が無い・git が使えないなら黙って通す。backend の本番コード以外は git を見ない
  assert.equal(d({ file_path: "backend/src/main/A.kt" }, { leanStatus: () => "" }), null);
  assert.equal(d({ file_path: "backend/src/main/A.kt" }, { leanStatus: () => { throw new Error("git が無い"); } }), null);
  assert.equal(d({ file_path: "backend/src/test/A.kt" }, { leanStatus: dirty }), null);
  assert.deepEqual(asked, ["lean", "lean"]);
  assert.deepEqual(calls, []);
});

test("post-bash は gradle の build / test / check を区切りの後ろでも拾い、BUILD SUCCESSFUL のときだけレビューを促す", (t) => {
  const { cfg } = setup(t);
  const d = (command, tool_response) => decide("post-bash", { tool_input: { command }, tool_response }, { cfg, isClaude: false, gitStatus: () => "" });
  for (const command of ["./gradlew build", "gradlew test", "backend/gradlew.bat check", "cd backend && ./gradlew --offline build", "ls; ./gradlew clean test", "true || gradlew check"]) {
    const r = d(command, "BUILD SUCCESSFUL");
    assert.equal(r?.decision, "block", command);
    assert.match(r.reason, /sql-perf-review.*backend-design-review/);
  }
  for (const command of ["echo ./gradlew build", "./gradlew assemble", "./gradlewx build"]) assert.equal(d(command, "BUILD SUCCESSFUL"), null, command);
  assert.equal(d("./gradlew build", "BUILD FAILED"), null);
  assert.equal(d("./gradlew build", "ok"), null);
  assert.equal(d("./gradlew build"), null);
  // BUILD SUCCESSFUL が並べば途中の error: は失敗に数えない。オブジェクトの応答は JSON の文字列で見る
  assert.equal(d("./gradlew build", "w: error: x\nBUILD SUCCESSFUL").decision, "block");
  assert.equal(d("./gradlew build", { stdout: "BUILD SUCCESSFUL" }).decision, "block");
});

test("post-bash は lake build を区切りの後ろでも拾い、失敗の文字列が無いときに golden の確かめを促す", (t) => {
  const { cfg } = setup(t);
  const d = (command, tool_response) => decide("post-bash", { tool_input: { command }, tool_response }, { cfg, isClaude: false, gitStatus: () => "" });
  for (const command of ["lake build", "cd lean && lake build", "lake  build Demo", "x; lake build"]) {
    const r = d(command, "Build completed");
    assert.equal(r?.hookSpecificOutput?.hookEventName, "PostToolUse", command);
    assert.match(contextOf(r), /golden-check.*lean-modeling-evaluator/);
  }
  for (const command of ["lake buildx", "lake env", "echo lake build", "lakebuild"]) assert.equal(d(command, "Build completed"), null, command);
  for (const text of ["BUILD FAILED", "FAILURE: x", "error: x", "Error: x", "x failed"]) assert.equal(d("lake build", text), null, text);
  assert.match(contextOf(d("lake build", "Errors: 0")), /golden-check/);
});

test("post-bash は pnpm / npm / yarn の build・test・typecheck・lint を拾い、frontend に未コミットの変更があるときだけ画面の確かめを促す", (t) => {
  const { cfg } = setup(t);
  const seen = [];
  const touched = (dir) => { seen.push(dir); return " M frontend/src/a.ts\n"; };
  const d = (command, tool_response, gitStatus = touched) => decide("post-bash", { tool_input: { command }, tool_response }, { cfg, isClaude: false, gitStatus });
  for (const command of ["pnpm test", "npm run build", "yarn lint", "pnpm typecheck", "cd frontend && pnpm run test"]) assert.match(contextOf(d(command, "ok")), /frontend-ux-review/, command);
  assert.deepEqual([...new Set(seen)], ["frontend"]);
  for (const command of ["pnpm install", "npm ci", "npx vitest", "pnpm run dev", "echo pnpm test"]) assert.equal(d(command, "ok"), null, command);
  // 出力に error / failed / ✗ があれば大小を問わず促さない
  for (const text of ["0 errors", "Tests FAILED", "✗ a"]) assert.equal(d("pnpm test", text), null, text);
  assert.equal(d("pnpm test", "ok", () => ""), null);
  assert.equal(d("pnpm test", "ok", () => { throw new Error("git が無い"); }), null);
});

test("post-bash の促しは gradle → lake → frontend → 再生成の順に最初の 1 つだけ", (t) => {
  const { cfg } = setup(t);
  const d = (command, tool_response, status = " M frontend/a.ts") => decide("post-bash", { tool_input: { command }, tool_response }, { cfg, isClaude: false, gitStatus: () => status });
  assert.equal(d("./gradlew build && lake build", "BUILD SUCCESSFUL").decision, "block");
  assert.match(contextOf(d("lake build && pnpm test", "ok")), /golden-check/);
  assert.match(contextOf(d("pnpm build && ./gradlew generateKotlinFromLean", "ok")), /frontend-ux-review/);
  assert.match(contextOf(d("pnpm build && ./gradlew generateKotlinFromLean", "ok", "")), /regen-impact --report/);
  assert.match(contextOf(d("./gradlew generateKotlinFromLean", "BUILD SUCCESSFUL")), /regen-impact --report/);
  assert.equal(d("./gradlew generateKotlinFromLean", "BUILD FAILED"), null);
  assert.equal(d("ls", "ok"), null);
});

test("post-edit はパスごとに契約 → Lean → ai-notes の順に見て最初の促しだけを返し、ルートの外（../）も落とさずに見る", (t) => {
  const { cfg } = setup(t);
  const d = (tool_input, c = cfg) => decide("post-edit", { tool_input }, { cfg: c, isClaude: false, readText: () => "これは規約ではありません。" });
  assert.match(contextOf(d({ file_path: "documents/codebase/openapi.yaml" })), /^契約を変えました。.*pnpm gen:api/);
  assert.match(contextOf(d({ file_path: "lean/Demo/A.lean" })), /^Lean を変えました/);
  assert.equal(d({ file_path: "lean/lakefile.toml" }), null);
  assert.equal(d({ file_path: "README.md" }), null);
  assert.match(contextOf(d(patch("documents/ai-notes/bad.md", "lean/A.lean"))), /^ai-notes の規約/);
  assert.match(contextOf(d(patch("README.md", "lean/A.lean", "documents/codebase/openapi.yaml"))), /^Lean を変えました/);
  const { cfg: shared } = setup(t, { project: "Example", documents: { openapi: "../shared/openapi.yaml" } });
  assert.match(contextOf(d({ file_path: "../shared/openapi.yaml" }, shared)), /^契約を変えました/);
});

test("post-edit は ai-notes の .md のファイル名と冒頭 800 字の断りを見て 1 つの促しにまとめ、README.md と TEMPLATE.md を外す", (t) => {
  const { root, cfg } = setup(t);
  const read = [];
  const d = (file_path, text) => contextOf(decide("post-edit", { tool_input: { file_path } }, {
    cfg, isClaude: false, readText: (p) => { read.push(p); if (text === null) throw new Error("ENOENT"); return text; },
  })) ?? null;
  const header = "# 件名\n\n> **これは規約ではありません。**\n";
  const tail = "。ai-notes は規約ではない — ユーザーが承認したものだけが規約になる。";
  assert.equal(d("documents/ai-notes/20260101-01-topic.md", header), null);
  assert.deepEqual(read, [join(root, "documents/ai-notes/20260101-01-topic.md")]);
  assert.equal(d("documents/ai-notes/memo.md", header), `ai-notes の規約: ファイル名は YYYYMMDD-NN-<topic>.md（いまは memo.md）${tail}`);
  assert.equal(d("documents/ai-notes/memo.md", "# 件名\n"), `ai-notes の規約: ファイル名は YYYYMMDD-NN-<topic>.md（いまは memo.md） / 冒頭に「これは規約ではありません。」の断りが無い${tail}`);
  assert.equal(d("documents/ai-notes/20260101-01-topic.md", "# 件名\n"), `ai-notes の規約: 冒頭に「これは規約ではありません。」の断りが無い${tail}`);
  // 読めなければ断りは見ない
  assert.equal(d("documents/ai-notes/memo.md", null), `ai-notes の規約: ファイル名は YYYYMMDD-NN-<topic>.md（いまは memo.md）${tail}`);
  assert.equal(d("documents/ai-notes/20260101-01-topic.md", null), null);
  // サブディレクトリのノートは名前の規則に合わない。README.md は末尾の一致で外す。.md でないものは見ない
  assert.match(d("documents/ai-notes/sub/20260101-01-topic.md", header), /（いまは sub\/20260101-01-topic\.md）/);
  assert.equal(d("documents/ai-notes/README.md", "# 件名\n"), null);
  assert.equal(d("documents/ai-notes/sub/X-README.md", "# 件名\n"), null);
  assert.equal(d("documents/ai-notes/notes.yaml", "# 件名\n"), null);
  // 断りを探すのは unslop と同じ冒頭 800 字。骨格のひな形 TEMPLATE.md は unslop と同じく見ない
  assert.equal(d("documents/ai-notes/20260101-01-topic.md", "x".repeat(700) + header), null);
  assert.match(d("documents/ai-notes/20260101-01-topic.md", "x".repeat(800) + header), /断りが無い/);
  assert.equal(d("documents/ai-notes/TEMPLATE.md", "# 件名\n"), null);
  assert.equal(d("documents/ai-notes/sub/TEMPLATE.md", "# 件名\n"), null);
});

test("stop は再入なら unslop を走らせず、unslop の JSON に error があるときだけ差し戻す", (t) => {
  const { cfg } = setup(t);
  let runs = 0;
  const d = (stdout, payload = {}) => decide("stop", payload, { cfg, isClaude: false, runUnslop: () => { runs++; return stdout; } });
  const warn = { file: "e2e/a.ts", line: 1, rule: "hedge", severity: "warn", message: "逃げ言葉" };
  const error = { file: "e2e/a.ts", line: 3, rule: "empty-catch", severity: "error", message: "空の catch" };
  assert.equal(d(JSON.stringify({ findings: [error] }), { stop_hook_active: true }), null);
  assert.equal(runs, 0);
  for (const stdout of [undefined, null, "", "null", "not json", "{}", JSON.stringify({ findings: [] }), JSON.stringify({ findings: [warn] })]) assert.equal(d(stdout), null, String(stdout));
  assert.deepEqual(d(JSON.stringify({ findings: [warn, error] })),
    { decision: "block", reason: "作業ツリーの差分に unslop 違反（error）が 1 件あります。止まる前に直すこと（規約は unslop と comments）:\n- e2e/a.ts:3 [empty-catch] 空の catch" });
});

test("decide は設定の型の誤りで投げる（黙って通すのは hook.mjs）", (t) => {
  const { cfg } = setup(t);
  const edit = (file_path) => ({ tool_name: "Edit", tool_input: { file_path } });
  const bad = { ...cfg, protected: "documents/developer/**" };
  assert.match(reasonOf(decide("pre-guard", edit("backend/src/generated/A.kt"), { cfg: bad, isClaude: false })), /は生成物です/);
  assert.throws(() => decide("pre-guard", edit("documents/developer/x.md"), { cfg: bad, isClaude: false }), TypeError);
});

test("知らない mode は何も見ずに通す", (t) => {
  const { cfg } = setup(t);
  const calls = [];
  const ctx = { cfg, isClaude: true, exists: forbidden(calls, "exists"), gitStatus: forbidden(calls, "gitStatus"), leanStatus: forbidden(calls, "leanStatus"), runUnslop: forbidden(calls, "runUnslop"), readText: forbidden(calls, "readText") };
  for (const mode of ["bogus", undefined, ""]) assert.equal(decide(mode, { tool_name: "Write", tool_input: { file_path: "documents/developer/x.md" } }, ctx), null);
  assert.deepEqual(calls, []);
});
