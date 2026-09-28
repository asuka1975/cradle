---
name: lean-model-review
description: Use after lake build succeeds on a changed Lean model, or before leaving the Lean formalization phase — delegates to the lean-model-reviewer agent to check lean/ against documents/ddd: a guarantee theorem per resolved HS, whether theorems say what the HS says, empty theorems, where the rules live, and representation choices the documents do not back.
---

# 形式化レビュー（保証の定理・HS との一致・表現の選択）

レビュー本体は専任サブエージェント `lean-model-reviewer`。あなたは対象の確定 → 起動 → 中継だけ。

1. 対象: 現在のブランチの差分 + 作業ツリー（基点は `git symbolic-ref refs/remotes/origin/HEAD`、無ければ main → master、との `merge-base`。既定ブランチ上なら作業ツリーだけ）。`lean/` にも `documents/ddd/` にも差分が無ければその旨を報告して終える。ただし初回は全体を対象にする。`cradle status` が Lean を「骨格のサンプル」と言う間は対象が無い。
2. `lean-model-reviewer` を起動（バックグラウンド可）。渡すのは: ルートの絶対パス、基点 SHA とブランチ、変更ファイル一覧、`cradle.json` の場所。diff 全文は貼らない。
3. レポートを削らずに提示する。High / Medium は lean-domain-model スキルで直す（保証の定理を足す・直す、散った規則をまとめる）。表現の選択の指摘は、レポートの文案で `model-review.md` に MQ として起票する（documents の正式ドキュメントは書き換えない）。
