---
description: documents/ の文書モデル — 誰が何を書けるか、ID とステータスの語彙、参照の向き
applyTo: "documents/**"
---

# documents/ の規約

## 置き場と書き手

| 場所 | 中身 | 書ける者 |
|---|---|---|
| `documents/ddd/event-timeline.md` `hotspots.md` `ubiquitous-language.md` | 正式ドキュメント（ドメインの事実の正本） | `ddd-domain-explorer` だけ（/ddd のセッション中 — hook が `.session` 印の無い編集を止める） |
| `documents/ddd/ux-review.md` | 利用者視点の仮説（UX-xxx） | 起票は `ddd-ux-reviewer`、状態・結果列は explorer |
| `documents/ddd/model-review.md` | 形式化で詰まった問い（MQ-xxx） | 起票は `lean-domain-modeler`、状態・結果列は explorer |
| `documents/ddd/questions.md` | 探索セッションの問いかけ（一時ファイル） | メインエージェント。セッション終了時に必ず消す |
| `documents/ddd/naming.md` | モデルが付けた名前のうち用語集に無いもの（一時ファイル。`ddd.mjs start` が Lean と用語集から機械で作る） | 誰も書かない。explorer が読んで用語集に行を立て、`ddd.mjs end` が消す |
| `documents/infra-design/` | インフラ設計の正本（INFRA-D / INFRA-A / INFRA-Q） | infra-design スキル。構成を変えたらここも直す |
| `documents/codebase/openapi.yaml` | REST 契約の正本 | api-contract スキル。実装より先に直す |
| `documents/ai-notes/YYYYMMDD-NN-<topic>.md` | AI の申し送り・保留・規約の候補 | AI。冒頭に「これは規約ではありません」 |
| `documents/decisions.md` | ai-notes から昇格した、このプロジェクト固有の決めごと | ユーザーの承認を経て AI が転記 |
| `documents/developer/` | 人間専用 | 人間だけ |

## ID とステータス

- HS-xxx（ホットスポット: 曖昧 / 対立 / 未決。open → resolved → 撤回）、UX-xxx（open → 反映済 / 却下）、MQ-xxx（open → 反映済 / 却下）、
  INFRA-D-xxx（決定）/ INFRA-A-xxx（前提）/ INFRA-Q-xxx（未決）、イベント#n。ID は連番で、行は消さない。
- 撤回は行を消さず状態列で表す: HS は状態を `撤回` にして「解決」列に経緯と日付を追記する。状態列の無い表（出来事・INFRA-D / INFRA-A）は最後の列（備考 / 根拠）の先頭に `撤回:` を置く。
  本文の途中の「撤回」「却下」は業務の語として読まれる（`cradle unslop` の lean-ref-retracted は状態列と先頭の `撤回:` だけを見る）。撤回済みの ID を新しい根拠にしない。
- INFRA-Q の「状況」列は、空か `open` / `未決` で始まる行だけが未決。決着したら `決着。INFRA-D-nnn`（写した先）、決めないと決めたら `却下。理由`。
- 却下には必ず理由を書く（再起票の防止に使う）。
- 「問い」は疑問文で書き、結論や設計案を書かない。ホットスポットの resolved の結論だけが不変条件になる。
- 1 つの選択肢に主張を 2 つ束ねない（片方に賛成しただけで両方合意したことにされる）。

## 参照の向き

`documents/` はコードを指してよい（`documents → lean → generated → 手書き` の一方向）。コードから documents を ID で指し返すのは Lean モデルだけ（出典として）。
ステータス語（一覧は comments 規約）はここだけの持ち物で、コードには写さない。

## openapi.yaml に書かないもの

ホットスポット番号・出来事番号・MQ・そうなった経緯・存在しない操作の一覧・申し送り。契約書には「いまどうであるか」だけを書く。
