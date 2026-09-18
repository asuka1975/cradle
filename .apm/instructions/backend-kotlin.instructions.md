---
description: Kotlin バックエンドの実装規約 — 固定形・トランザクション境界・Repository・テスト
applyTo: "backend/**/*.kt,backend/**/*.kts,backend/**/*.sql"
---

# バックエンド（Kotlin）

## 構成

- `domain/`（生成 interface の実装: entity / valueobject / domainservice）、`application/usecase/<usecase>/`（UseCaseImpl・QueryServiceImpl・画面に閉じた中間型・バイパスの宣言）、
  `infrastructure/`（Repository 実装・採番・バイパス実装・Port の Adapter は `infrastructure/<port>/`）、`presentation/<feature>/`（Controller・View→Response 変換）、`presentation/common/`（モデルが共有と定めた語彙の変換だけ）、`presentation/error/`、`config/`。
- 層のパッケージ直下にトップレベル宣言を置かない。1 ファイル 1 型（sealed とその直接のサブタイプは同居可）。
- 字面では破れる作法は ktlint の独自ルール（`cradle:single-class-per-file` / `java-config-bean` / `jooq-access-site` / `package-root-declaration` / `bypass-site` / `presentation-calls-execute-only` / `no-repository-fake` / `actor-context-site`）が検査する。例外は `@Suppress("ktlint:cradle:<rule>")` に理由コメントを添える。

## UseCase（固定形）

- `validate` = 宛先の解決（Repository を使ってよい）。`execute` は必ず validate を呼び、返った集約ルートに作用する。同じ分岐条件を execute に再実装しない。
- 境界は `execute` に置く（更新系 `@Transactional`、参照系 `@Transactional(readOnly = true)`）。validate には付けない（自己呼び出しは AOP を通らない）。
- Repository の中でトランザクションを張らない。業務上の失敗（`DomainResult.Err`）は巻き戻さない — どこまで残るかはモデルの観測。巻き戻すのは例外だけ。
- モデルが「失敗しても残るもの」と「残らないもの」を区別する UseCase だけ `TransactionTemplate` で境界を割り、両方向をテストする。その経路に外側の `@Transactional` を足さない。
- 「今日」は `java.time.Clock` を注入して取る。リクエストから受け取らない。「誰として」も受け取らない（名義は認証が決める）。
- 生成された名義（`ActorContext`）は final な data class なのでクラスプロキシ（CGLIB）を被せられない。リクエストスコープの配線はインタフェースプロキシか明示スコープで行い、受け手も同じスコープにする。
- モデルの横断不変条件（「二重に〜しない」類）の直列化点を DB に一本化する（一意制約・`FOR UPDATE`・version 列）。アプリ内ロックで代用しない。集約の update は楽観ロックか行ロックを持つ。
- 内部入力（`Observation`。Lean の第 3 の固定形）の UseCase は名義を受けない。渡すのは検証済みの受信境界（提供元の署名・相関を確かめた Adapter）と内部の worker / timer だけで、利用者の HTTP から直接は呼ばない。
- 配送（Port を呼ぶ内部入力）は、Lean の `apply` が言う「送る印」（試行番号）を外部を呼ぶ前に commit してから Port を呼び、観測を反映して commit する。印の commit と外部呼び出しを 1 つのトランザクションに包まない（外部の効果は rollback できない）。

## QueryService

- 抽象化層を挟まず ORM（jOOQ）を直接叩く。複数 QueryService が共有するクエリ関数・中間型・比較器を作らない（同じクエリの重複は対価）。
- 並べ替え・絞り込みの規則がモデルにあるなら `ORDER BY` / `WHERE` で DB に任せ、Kotlin で比較器を書かない。
- jOOQ を import してよいのは `infrastructure/` と `*QueryServiceImpl` だけ。

## 性能バイパス

- 宣言は消費する UseCase のディレクトリ、実装は `infrastructure/`、命名は `*Bypass`。複数 UseCase で共有しない。
- 観測同値（`bulkAdd(xs) ≡ xs.forEach(add)`）を KDoc に書き、生成契約テストが通ることで検査する。シグネチャに業務の判断が現れたらバイパスではなく契約の変更（モデルへ持ち帰る）。

## テスト

- Repository の InMemory fake を作らない。本番実装を実 DB（test プロファイル）にそのまま配線する。生成された抽象契約テストは全部を具象で繋ぐ（`cradle status` が配線数を出す）。
- 外部能力の Port には生成モック（`<Port>Mock`。契約テストが要求と観測を積んで渡す）を配線する。fake 禁止は Repository の話で、Port の Adapter を契約テストに繋がない。Adapter の検査（HTTP stub や提供元の sandbox 相手）は独立したタスクにし、`./gradlew build` の門に入れない。
- 採番の決定的実装（`Sequential*IdGenerator`）の注入は認められたシーム。障害注入も泉の差し替えで行う。
- 生成 `*Factory` の実装はテスト側に置く。テストは並列化しない（共有 DB + DELETE 隔離）。
- 具象の契約テストは `<抽象クラス名>Impl`（例: `RaiseHandUseCaseContractTestImpl`）。骨格は `cradle contract-skeleton <生成ファイル>` が吐く。
- 契約テストは `new` で組み立てるため `@Transactional` / リクエストスコープを通らない。境界と認可の門は HTTP レベルのテストで別に押さえる。

## presentation

- Controller interface と Request/Response は `openapi.yaml` から生成し、Controller はそれを implements する。手書きの DTO を置かない。
- 構築は Jackson（sealed + `@JsonTypeInfo`）と Bean Validation に任せ、`require` / `throw IllegalArgumentException` を手書きしない。`IllegalArgumentException` を例外ハンドラで捕捉しない。
- Controller は UseCase の `execute` だけを呼ぶ。validate 用のエンドポイントを作らない。戻り値の型を書く（スター射影にしない）。
- エラー本文は全経路で `{"code","message"}`。400 = 形、401 = 身元不明、403 = 立場、404 = 宛先なし、422 = 業務失敗。403 を 422 に混ぜない。例外メッセージを本文に写さない。

## スキーマ

- `schema.sql` は正本 1 つ。索引にはそれが効く述語との対応を書く。マイグレーションは版管理し、起動時に毎回 DDL を流さない。
- 識別子に予約語を使わない。enum の DB 符号化は 1 流儀に揃える。
