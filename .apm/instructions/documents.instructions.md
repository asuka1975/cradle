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
| `documents/infra-design/` | インフラ設計の正本（INFRA-D / INFRA-A / INFRA-Q） | infra-design スキル。構成を変えたらここも直す |
| `documents/codebase/openapi.yaml` | REST 契約の正本 | api-contract スキル。実装より先に直す |
| `documents/ai-notes/YYYYMMDD-NN-<topic>.md` | AI の申し送り・保留・規約の候補 | AI。冒頭に「これは規約ではありません」 |
| `documents/decisions.md` | ai-notes から昇格した、このプロジェクト固有の決めごと | ユーザーの承認を経て AI が転記 |
| `documents/developer/` | 人間専用 | 人間だけ |

## ID とステータス

- HS-xxx（ホットスポット: 曖昧 / 対立 / 未決。open → resolved）、UX-xxx（open → 反映済 / 却下）、MQ-xxx（open → 反映済 / 却下）、
  INFRA-D-xxx（決定）/ INFRA-A-xxx（前提）/ INFRA-Q-xxx（未決）、イベント#n。ID は連番で、行は消さない。
- 撤回は行を消さず「解決 / 結果」列に結論と日付を追記する。撤回済みの ID を新しい根拠にしない。
- 却下には必ず理由を書く（再起票の防止に使う）。
- 「問い」は疑問文で書き、結論や設計案を書かない。ホットスポットの resolved の結論だけが不変条件になる。
- 1 つの選択肢に主張を 2 つ束ねない（片方に賛成しただけで両方合意したことにされる）。

## 参照の向き

`documents/` はコードを指してよい（`documents → lean → generated → 手書き` の一方向）。コードから documents を ID で指し返すのは Lean モデルだけ（出典として）。
ステータス語（open / resolved / 反映済 / 却下 / 未決）はここだけの持ち物で、コードには写さない。

## openapi.yaml に書かないもの

ホットスポット番号・出来事番号・MQ・そうなった経緯・存在しない操作の一覧・申し送り。契約書には「いまどうであるか」だけを書く。
