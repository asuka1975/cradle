---
name: unslop
description: Use before finishing a change, or when asked to clean up, review for slop, drift, stale docs, or duplicated rules — runs the deterministic unslop lint and, for prose-level slop, delegates to the unslop-reviewer agent.
---

# unslop — 痕跡と写しを消す

1. `cradle unslop --diff`（作業ツリーの差分）か `--all`（全体）を走らせ、error を全部直す。warn は理由を持って残すか直す。
2. 散文の slop（規約の二重化・別プロダクトの残滓・日付や経緯の混入・README の腐り）は機械で拾いきれない。
   `unslop-reviewer` エージェントをバックグラウンドで起動し、対象（差分 / ディレクトリ）を渡す。レポートの指摘は提示で終えず直す。
3. 直したら再度 `cradle unslop`。

## 直し方の原則

- 写しは消して参照にする。数量は消してスクリプトに数えさせる。
- 経緯は ai-notes へ移す（規約本文には残さない）。
- 別プロダクトの例・パスは、このプロジェクトの実物に置き換えるか消す。
- 機械除去のあとは残った文を読み直し、主語と理由の抜けた文を直す。
