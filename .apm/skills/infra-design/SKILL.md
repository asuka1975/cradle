---
name: infra-design
description: Use for the infrastructure design phase between domain exploration and Lean formalization — deriving non-functional requirements from the Lean model, deciding environments (test/local/prod), identity provider, database, ID representation, and the list of things NOT to build. Produces documents/infra-design with INFRA-D/A/Q entries.
---

# インフラ設計フェーズ

入力は `lean/` の実行可能仕様と `documents/ddd/` の正式ドキュメントだけ。open の UX / MQ は根拠にしない。
成果物は `documents/infra-design/`（README + 01_model-to-infra + 02_local + 03_production + 04_operations）。実装（`infra/`）はインフラ実装フェーズ（infra-implement スキル。バックエンド追随の後）。

## 手順

1. `cradle status` と `cradle spec-query meta` で、モデルにある集約・コマンド・画面・境界入力（名義・時計）を把握する。
2. `01_model-to-infra.md` の問いに答える: 入口、直列化点（横断不変条件をどこで守るか）、時計、名義（誰が確定するか）、同一性の表現（連番か UUID か — NFR を根拠に）、**作らないもの**（モデルに裏付けの無いインフラの一覧）。
3. 環境を 3 つ決める（test = 外部依存なし、local = 本番同等のコンテナ + モック発行者、prod）。検証を飛ばすプロファイルは作らない。
4. 決定を INFRA-D-xxx として根拠（モデルの定理名・HS）付きで表に書く。裏付けの無い仮定は INFRA-A-xxx（サイジングにだけ使う）。ユーザーの判断が要るものは INFRA-Q-xxx として問いの形で残し、暫定を書く。決着・却下は状況列に書き、行は消さない（書き方は documents 規約）。
5. 決定のうちモデルへ反映すべきもの（ID の表現など）は `lean-domain-model` に渡す（ゆえに順序はインフラ設計 → Lean 化）。
6. 運用（デプロイ手順・監視・障害時・スキーマの当て方）を 04 に書く。CI で本番イメージを焼く前提にする。

## 決めごと

- 設計に日付付きの進捗チェックリストを残さない。状態は `cradle status` と git が持つ。投入表（README）だけは投入した事実として日付を持つ。
- 実装が入って前提が変わったら設計を直す（README の「実装後の見直し」に事実だけ）。
- 秘密・平文・fail-open な既定値を設計段階で潰す（証明書未設定で平文に倒れる既定を置かない）。
- 「性能ではなく設計判断」を含む未決は勝手に決めず INFRA-Q に。選択肢 A / B と効くところ・引っかかるところを表にする。
