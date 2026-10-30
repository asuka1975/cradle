// hook-decide — hook の判定。応答のオブジェクトを返し、黙って通すときは null を返す（stdin・設定の読み込み・書き出しと終了は hook.mjs）。
// ファイル・git・unslop は ctx から受け取るので、プロセスを起こさずに判定の順序と正規表現を確かめられる。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { matchesAny, rel, git, cradleScript, aiNoteProblems } from "./lib.mjs";
import { unslopErrorSummary } from "./unslop-report.mjs";

/** 編集対象のパス。Claude Code は file_path、Codex の apply_patch は tool_input.command にパッチ本文（Add / Update / Delete File 行）が入る。 */
export function targetPaths(payload) {
  const t = payload.tool_input ?? {};
  const single = t.file_path ?? t.notebook_path ?? t.path;
  if (single) return [single];
  const patch = typeof t.command === "string" && t.command.includes("*** Begin Patch") ? t.command : null;
  if (!patch) return [];
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm), ...patch.matchAll(/^\*\*\* Move to: (.+)$/gm)].map(m => m[1].trim());
}

/** mode の判定。先に当たった応答だけを返す（後ろの検査は走らせない）。readText は読めなければ投げる。 */
export function decide(mode, payload, {
  cfg, isClaude,
  exists = existsSync,
  gitStatus = (dir) => git(cfg.root, ["status", "--porcelain", "--", dir]),
  runUnslop = () => spawnSync(process.execPath, [cradleScript("unslop-lint.mjs"), "--json"], { cwd: cfg.root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).stdout,
  readText = (p) => readFileSync(p, "utf8"),
}) {
  const base = payload.cwd ?? cfg.root;
  const toRel = (p) => rel(cfg.root, p.startsWith("/") ? p : join(base, p));

  if (mode === "pre-guard") {
    const deny = (reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
    // 「止めずに確かめる」: Claude Code は ask で人間に聞ける。Codex に ask は無いので、文脈として渡して続けさせる。
    const ask = (reason) => isClaude
      ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } }
      : { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: reason } };
    if (payload.tool_name === "Agent" || payload.tool_name === "spawn_agent") {
      const t = payload.tool_input ?? {};
      // Codex の spawn_agent（agent_type）には背景実行の指定が無い。検査するのは Claude Code の run_in_background だけ。
      if (t.subagent_type === "ddd-domain-explorer" && t.run_in_background) return deny("ddd-domain-explorer は質問中継ループのため必ずフォアグラウンド（run_in_background: false）で起動する。");
      return null;
    }
    if (payload.tool_name === "Bash") {
      // Codex はサブエージェントの役割名（agent_type）を hook に渡す。探索役は中継と片付けの道具を触らない — それは親（ddd スキル）の仕事。
      if (payload.agent_type === "ddd-domain-explorer" && /ddd\.mjs\s+(start|questions|answers|end)\b|ddd-clean-check|questions\.md|\/\.session\b/.test(String(payload.tool_input?.command ?? ""))) {
        return deny("探索役（ddd-domain-explorer）は ddd.mjs・questions.md・.session に触りません。問いは [QUESTIONS] で親に返し、回答の中継と片付けは親（ddd スキル）が行います。");
      }
      return null;
    }
    const paths = targetPaths(payload).map(toRel).filter(p => !p.startsWith("../"));
    if (!paths.length) return null;

    const generated = [
      ...cfg.backend.generated.map(g => `${g.replace(/\/$/, "")}/**`),
      ...cfg.frontend.generated.map(g => `${g.replace(/\/$/, "")}/**`),
      "**/build/generated/**",
    ];
    const ddd = cfg.documents.ddd.replace(/\/$/, "");
    for (const path of paths) {
      if (matchesAny(path, generated)) return deny(`${path} は生成物です。手で直さず、源（Lean モデル / openapi.yaml / schema.sql）を直して再生成してください（backend: ${cfg.backend.regenerate} / frontend: ${cfg.frontend.genApi}）。再生成で全上書きされる場所への編集は必ず消えます。`);
      if (matchesAny(path, cfg.protected)) return deny(`${path} は保護領域です（人間専用）。AI は新規作成も編集もしません。申し送りは ${cfg.documents.aiNotes}/ に書いてください。`);
      if (matchesAny(path, [`${cfg.lean.golden}/*-init.json`, `${cfg.lean.golden}/*-flow.json`])) return deny(`${path} は golden（CLI の応答そのもの）です。手で書かず、モックアップの「golden として保存」か golden-check --update で Lean に吐かせてください。`);
      // 正式ドキュメント 3 つは ddd スキルのセッション中だけ編集できる。受信箱（ux-review / model-review）は起票役のエージェントが書くので常に可。
      if (matchesAny(path, [`${ddd}/event-timeline.md`, `${ddd}/hotspots.md`, `${ddd}/ubiquitous-language.md`])) {
        if (!exists(join(cfg.root, ddd, ".session"))) return deny(`${path} は探索の正式ドキュメントです。更新は ddd スキル（探索セッション）経由だけで、直接編集しません。セッションが動いている間だけ ${ddd}/.session が置かれ、編集できます。`);
      }
    }
    // 開発の順序: Lean に未コミットの差分があるまま backend の本番コードを触るのは先回りの疑い（止めずに確かめる）
    if (paths.some(path => path.startsWith(`${cfg.backend.dir}/src/main/`))) {
      let leanDirty = "";
      try { leanDirty = gitStatus(cfg.lean.dir); } catch {}
      if (leanDirty) return ask(`${cfg.lean.dir}/ に未コミットの差分があります。順序は Lean → 画面で人間が確認 → バックエンド。モデルの変更が確定（コミット）してから backend に追随するのが規約です。先回りではないなら続けてください。`);
    }
    return null;
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
      return { decision: "block", reason: "ビルドが成功しました。次に (1) sql-perf-review スキルで現在のブランチの SQL・スキーマ変更を性能観点でレビューし、(2) backend-design-review スキルで認証・認可・外部連携・ログ設計を点検すること。High/Medium の指摘は提示するだけで終わらせず、その場で直す。どちらのスキルも対象なしと判断すればそれで終えてよい。" };
    }
    if (isLakeBuild && !failed) {
      return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "lake build が通りました。モデルを変えたなら `cradle golden-check` を走らせ、変えるつもりのなかった流れ（golden）が変わっていないことを確かめてから先へ進むこと。変わっていたら意図した変更かを判断し、意図したものだけ --update で更新する。定理・規則・集約の形を変えたなら lean-domain-model スキルの Evaluator（lean-modeling-evaluator）で、形式化を resolved HS と突き合わせる（網羅・保証の定理の中身・表現の選択）。" } };
    }
    const isFrontendCheck = /(^|[;&|]\s*)(pnpm|npm|yarn)\s+(run\s+)?(build|test|typecheck|lint)\b/.test(command);
    if (isFrontendCheck && !failed && !/error|failed|✗/i.test(text)) {
      let touched = false;
      try { touched = gitStatus(cfg.frontend.dir).length > 0; } catch {}
      if (touched) return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "frontend に未コミットの変更があります。画面・文言・操作を変えたなら frontend-ux-review スキルで、Lean CLI 相手の画面を実際に触って確かめること（相手を REST にしない）。" } };
    }
    if (isRegen && !failed) {
      return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "生成物が更新されました。`cradle regen-impact --report` で、変わった生成シンボルとそれを参照する手書き実装・契約テストの一覧（影響範囲）を確認してから実装に着手すること。" } };
    }
    return null;
  }

  if (mode === "post-edit") {
    const ctx = (msg) => ({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } });
    for (const path of targetPaths(payload).map(toRel)) {
      if (path === cfg.documents.openapi) return ctx(`契約を変えました。backend は generateApi（compileKotlin が依存）、frontend は ${cfg.frontend.genApi} で生成し直し、写し漏れをコンパイルエラーで出すこと。契約に書かないもの（ID・経緯・存在しない操作・申し送り）が混ざっていないか見直す。`);
      if (path.startsWith(cfg.lean.dir + "/") && path.endsWith(".lean")) return ctx("Lean を変えました。`cd lean && lake build` → `cradle lean-check` → `cradle golden-check` の順に確かめる。変わった golden は意図した変更だけ --update。");
      // 外すファイル・名前・断りを探す範囲は unslop と同じ aiNoteProblems。ここで ai-notes の下に絞るのは、ほかの .md を読まないため
      if (path.startsWith(cfg.documents.aiNotes + "/") && path.endsWith(".md")) {
        let text = null;
        try { text = readText(join(cfg.root, path)); } catch {}
        const note = aiNoteProblems(cfg.documents.aiNotes, path, text);
        const problems = [];
        if (note?.badName) problems.push(`ファイル名は YYYYMMDD-NN-<topic>.md（いまは ${note.name}）`);
        if (note?.noHeader) problems.push("冒頭に「これは規約ではありません。」の断りが無い");
        if (problems.length) return ctx(`ai-notes の規約: ${problems.join(" / ")}。ai-notes は規約ではない — ユーザーが承認したものだけが規約になる。`);
      }
    }
    return null;
  }

  if (mode === "stop") {
    if (payload.stop_hook_active) return null;
    const stdout = runUnslop();
    let result = null;
    try { result = JSON.parse(stdout || "null"); } catch { return null; }
    if (!result || !result.findings?.length) return null;
    const reason = unslopErrorSummary(result.findings, { lead: (n) => `作業ツリーの差分に unslop 違反（error）が ${n} 件あります。止まる前に直すこと（規約は unslop と comments）:`, full: "cradle unslop --diff" });
    if (reason === null) return null;
    return { decision: "block", reason };
  }

  return null;
}
