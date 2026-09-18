# パイプライン

| # | フェーズ | 入口 | 成果物 | ゲート（次へ進む条件） |
|---|---|---|---|---|
| 1 | 探索 | `ddd` | `documents/ddd/`（出来事・ホットスポット・用語） | open の MQ が無い、または残りが業務上「どちらでも」と確認された |
| 2 | インフラ設計 | `infra-design` | `documents/infra-design/`（INFRA-D/A/Q・作らないもの） | 表現に関わる決定（ID など）が INFRA-D になっている |
| 3 | Lean 化 | `lean-domain-model` | `lean/`（型・UseCase・定理・シナリオ・CLI） | `lake build`・`cradle lean-check`・`golden-check` が通る |
| 4 | 仕様アニメーション | `domain-mockup` | `lean/mockup/`（ドメインの語彙の画面）・`lean/golden/`（外部能力を使う流れは環境つき） | エキスパートが JSON を読まずに主要な流れ（外部の答え・通知・中断を含む）を一巡でき、golden を採った |
| 5 | API 契約 | `api-contract` | `documents/codebase/openapi.yaml`・生成クライアント | コマンド 1 対 1・画面 1 対 1・422 の語彙が揃っている |
| 6 | フロントエンド | `frontend`（+ `frontend-ux-review`） | `frontend/`（業務のまとまりごとの画面。相手は Lean CLI） | **人間が画面で確かめた** |
| 7 | バックエンド | `backend-implement` | `backend/`（生成 interface の実装・契約テスト全配線） | build 緑・契約テスト m/m・設計 / SQL レビュー済 |
| 8 | インフラ実装 | `infra-implement` | `infra/`（local スタック・IaC）・`cradle.json` の `infra.up` | local が `infra.up` の 1 コマンドで立ち `cradle doctor --local` が fresh、CI に IaC の validate（あれば plan）とイメージ焼きがある |
| 9 | E2E | `e2e-parity` | `e2e/`（golden 由来の台本・パリティ。環境入力はテスト構成だけの注入口から） | Lean と REST の観測に差分が無い（環境入力を含む流れも） |
| 10 | 本番投入 | `infra-implement` | `documents/infra-design/README.md` の投入表 | サンドボックスで一度 apply した（投入表の prod が済）・アラームに通知先がある・prod に関わる INFRA-Q が閉じている |

入口はスキル名（Claude Code では `/名前`、Codex では `$名前`）。戻り先はいつも Lean（3）。画面で違和感が出たら 3 → 4 → 6 をやり直し、backend は待つ。
インフラの出番は 2 回で、local スタックは E2E の前提（8）、本番の apply は E2E 合格の後（10）。

## 探索の 2 フェーズ

- フェーズ 1（`ddd-domain-explorer`）: 語彙・出来事・自然言語の不変条件を聞き取る。全域性を目標にしない。
- フェーズ 2（`lean-domain-modeler`）: 翻訳して詰まった曖昧さを MQ としてバッチで戻す。エキスパートには聞かない。
- 問いは Markdown ファイル（questions.md）で聞き、選択肢ごとの帰結はモデルを動かして見せる（プローブ）。終わったら残骸を機械で確かめて消す。

## CI

`.github/workflows/cradle.yml`（骨格が敷く）が `lake build` → `cradle lean-check` → `golden-check` → `unslop --all` を回す。backend が入ったら `apm install --frozen`（生成器を `apm_modules/` に配る）→ `./gradlew build`（契約テスト・ktlint 独自ルール込み）を足す。infra が入ったら IaC の validate と本番イメージの焼き込みを足す（断片は infra-implement スキル）。

## 常時のゲート（hook）

- 生成物・`documents/developer/`・golden・探索ドキュメント（セッション外）への直接編集は止まる。
- `gradlew build` 成功 → SQL 性能レビューと設計レビュー。`lake build` 成功 → golden 回帰の促し。再生成 → 影響範囲の促し。
- 止まる前に `cradle unslop` の error が残っていれば差し戻す。
