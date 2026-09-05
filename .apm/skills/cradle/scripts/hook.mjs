#!/usr/bin/env node
// hook — Claude Code / Codex のライフサイクル hook。stdin の JSON を読み、判定を JSON で返す（stdin / stdout の形は両者で同じ）。
//   hook pre-guard   PreToolUse(Edit|Write|MultiEdit|NotebookEdit|Agent|Bash。Codex では apply_patch / spawn_agent が同じ matcher に掛かる):
//                    生成物・保護領域・golden・探索ドキュメントへの直接編集を止める。Bash は探索役（Codex の agent_type）が中継の道具を触るのを止めるだけ
//   hook post-edit   PostToolUse(Edit|Write|MultiEdit): 契約・Lean・ai-notes を編集したあとの促し
//   hook post-bash   PostToolUse(Bash): ビルド成功のあとにレビューを促す（gradle build → SQL 性能 + backend 設計、lake build → golden 回帰）
//   hook stop        Stop: 作業ツリーの差分に unslop 違反があれば一度だけ差し戻す
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, findProjectRoot, matchesAny, rel, git } from "./lib.mjs";

const mode = process.argv[2];
let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { payload = {}; }
const out = (obj) => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
const allow = () => process.exit(0);
// Claude Code は CLAUDE_PROJECT_DIR を渡す。Codex は環境を空にして cwd だけ stdin に入れるので、そこから cradle.json を持つ祖先を探す。
const isClaude = Boolean(process.env.CLAUDE_PROJECT_DIR);

let cfg;
try { cfg = loadConfig(findProjectRoot(payload.cwd ?? process.cwd())); } catch { allow(); }

/** 編集対象のパス。Claude Code は file_path、Codex の apply_patch は tool_input.command にパッチ本文（Add / Update / Delete File 行）が入る。 */
function targetPaths() {
  const t = payload.tool_input ?? {};
  const single = t.file_path ?? t.notebook_path ?? t.path;
  if (single) return [single];
  const patch = typeof t.command === "string" && t.command.includes("*** Begin Patch") ? t.command : null;
  if (!patch) return [];
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm), ...patch.matchAll(/^\*\*\* Move to: (.+)$/gm)].map(m => m[1].trim());
}
const base = payload.cwd ?? cfg?.root;
const toRel = (p) => rel(cfg.root, p.startsWith("/") ? p : join(base, p));

if (mode === "pre-guard") {
  const deny = (reason) => out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
  // 「止めずに確かめる」: Claude Code は ask で人間に聞ける。Codex に ask は無いので、文脈として渡して続けさせる。
  const ask = (reason) => out(isClaude
    ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } }
    : { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: reason } });
  if (payload.tool_name === "Agent" || payload.tool_name === "spawn_agent") {
    const t = payload.tool_input ?? {};
    // Codex の spawn_agent（agent_type）には背景実行の指定が無い。検査するのは Claude Code の run_in_background だけ。
    if (t.subagent_type === "ddd-domain-explorer" && t.run_in_background) deny("ddd-domain-explorer は質問中継ループのため必ずフォアグラウンド（run_in_background: false）で起動する。");
    allow();
  }
  if (payload.tool_name === "Bash") {
    // Codex はサブエージェントの役割名（agent_type）を hook に渡す。探索役は中継と片付けの道具を触らない — それは親（ddd スキル）の仕事。
    if (payload.agent_type === "ddd-domain-explorer" && /ddd\.mjs\s+(start|questions|answers|end)\b|ddd-clean-check|questions\.md|\/\.session\b/.test(String(payload.tool_input?.command ?? ""))) {
      deny("探索役（ddd-domain-explorer）は ddd.mjs・questions.md・.session に触りません。問いは [QUESTIONS] で親に返し、回答の中継と片付けは親（ddd スキル）が行います。");
    }
    allow();
  }
  const paths = targetPaths().map(toRel).filter(p => !p.startsWith("../"));
  if (!paths.length) allow();

  const generated = [
    ...cfg.backend.generated.map(g => `${g.replace(/\/$/, "")}/**`),
    ...cfg.frontend.generated.map(g => `${g.replace(/\/$/, "")}/**`),
    "**/build/generated/**",
  ];
  const ddd = cfg.documents.ddd.replace(/\/$/, "");
  for (const path of paths) {
    if (matchesAny(path, generated)) deny(`${path} は生成物です。手で直さず、源（Lean モデル / openapi.yaml / schema.sql）を直して再生成してください（backend: ${cfg.backend.regenerate} / frontend: ${cfg.frontend.genApi}）。再生成で全上書きされる場所への編集は必ず消えます。`);
    if (matchesAny(path, cfg.protected)) deny(`${path} は保護領域です（人間専用）。AI は新規作成も編集もしません。申し送りは ${cfg.documents.aiNotes}/ に書いてください。`);
    if (matchesAny(path, [`${cfg.lean.golden}/*-init.json`, `${cfg.lean.golden}/*-flow.json`])) deny(`${path} は golden（CLI の応答そのもの）です。手で書かず、モックアップの「golden として保存」か golden-check --update で Lean に吐かせてください。`);
    // 正式ドキュメント 3 つは ddd スキルのセッション中だけ編集できる。受信箱（ux-review / model-review）は起票役のエージェントが書くので常に可。
    if (matchesAny(path, [`${ddd}/event-timeline.md`, `${ddd}/hotspots.md`, `${ddd}/ubiquitous-language.md`])) {
      if (!existsSync(join(cfg.root, ddd, ".session"))) deny(`${path} は探索の正式ドキュメントです。更新は ddd スキル（探索セッション）経由だけで、直接編集しません。セッションが動いている間だけ ${ddd}/.session が置かれ、編集できます。`);
    }
  }
  // 開発の順序: Lean に未コミットの差分があるまま backend の本番コードを触るのは先回りの疑い（止めずに確かめる）
  if (paths.some(path => path.startsWith(`${cfg.backend.dir}/src/main/`))) {
    let leanDirty = "";
    try { leanDirty = git(cfg.root, ["status", "--porcelain", "--", cfg.lean.dir]); } catch {}
    if (leanDirty) ask(`${cfg.lean.dir}/ に未コミットの差分があります。順序は Lean → 画面で人間が確認 → バックエンド。モデルの変更が確定（コミット）してから backend に追随するのが規約です。先回りではないなら続けてください。`);
  }
  allow();
}

if (mode === "post-bash") {
  const command = String(payload.tool_input?.command ?? "");
  const resp = payload.tool_response ?? {};
  const text = typeof resp === "string" ? resp : JSON.stringify(resp);
  const failed = /BUILD FAILED|FAILURE:|error:|Error:|failed/.test(text) && !/BUILD SUCCESSFUL/.test(text);
  const isGradleBuild = /(^|[;&|]\s*)(\S*\/)?gradlew(\.bat)?\b[^;&|]*\b(build|test|check)\b/.test(command);
  const isLakeBuild = /(^|[;&|]\s*)lake\s+build\b/.test(command);
  const isRegen = /generateKotlinFromLean/.test(command);
  if (isGradleBuild && !failed && /BUILD SUCCESSFUL/.test(text)) {
    out({ decision: "block", reason: "ビルドが成功しました。次に (1) sql-perf-review スキルで現在のブランチの SQL・スキーマ変更を性能観点でレビューし、(2) backend-design-review スキルで認証・認可・外部連携・ログ設計を点検すること。High/Medium の指摘は提示するだけで終わらせず、その場で直す。どちらのスキルも対象なしと判断すればそれで終えてよい。" });
  }
  if (isLakeBuild && !failed) {
    out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "lake build が通りました。モデルを変えたなら `cradle golden-check` を走らせ、変えるつもりのなかった流れ（golden）が変わっていないことを確かめてから先へ進むこと。変わっていたら意図した変更かを判断し、意図したものだけ --update で更新する。" } });
  }
  const isFrontendCheck = /(^|[;&|]\s*)(pnpm|npm|yarn)\s+(run\s+)?(build|test|typecheck|lint)\b/.test(command);
  if (isFrontendCheck && !failed && !/error|failed|✗/i.test(text)) {
    let touched = false;
    try { touched = git(cfg.root, ["status", "--porcelain", "--", cfg.frontend.dir]).length > 0; } catch {}
    if (touched) out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "frontend に未コミットの変更があります。画面・文言・操作を変えたなら frontend-ux-review スキルで、Lean CLI 相手の画面を実際に触って確かめること（相手を REST にしない）。" } });
  }
  if (isRegen && !failed) {
    out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "生成物が更新されました。`cradle regen-impact --report` で、変わった生成シンボルとそれを参照する手書き実装・契約テストの一覧（影響範囲）を確認してから実装に着手すること。" } });
  }
  allow();
}

if (mode === "post-edit") {
  const ctx = (msg) => out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } });
  for (const path of targetPaths().map(toRel)) {
    if (path === cfg.documents.openapi) ctx(`契約を変えました。backend は generateApi（compileKotlin が依存）、frontend は ${cfg.frontend.genApi} で生成し直し、写し漏れをコンパイルエラーで出すこと。契約に書かないもの（ID・経緯・存在しない操作・申し送り）が混ざっていないか見直す。`);
    if (path.startsWith(cfg.lean.dir + "/") && path.endsWith(".lean")) ctx("Lean を変えました。`cd lean && lake build` → `cradle lean-check` → `cradle golden-check` の順に確かめる。変わった golden は意図した変更だけ --update。");
    if (path.startsWith(cfg.documents.aiNotes + "/") && path.endsWith(".md") && !path.endsWith("README.md")) {
      const name = path.slice(cfg.documents.aiNotes.length + 1);
      const problems = [];
      if (!/^\d{8}-\d{2}-[a-z0-9-]+\.md$/.test(name)) problems.push(`ファイル名は YYYYMMDD-NN-<topic>.md（いまは ${name}）`);
      try { const head = readFileSync(join(cfg.root, path), "utf8").slice(0, 600); if (!/規約ではありません/.test(head)) problems.push("冒頭に「これは規約ではありません。」の断りが無い"); } catch {}
      if (problems.length) ctx(`ai-notes の規約: ${problems.join(" / ")}。ai-notes は規約ではない — ユーザーが承認したものだけが規約になる。`);
    }
  }
  allow();
}

if (mode === "stop") {
  if (payload.stop_hook_active) allow();
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "unslop-lint.mjs"), "--json"], { cwd: cfg.root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let result = null;
  try { result = JSON.parse(r.stdout || "null"); } catch { allow(); }
  if (!result || !result.findings?.length) allow();
  const errors = result.findings.filter(f => f.severity === "error");
  if (!errors.length) allow();
  const lines = errors.slice(0, 15).map(f => `- ${f.file}:${f.line} [${f.rule}] ${f.message}`).join("\n");
  out({ decision: "block", reason: `作業ツリーの差分に unslop 違反（error）が ${errors.length} 件あります。止まる前に直すこと（規約は unslop と comments）:\n${lines}${errors.length > 15 ? "\n…（cradle unslop --diff で全件）" : ""}` });
}

allow();
