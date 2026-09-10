// Pi専用の判定処理。既存のClaude/Codex hookを変更しないため、判定は独立して持つ。
// 設定・パス・Git処理とunslop検査器は、既存の実装を変更せず利用する。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, findProjectRoot, matchesAny, rel, git } from "./lib.mjs";

/**
 * 操作の種別。
 * - "agent": 子エージェントの起動
 * - "bash": シェルコマンド
 * - "edit": ファイル編集（Edit / MultiEdit / apply_patch / NotebookEdit）
 * - "write": ファイル作成・上書き（Write / Add File）
 * - "read": 読み取り（ガード対象外だが中継制限の対象になりうる）
 * - "unknown": その他
 */

/** 編集対象のパスを正規化する。 */
export function normalizeTargetPaths(toolName, toolInput, basePath, projectRoot) {
  const input = toolInput ?? {};
  const single = input.file_path ?? input.notebook_path ?? input.path;
  if (single) return [toRelative(projectRoot, basePath, single)];

  const patch = typeof input.command === "string" && input.command.includes("*** Begin Patch") ? input.command : null;
  if (!patch) return [];
  const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm;
  const out = [];
  let m;
  while ((m = re.exec(patch)) !== null) {
    out.push(toRelative(projectRoot, basePath, (m[1] ?? m[2]).trim()));
  }
  return out;
}

function toRelative(root, base, p) {
  const abs = p.startsWith("/") ? p : join(base ?? root, p);
  return rel(root, abs);
}

/** 操作が属する種別を判定する。 */
export function classifyOperation(toolName) {
  if (!toolName) return "unknown";
  const t = String(toolName);
  if (t === "Agent" || t === "spawn_agent") return "agent";
  if (t === "Bash" || t === "bash") return "bash";
  if (t === "Write" || t === "write") return "write";
  if (t === "Edit" || t === "edit" || t === "MultiEdit" || t === "multiedit" || t === "NotebookEdit" || t === "notebookedit" || t === "apply_patch") return "edit";
  if (t === "Read" || t === "read") return "read";
  return "unknown";
}

/**
 * 編集・書込み・子エージェント起動・中継Bashに対する事前判定。
 * 戻り値:
 *   { action: "allow" }
 *   { action: "deny", reason }
 *   { action: "ask", reason }      （呼び出し側が確認操作へ変換）
 *   { action: "remind", message }  （止めずに注意を出す）
 */
export function evaluatePreGuard({
  projectRoot,
  cfg,
  toolName,
  toolInput,
  basePath,
  agentType,
  runInBackground,
  isClaudeLike = false,
}) {
  cfg ??= loadConfigSafe(projectRoot);
  if (!cfg) return { action: "allow" };

  const op = classifyOperation(toolName);

  if (op === "agent") {
    const subagentType = toolInput?.subagent_type ?? agentType;
    if (subagentType === "ddd-domain-explorer" && runInBackground) {
      return { action: "deny", reason: "ddd-domain-explorer は質問中継ループのため必ずフォアグラウンド（run_in_background: false）で起動する。" };
    }
    return { action: "allow" };
  }

  if (op === "bash") {
    if (agentType === "ddd-domain-explorer" && /ddd\.mjs\s+(start|questions|answers|end)\b|ddd-clean-check|questions\.md|\/\.session\b/.test(String(toolInput?.command ?? ""))) {
      return { action: "deny", reason: "探索役（ddd-domain-explorer）は ddd.mjs・questions.md・.session に触りません。問いは [QUESTIONS] で親に返し、回答の中継と片付けは親（ddd スキル）が行います。" };
    }
    return { action: "allow" };
  }

  if (op !== "edit" && op !== "write") return { action: "allow" };

  const paths = normalizeTargetPaths(toolName, toolInput, basePath, projectRoot)
    .filter(p => !p.startsWith("../"));
  if (!paths.length) return { action: "allow" };

  const generated = [
    ...cfg.backend.generated.map(g => `${g.replace(/\/$/, "")}/**`),
    ...cfg.frontend.generated.map(g => `${g.replace(/\/$/, "")}/**`),
    "**/build/generated/**",
  ];
  const ddd = cfg.documents.ddd.replace(/\/$/, "");

  for (const path of paths) {
    if (matchesAny(path, generated)) {
      return { action: "deny", reason: `${path} は生成物です。手で直さず、源（Lean モデル / openapi.yaml / schema.sql）を直して再生成してください（backend: ${cfg.backend.regenerate} / frontend: ${cfg.frontend.genApi}）。再生成で全上書きされる場所への編集は必ず消えます。` };
    }
    if (matchesAny(path, cfg.protected)) {
      return { action: "deny", reason: `${path} は保護領域です（人間専用）。AI は新規作成も編集もしません。申し送りは ${cfg.documents.aiNotes}/ に書いてください。` };
    }
    if (matchesAny(path, [`${cfg.lean.golden}/*-init.json`, `${cfg.lean.golden}/*-flow.json`])) {
      return { action: "deny", reason: `${path} は golden（CLI の応答そのもの）です。手で書かず、モックアップの「golden として保存」か golden-check --update で Lean に吐かせてください。` };
    }
    if (matchesAny(path, [`${ddd}/event-timeline.md`, `${ddd}/hotspots.md`, `${ddd}/ubiquitous-language.md`])) {
      if (!existsSync(join(cfg.root, ddd, ".session"))) {
        return { action: "deny", reason: `${path} は探索の正式ドキュメントです。更新は ddd スキル（探索セッション）経由だけで、直接編集しません。セッションが動いている間だけ ${ddd}/.session が置かれ、編集できます。` };
      }
    }
  }

  // 開発の順序: Lean に未コミットの差分があるまま backend の本番コードを触るのは先回りの疑い（止めずに確かめる）
  if (paths.some(path => path.startsWith(`${cfg.backend.dir}/src/main/`))) {
    let leanDirty = "";
    try { leanDirty = git(cfg.root, ["status", "--porcelain", "--", cfg.lean.dir]); } catch {}
    if (leanDirty) {
      const reason = `${cfg.lean.dir}/ に未コミットの差分があります。順序は Lean → 画面で人間が確認 → バックエンド。モデルの変更が確定（コミット）してから backend に追随するのが規約です。先回りではないなら続けてください。`;
      return isClaudeLike ? { action: "ask", reason } : { action: "remind", message: reason };
    }
  }

  return { action: "allow" };
}

/**
 * Bash実行後の判定。成功時の促しを返す。失敗時はnull。
 * 戻り値: { action: "block", reason } | { action: "remind", message } | null
 */
export function evaluatePostBash({ projectRoot, cfg, command, toolResponse }) {
  cfg ??= loadConfigSafe(projectRoot);
  if (!cfg) return null;

  const text = typeof toolResponse === "string" ? toolResponse : JSON.stringify(toolResponse ?? {});
  const failed = /BUILD FAILED|FAILURE:|error:|Error:|failed/.test(text) && !/BUILD SUCCESSFUL/.test(text);
  const isGradleBuild = /(^|[;&|]\s*)(\S*\/)?gradlew(\.bat)?\b[^;&|]*\b(build|test|check)\b/.test(command);
  const isLakeBuild = /(^|[;&|]\s*)lake\s+build\b/.test(command);
  const isRegen = /generateKotlinFromLean/.test(command);

  if (isGradleBuild && !failed && /BUILD SUCCESSFUL/.test(text)) {
    return { action: "block", reason: "ビルドが成功しました。次に (1) sql-perf-review スキルで現在のブランチの SQL・スキーマ変更を性能観点でレビューし、(2) backend-design-review スキルで認証・認可・外部連携・ログ設計を点検すること。High/Medium の指摘は提示するだけで終わらせず、その場で直す。どちらのスキルも対象なしと判断すればそれで終えてよい。" };
  }
  if (isLakeBuild && !failed) {
    return { action: "remind", message: "lake build が通りました。モデルを変えたなら `cradle golden-check` を走らせ、変えるつもりのなかった流れ（golden）が変わっていないことを確かめてから先へ進むこと。変わっていたら意図した変更かを判断し、意図したものだけ --update で更新する。" };
  }
  const isFrontendCheck = /(^|[;&|]\s*)(pnpm|npm|yarn)\s+(run\s+)?(build|test|typecheck|lint)\b/.test(command);
  if (isFrontendCheck && !failed && !/error|failed|✗/i.test(text)) {
    let touched = false;
    try { touched = git(cfg.root, ["status", "--porcelain", "--", cfg.frontend.dir]).length > 0; } catch {}
    if (touched) {
      return { action: "remind", message: "frontend に未コミットの変更があります。画面・文言・操作を変えたなら frontend-ux-review スキルで、Lean CLI 相手の画面を実際に触って確かめること（相手を REST にしない）。（correction: コメント規約）" };
    }
  }
  if (isRegen && !failed) {
    return { action: "remind", message: "生成物が更新されました。`cradle regen-impact --report` で、変わった生成シンボルとそれを参照する手書き実装・契約テストの一覧（影響範囲）を確認してから実装に着手すること。" };
  }
  return null;
}

/**
 * 編集実行後の判定。促しメッセージを返す。対象外ならnull。
 */
export function evaluatePostEdit({ projectRoot, cfg, toolName, toolInput, basePath }) {
  cfg ??= loadConfigSafe(projectRoot);
  if (!cfg) return null;

  const paths = normalizeTargetPaths(toolName, toolInput, basePath, projectRoot)
    .filter(p => !p.startsWith("../"));

  const messages = [];
  for (const path of paths) {
    if (path === cfg.documents.openapi) {
      messages.push(`契約を変えました。backend は generateApi（compileKotlin が依存）、frontend は ${cfg.frontend.genApi} で生成し直し、写し漏れをコンパイルエラーで出すこと。契約に書かないもの（ID・経緯・存在しない操作・申し送り）が混ざっていないか見直す。`);
    }
    if (path.startsWith(cfg.lean.dir + "/") && path.endsWith(".lean")) {
      messages.push("Lean を変えました。`cd lean && lake build` → `cradle lean-check` → `cradle golden-check` の順に確かめる。変わった golden は意図した変更だけ --update。");
    }
    if (path.startsWith(cfg.documents.aiNotes + "/") && path.endsWith(".md") && !path.endsWith("README.md")) {
      const name = path.slice(cfg.documents.aiNotes.length + 1);
      const problems = [];
      if (!/^\d{8}-\d{2}-[a-z0-9-]+\.md$/.test(name)) problems.push(`ファイル名は YYYYMMDD-NN-<topic>.md（いまは ${name}）`);
      try { const head = readFileSync(join(cfg.root, path), "utf8").slice(0, 600); if (!/規約ではありません/.test(head)) problems.push("冒頭に「これは規約ではありません。」の断りが無い"); } catch {}
      if (problems.length) messages.push(`ai-notes の規約: ${problems.join(" / ")}。ai-notes は規約ではない — ユーザーが承認したものだけが規約になる。`);
    }
  }
  if (!messages.length) return null;
  return { action: "remind", message: messages.join("\n") };
}

/**
 * Stop相当の終了検査。unslop違反があれば{ action: "block", reason }、なければnull。
 */
export function evaluateStopCheck({ projectRoot, cfg, stopHookActive = false, unslopRunner = runUnslopJson }) {
  if (stopHookActive) return null;
  cfg ??= loadConfigSafe(projectRoot);
  if (!cfg) return null;

  const result = unslopRunner(cfg.root);
  if (!result || !result.findings?.length) return null;
  const errors = result.findings.filter(f => f.severity === "error");
  if (!errors.length) return null;
  const lines = errors.slice(0, 15).map(f => `- ${f.file}:${f.line} [${f.rule}] ${f.message}`).join("\n");
  return { action: "block", reason: `作業ツリーの差分に unslop 違反（error）が ${errors.length} 件あります。止まる前に直すこと（規約は unslop と comments）:\n${lines}${errors.length > 15 ? "\n…（cradle unslop --diff で全件）" : ""}` };
}

import { spawnSync as _spawnSync } from "node:child_process";
import { join as _join } from "node:path";

/** --diff では見えない未追跡ファイルも含めて検査する。 */
function runUnslopJson(root) {
  const scriptDir = import.meta?.dirname ?? root;
  const r = _spawnSync(process.execPath, [_join(scriptDir, "unslop-lint.mjs"), "--all", "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try { return JSON.parse(r.stdout || "null"); } catch { return null; }
}

function loadConfigSafe(root) {
  try { return loadConfig(findProjectRoot(root)); } catch { return null; }
}
