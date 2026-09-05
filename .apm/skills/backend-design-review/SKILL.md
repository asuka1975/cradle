---
name: backend-design-review
description: Use after a backend build succeeds or whenever authentication, authorization, actor/identity handling, external service calls (IdP, JWKS, DB, clock), logging, observability, configuration or error contracts are in play — delegates to the backend-design-reviewer agent for a design-quality review of the current branch.
---

# バックエンド設計レビュー（認証・認可・外部連携・ログ・設定）

レビュー本体は専任サブエージェント `backend-design-reviewer`。あなたは対象の確定 → 起動 → 中継だけ。

1. 対象: 現在のブランチの差分 + 作業ツリー（基点は `git symbolic-ref refs/remotes/origin/HEAD`、無ければ main → master、との `merge-base`。既定ブランチ上なら作業ツリーだけ）。差分が backend に無ければその旨を報告して終える。ただし初回（レビュー記録が無い）は全体を対象にする。
2. `backend-design-reviewer` を起動（バックグラウンド可）。渡すのは: ルートの絶対パス、基点 SHA とブランチ、変更ファイル一覧、`cradle.json` の場所。diff 全文は貼らない。
3. レポートを削らずに提示する。High / Medium はその場で直す（ビルド後の hook から呼ばれたとき）。設計判断を含むものは `documents/ai-notes/` に選択肢を書き置いてユーザーに判断させる。
