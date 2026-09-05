---
name: ddd
description: Use to run or continue domain exploration with the product owner as domain expert — event storming interviews, hotspots (HS), ubiquitous language, UX review of the domain, checking or resolving open MQ/UX items, or a status summary of documents/ddd. Also use when the user starts explaining their business, purpose or workflow. Never edit documents/ddd directly; go through this skill.
---

# 探索ループ（/ddd）

`documents/ddd/` を育てる。登場人物:

- **ユーザー** = ドメインエキスパート。事実を知る唯一の存在。
- **`ddd-domain-explorer`**（フェーズ 1）= ファシリテータ。聞き取って正式ドキュメントを更新する。実装の問いは聞かない。
- **`ddd-ux-reviewer`** = 不在の利用者の代弁。`ux-review.md` に仮説を起票する。
- **`lean-domain-modeler`**（フェーズ 2）= 形式化役。正式ドキュメントを `lean/` に翻訳し、詰まった曖昧さを `model-review.md` に MQ として起票する。
- **あなた** = 中継役。探索の中身に立ち入らない。正式ドキュメントを直接編集しない。

道具: `node .claude/skills/ddd/scripts/ddd.mjs <start|questions|answers|end|status>`（以下 `ddd.mjs`）。

## 引数

| 引数 | 動き |
|---|---|
| なし / `session` | フルループ |
| `status` | `ddd.mjs status` の出力を示すだけ |
| `review` | UX レビューだけ |
| `clean` | 後片付けだけ（手順 5） |
| それ以外 | テーマ指定でフルループ（例: `/ddd MQ-003 を検証したい`） |

## フルループ

1. **開始**: `ddd.mjs start`（5 ファイルの存在確認と `.session` 印。印がある間だけ hook が `documents/ddd/` の編集を許す）。
2. **セッション起動**: Agent ツールで `ddd-domain-explorer` を **フォアグラウンド**（`run_in_background: false`）で起動する。
   プロンプトに書くのは「探索セッションを 1 回実施する」「その時点で聞けるものは 1 巡に全部載せる」「テーマ: …（指定があれば）」だけ。現状の要約は渡さない（自分で読む）。
3. **質問中継**（`[SESSION_REPORT]` が返るまで繰り返す）:
   - explorer が `[QUESTIONS]` + JSON を返す → 問いが少なければ（その時点で聞けるものが他にあるなら）SendMessage で差し戻す。
   - `ddd.mjs questions @<json を保存したファイル>` で `documents/ddd/questions.md` を書く（改変せず写す。書式は `references/question-format.md`）。
   - 選択肢ごとのプローブを用意する: 状態で表せるものは `Runtime/Scenarios.lean` に一時シナリオ（`probe-q1-a` 命名）、規則が変わるものは一時の枝。JS でこしらえない。用意できない選択肢は表に「—」と理由。
   - `cd lean && lake build` が通ることを確かめる（通らないプローブは出さない）。
   - ユーザーには**ファイルの場所と起動コマンドだけ**を伝えて待つ。問いをチャットに書き写さない。
   - 回答が来たら `ddd.mjs answers` の出力（「質問 → 回答」の列、空欄は「未回答」）を **一字一句そのまま** SendMessage で explorer に返す。回答の代わりの指示（中断・テーマ変更）もそのまま伝える。
   - 2 巡目以降は前の巡のプローブを片づけてから次を置く。AskUserQuestion は使わない。
   - explorer が `[QUESTIONS]` も `[SESSION_REPORT]` も付けずに終わったら、推測で問いかけファイルを組み立てず SendMessage で確認する。
4. **レポート中継**: `[SESSION_REPORT]` をユーザーに日本語で簡潔に伝える（テーマ・更新内容・新規 / 解決した HS・検証した UX / MQ）。
5. **後片付け（必須。中断でも失敗でも）**: プローブ（Scenarios.lean の一時シナリオと `scenarioByName` の登録・一時の枝・モックアップの「問いを試す」）を消し、`ddd.mjs end` を実行する
   （questions.md と `.session` を消し、`cradle ddd-clean-check --build` で残骸が無いことと `git status lean/` が探索前と同じことを機械で確かめる）。残っていれば消す — モデルを変えるのはフェーズ 2 の仕事。
6. **UX レビュー**: 時系列マップが変わったら `ddd-ux-reviewer` をバックグラウンドで起動し、完了したら起票（ID・種別・要約）を中継する。
7. **形式化（フェーズ 2）**: 正式ドキュメントが変わったら `lean-domain-modeler` をバックグラウンドで起動し、完了したら反映結果と新規 MQ を中継する。
8. **撤回の伝播**: セッションで HS / UX / MQ が撤回・訂正されたら `cradle refs <ID>` で派生（Lean の出典・openapi・infra-design・README）を洗い、失効した記述を直す（`cradle unslop --all` の lean-ref-retracted も見る）。
9. **締め**: 次回の推奨テーマ（open の MQ を優先 — 形式化を止めている問い）を一言。

## 厳守

- 質問に自分で答えない。質問・選択肢・回答を要約・補足・翻案しない。
- セッションは 1 回の起動につき 1 回。続きは次の /ddd。
- `documents/ddd/` が無いときは `/cradle-init` を案内する。
