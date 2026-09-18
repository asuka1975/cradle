# テストリソース

## sprout/sprout-ir.json
骨格（`.apm/skills/cradle-init/assets/lean`、名前空間 `Sprout`）を抽出器に通した IR。
採り直し: `cd lean2kotlin/scaffold-check && ./gradlew --no-daemon extractLeanIr` のあと
`build/lean2kotlin/lean2kotlin-ir.json` をここへ写す（`GenerationTest` が `scaffold-check/src/generated` と突き合わせるので、両方を同じ生成器で採る）。

## lobby/lobby-ir.json
外部能力の Port を持つ最小ドメイン（`lean2kotlin/scaffold-check/port/lean`、名前空間 `Lobby`）を抽出器に通した IR。
採り直し: `cd lean2kotlin/scaffold-check && ./gradlew --no-daemon :port:extractLeanIr` のあと
`port/build/lean2kotlin/lean2kotlin-ir.json` をここへ写す（`LobbyGenerationTest` が `scaffold-check/port/src/generated` と突き合わせる）。

## sprout/golden/
骨格の golden ディレクトリ（`.apm/skills/cradle-init/assets/lean/golden/`）の写し — 従来の形の `basic*` 3 ファイル（init / flow 応答と、`cmd` が `init` の脇書き `basic.request.json`）と、外部能力の形の `external*` 3 ファイル（cmd external（版 1）の init / flow 応答と脇書き `external.request.json`。Port の無いモデルなので環境の script は空）。
採り直し: 骨格の golden を更新したら同じファイルをここへ写す。規則は「骨格 golden/ と同じファイル集合を保つ」— `GenerationTest` がこのディレクトリ全体を golden として読み `scaffold-check/src/generated`（骨格 golden/ 全体から生成したもの）と突き合わせるので、片方にだけあるファイルは突き合わせを壊す。
`basic.request.json` は従来の脇書き（version 無し）が note を出さずスナップショットを変えないことの検査に、`external*` は脇書きを読むことの検査に使う（`GoldenTest`）。

## lobby/golden/
Lobby の golden（`lean2kotlin/scaffold-check/port/lean/golden/` の 18 ファイル: visit / payment / payment-lost / payment-fault / payment-answer-lost / payment-partial の init・flow 応答と脇書き `<name>.request.json`）の写し。
脇書きは `{"version":1,"init":{"cmd":"external",…},"flow":{…}}`（版・環境・入力列。payment-partial は途中で止める `stopAt` も持つが、生成器は解釈しない）。init 応答は `ok.env`（script と cursor）を、flow の trace の各エントリは `result`（applied / refused / fault）・`env`・`interactions` を運び、refused（`domainError`）と fault のエントリも state と views を持つ。fault のエントリは指名した障害契約 `faultContract: {name, portCalls}`（`fault` は入力で指名した def 名の写し）を運び、`GoldenTest` が `lobby-ir.json` の障害契約（`<UseCase>.<def>` と portCalls）と突き合わせる。
採り直し: Lobby の golden を更新したら同じ 18 ファイルをここへ写す（`GoldenTest` が件数と refused / fault の読み取り・障害契約の突き合わせを検査する。`LobbyGenerationTest` は golden を持たない）。

## unique-name/
手書きの最小 IR: `<Root>RepositoryState` の `constraints` に unique（id）と uniqueSome（Option のフィールド）を持ち、集約が入れ子の個体の列を運ぶ。
`ConstraintArbTest` が集約の列の Arb と Repository 契約テストの本文を検査する。抽出器の出力ではないので採り直しは無い。IR のスキーマが変わったら手で直す。

## constrained-list/
手書きの最小 IR: `<Root>RepositoryState` の `constraints` に unique（id）・all（Bool のフィールドの全件制約）・atMost（列挙のフィールドの上限制約）を持ち、観測モデルの `add` / `update` が behaviors にある（集約にファクトリは無い）。
`ConstrainedListArbTest` が集約の列の Arb・Repository の操作の導出・契約テストの本文を検査する。抽出器の出力ではないので採り直しは無い。IR のスキーマが変わったら手で直す。

## computed-row/
手書きの最小 IR（Row に「状態の要素に無いフィールド」を持たせた読み取りモデル）と golden 1 組。
`OrderRow.total` が第一階層、`OrderRow.lines[].LineRow.amount` が入れ子の計算フィールド。
抽出器の出力ではないので採り直しは無い。IR のスキーマが変わったら手で直す。

## domain-services/
手書きの最小 IR: `domainServices` に短い名前のサービス 2 つ（`PricingService` / `TaxService`）と単一ファイル `Domain/DomainService.lean` 由来の `DomainService` を持つ。
`DomainServiceTest` がサービスごとに 1 interface が生成されることと、同名の出力先が衝突したら失敗することを検査する。抽出器の出力ではないので採り直しは無い。IR のスキーマが変わったら手で直す。
