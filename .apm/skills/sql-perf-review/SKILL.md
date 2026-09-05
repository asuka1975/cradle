---
name: sql-perf-review
description: Use whenever SQL, ORM/jOOQ code, schema or migrations, indexes, N+1, or database load are in play, even without the word "review" — delegates the performance review of the current branch diff to the sql-performance-reviewer agent.
---

# SQL パフォーマンスレビュー

レビュー本体は専任サブエージェント `sql-performance-reviewer`。あなたは対象の確定 → 起動 → 中継だけ。

1. 対象: `git merge-base <default> HEAD` から HEAD + 作業ツリー（staged / unstaged / 未追跡）。`<default>` は `git symbolic-ref refs/remotes/origin/HEAD`（無ければ main → master の順で存在確認）。既定ブランチ上にいるなら作業ツリーだけ。`git diff <base> --stat`、`git status --short`。
   SQL 関連 = `.sql`・スキーマ・マイグレーション・ORM / クエリビルダの呼び出し・SQL 文字列・接続やプールの設定。明白に無ければその旨を報告して終える。迷ったら起動する。
2. `sql-performance-reviewer` を起動（バックグラウンド可）。渡すのは: ルートの絶対パス、基点 SHA とブランチ名、作業ツリーも対象、変更ファイル一覧。diff 全文は貼らない。
3. レポートを削らずに提示する（場所・重大度・遅くなる仕組み・修正案）。
4. ビルド後の hook から呼ばれたときは、High / Medium をその場で直す（提示で終えない）。それ以外はユーザーが求めるまで直さない。
