---
name: frontend-ux-review
description: Use whenever the screens, UX, wording, feedback after actions, accessibility, or layout of frontend/ come up, even without the word "review" — delegates to the frontend-ux-reviewer agent, which runs the dev screens against the Lean CLI with Playwright and reports with evidence. Not for reviewing the domain model itself (that is the ddd skill's review).
---

# フロントエンド UX レビュー

レビュー本体は専任サブエージェント `frontend-ux-reviewer`。あなたは対象の確定 → 起動 → 中継だけ。

## 引数

なし = 現在のブランチの `frontend/` の差分とその画面の流れ / `all` = 全体 / `a11y` = アクセシビリティに寄せる / `static` = 画面を立てない / それ以外 = 画面名・観点の指定。

## 手順

1. 対象の確定: `<default>` は `git symbolic-ref refs/remotes/origin/HEAD`（無ければ main → master）。`git merge-base <default> HEAD`、`git diff <base> --stat -- frontend/`、`git status --short frontend/`。既定ブランチ上なら作業ツリーだけ。差分が空でも終わらない（UX は差分で完結しない）。
2. 足場の確認: `cradle.json` の ports（発行者・Lean CLI サーバ・dev 画面）が動いているか（`ss -ltn`）。動いているポートがこのプロジェクトのものか確かめる。
   相手は Lean CLI（`pnpm dev` の既定）。REST を相手にしない（レビューの操作が実データを動かす）。backend も DB も要らない。
   playwright の道具（`mcp__plugin_playwright_playwright__*`）が無ければ、その旨を伝えて静的レビューに落とす。
3. `frontend-ux-reviewer` を起動（バックグラウンド可）。渡すのは: ルートの絶対パス、範囲（基点 SHA とブランチ）、作業ツリーの未コミット変更も対象、変更ファイル一覧、画面を立てて触ること（`static` なら立てない）、すでに動いているポート。
   コードや diff の全文は貼らない。
4. 中継: レポートを削らずに提示する（場所・重大度・筋書き・提案・写しのパス）。「ドメインに戻す問い」は握りつぶさず ddd スキル（テーマ付き）を案内する。
   レビュアーが立てたサーバが残っていないか `ss -ltn` で確かめ、残っていれば止める。`git status` に `lean/` `frontend/` の差分が出ていないか確かめる。
5. 修正はユーザーが求めるまで行わない。残すなら `documents/ai-notes/`（冒頭に「規約ではない」）。
