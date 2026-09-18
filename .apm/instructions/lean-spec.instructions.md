---
description: Lean 実行可能仕様の規約 — 層の壁・固定名・契約定理・境界・証明方針
applyTo: "lean/**/*.lean"
---

# Lean 実行可能仕様

`lean/` は本番実装ではなく機械検証可能なドキュメント。`lake build` が通ること = 型検査・証明検査・`#guard` の一括検査。
層の壁は `cradle lean-check` が検査する。詳細規約と骨格例は `lean-domain-model` スキルの `references/lean-conventions.md`。

## 層と壁

- `Domain/`（ValueObject / Error / Entity / DomainService）は Application も Runtime も import しない。
- `Application/`（ActorContext / RepositoryState / ReadModel / View / Projection / Port / UseCase）は Runtime を import しない。
- 外部能力の Port（自システムが必要とする能力の要求と観測）は `Application/Port/<Port>/<操作>.lean`（Domain が所有するなら `Domain/Port/`）に固定名 `Request` / `Outcome` と自システムの語彙の純データだけを置く（関数フィールドは持たない。詳細は lean-conventions §4b）。
- 読み取り側（`QueryService.lean` を持つ UseCase・ReadModel・View）は `Domain.Entity` を import しない（CQRS）。Entity を読める読み側は `Projection.lean` と `RepositoryState.lean` だけ。
- `Runtime/` は非規範（表現の仮置き・境界）。ドメインの事実を独自に足さない。`Laws/` は保証の転送だけ。
- モデルは生成器を知らない（`Lean2Kotlin` 等への言及・依存を書かない）。

## 形

- 実体を宣言するのは `Domain/Entity/` の具体構造体だけ。ふるまいは def、法則は同じファイルの `@[contract]` 定理。ID は型パラメータで抽象のまま（表現は `Runtime/Ids.lean` の仮置き）。
- 印はアノテーション: `@[aggregateRoot]`（ルートの選択）・`@[valueObject]`（場所ずれの例外）・`@[repositoryState]`・`@[contract]`・`@[actorContext]`・`@[faultContract]`。
- 更新系 UseCase = `Command.lean`（入力語彙。名義は入れない）+ `UseCase.lean`（`validate` / `act` / `execute` 固定名。`execute = (validate …).map (act …)`）。
  validate に置けるのは「業務が始まる前の拒否」だけ。既存集約を変える UseCase の validate は解決の成果物（集約ルート）を返す。
- Port を使う更新系 UseCase = `Command.lean` + `UseCase.lean`（`validate` / `mkRequest` / `request` / `apply` / `execute` 固定名。`request = (validate …).map (mkRequest …)`、`execute = (validate …) >>= apply outcome …`）。
  観測（`Outcome`）は名義・時計と同格の調達の引数種で、`execute` がポート位置で受け、本番署名からは落ちる（観測の回数・拒否の区別・`request_ok` の扱いは lean-conventions §4b）。
- 参照系 UseCase = `ReadModel.lean`（観測の Set）+ `QueryService.lean`（Query 型 + 判断 + 固定名 `query : Query → ReadModel → List View`）+ `UseCase.lean`（validate / execute）。
- 名義（`ActorContext`）と時計（`today`）は状態でも入力でもない引数種で、UseCase はポート位置（先頭）で受け取る。コマンドに名義を混ぜない。
- 集約ルートが大域的に満たす制約（同一性・題の一意性）は `<Root>RepositoryState` の Prop フィールドに書き、`add` / `update` はその保存に要る証明（新鮮な同一性・変えない射影）を引数に取る。泉の新鮮性は UseCase が Prop 引数で受け、入力に依る証拠は validate が解決の成果物として返す（形と生成器の読み方は lean-conventions §4 / §9）。大域遷移は書かず、境界の検査（泉の境界）は `Snapshot.check` と `Reachable.check` が運ぶ。
- View は Row を運ばず、ふるまいを持つドメインの VO も運ばない（View 自身の語彙で写す）。束（Views）の口は画面名で、`none`（そこに無い）と `some []`（見えたうえで空）を潰さない。
- 反機能（存在しない操作）は `Runtime/Command.lean` の一覧に書き、コマンドを足さないことと定理で固定する。

## 契約定理

- `@[contract]` = 生成テスト 1 ファミリ。UseCase はエラー枝 1 本 = 定理 1 本と `execute_ok`（作用後の状態全体がオラクル。フレーム・泉の消費・追加 / 更新の等式はその系なので指名しない）。Entity / VO のふるまいは効果・非効果・冪等・同一性を指名する。
- 指名するのは契約面（execute / query）越しに観測できるものだけ。validate 面の定理・他の定理の系・証明の分解装置には付けない。
- 前提は Decidable、量化変数は生成可能な型、関数は computable。
- Port を使う UseCase は、validate の拒否（観測に依らない）・観測ごとの拒否・成功をそれぞれ定理にする。生成テストは Lean が評価した要求と定理の観測から Port のモックを組み、要求不一致・余分な呼び出し・呼ばれなかった応答をハーネスの失敗にする（業務の拒否とは別）。

## 証明とトレーサビリティ

- `axiom` / `unsafe` は禁止。`partial` は避ける。証明は omega / simp / decide / grind → 手証明 → `sorry` + `-- TODO(proof): 理由`（残数は `lake build` と `cradle lean-check` で数える）。
- 未決のドメイン仕様の穴に sorry を使わない。ゆるい解釈で進め、MQ を `documents/ddd/model-review.md` に起票し、該当箇所に `-- 起票候補: [MQ-xxx]`。
- 出典の ID（`[HS-xxx]` `[イベント#n]`）は docstring に書いてよい。ステータス語（反映済 / open 等）は書かない。実在しない出典を引かない（導出した事実は「(導出)」と明記）。
- 期待値は `#eval` の目視ではなく `#guard` で固定する（`Runtime/Scenarios.lean`）。

## 境界と golden

- CLI プロトコル（init / step / views / flow / dump、`viewer` / `actor` / `today`）は Cradle 標準（cradle スキルの `references/protocol.md`）。変えない。
- golden は CLI の応答そのもの。手で書かない。モデルを変えたら `cradle golden-check`。
- 表現・性能に関わる決定（ID の具体表現など）は `documents/infra-design/` の決定（INFRA-D）の裏付けなしに変えない。
- 層構成・CLI プロトコル・golden の一覧を変えたら `lean/README.md` を同じ変更で直す（`cradle unslop` の stale-path が腐りを拾う）。
- 集約ごとに一覧の口（そのままの射影）を `Views` に必ず持つ。閲覧の可否や並びが未決でも口は作り、未決の部分は viewer に依らず全件にして MQ を起票する。口が無いと仕様アニメーションも golden も何も観測できない。
