---
name: spec-query
description: Use whenever a question is about what the specification says or does — "what happens if", "can X do Y", "which errors can this return", "what does the screen show for", "what fields does this command take", "is there an operation for". Answers by running the Lean executable spec (scenarios, commands, #print), never by reading code and guessing.
---

# 仕様問い合わせ — Lean を動かして答える

仕様に関する問いは推測で答えない。モデルを動かし、その出力を引用して答える。
道具は `cradle spec-query`（cradle スキルの `scripts/spec-query.mjs`。以下 `spec-query`）。

## 問いの種類と手順

| 問い | 手順 |
|---|---|
| 「どんな操作がある / 無い」「どんな失敗がある」「外から何が届く」 | `spec-query meta` → commands / observations（内部入力: 通知・契機。利用者の操作ではない）/ ports / errors をそのまま示す。無いものは「モデルに無い（反機能の一覧 `Runtime/Command.lean` を確認）」と答える |
| 「このコマンドは何を受け取る」「この型の中身」 | `spec-query print <FullName>`（例: `MonoWa.Application.PostIntentUseCase.Command`） |
| 「この状況で X が Y したらどうなる」 | 1) `spec-query scenarios` で出発点を選ぶ 2) 必要なら `spec-query init --scenario S --viewer V` で盤面を見る 3) `spec-query run --scenario S --actor A --viewer V --today D --commands '[…]'` で手を打つ 4) 各手の ok / domainError と最後の views を引用 |
| 「外部が〜と答えたら」「通知が届いたら」「途中で落ちたら」 | Port を使う手・内部入力の手は `spec-query external flow --scenario S --environment N --inputs '[…]'`（環境の名前は `spec-query environments`。script そのものは `--env @file`。1 手ずつなら `external init` → `external step --state @file --env @file --input J`）。入力は `{"command":…,"actor":…}` か `{"observation":…}`、障害契約の指名は `"fault":"<def 名>"`。各手の result（applied / refused / fault）と環境の cursor、`harnessError` なら環境と入力列の不一致（業務の答えではない）を引用。旧 `run` は環境を持たないので Port を使う手はプロトコルエラーになる |
| 「画面に何が見える」「誰に見える」 | `spec-query init` / `run` の `views` を viewer を変えて比べる（`null` = そこに無い、`[]` = 見えたうえで空） |
| 「日付でどう変わる」 | 同じ手を `--today` を変えて 2 回走らせ、差を示す |
| 「golden のこの流れは何をしている」 | `golden/<name>-flow.json` の trace を読む。要約せず手の列と結果を写す（外部能力を使う流れの要素は `observation` / `result` / `interactions` / `faultContract` を持つ。環境は `<name>.request.json` の `environment` か応答の `env`） |

## 答え方

- 実行したコマンドと出力（該当部分）を引用してから結論を書く。「モデルは〜と答えた」の形。
- 「できない」は `domainError` の語彙で言う（`notAuthor` など）。語彙の意味は `Domain/Error.lean` の docstring。
- 出発点のシナリオに欲しい状況が無いときは、既存シナリオから手を打って作る。**Scenarios.lean に一時シナリオを足さない**（それは ddd スキルのプローブの仕事）。
- モデルが答えられない問い（型に無い事実・未決）は「モデルに無い」と言い、決めたければ ddd スキルに戻す。勝手に補わない。
- 出力が長いときは `views` の該当する口だけを引用する。

## 例

```bash
spec-query meta
spec-query print Sprout.Application.CloseNoteUseCase.Command
spec-query run --scenario basic --viewer 1 --actor '{"user":{"id":2}}' \
  --commands '[{"closeNote":{"note":{"id":0}}}]'
# → #1 closeNote by {"user":{"id":2}} → domainError: "notAuthor"
spec-query environments
spec-query external flow --scenario basic --environment paymentAuthorized --actor '{"user":{"id":1}}' \
  --inputs '[{"command":{"startPayment":{"visit":{"id":0}}}},{"observation":{"dispatchPayment":{"attempt":{"id":0}}}}]'
# → #1 startPayment by {"user":{"id":1}} → applied  [env cursor 0/1]
# → #2 observation dispatchPayment → applied  [env cursor 1/1]
```
