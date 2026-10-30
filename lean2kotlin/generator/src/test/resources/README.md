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

## mini/
Sprout と Lobby のスナップショットに出ない生成の枝を通す最小ドメイン（`mini/lean`、名前空間 `Mini`「貸出棚」）を抽出器に通した IR（`ir.json`）、その CLI の init 応答（`golden/`）、生成物のスナップショット（`generated/`）。
`MiniGenerationTest` が `ir.json` と `golden/` から生成し、`generated/` とファイルの一覧・本文で、ログと全行・出る順で突き合わせる（scaffold-check の外なので、生成物のコンパイルは検査しない）。通す枝:
- 時計ポート（`Application/Clock.lean` の `Clock`）を受ける更新系 `LendBookUseCase` — 遷移契約テストと障害契約テスト（`savingFailed`）のフックに固定の today が配線される。
- validate 面の遷移契約（`validate_ok`）— 遷移形のテストは契約が指す execute と validate の引数を併せて配線する。validate の `_actor` と execute の `actor` は名前が違うので、フックの主体の引数が 2 つに分かれる（いまの生成の形をそのまま固定する）。
- entity-like でない主体（列挙 `Condition`）のふるまいの契約 — `ConditionBehaviors` と `ConditionBehaviorsContractTest`。
- ふるまい持ちの VO（`Title`）を運ぶ sealed（`Place`）と structure（`Edition`）の VO — 平行 fixture・`toFixture`・リテラル・Arb の橋渡し。
- View がふるまい持ちの VO を運ぶ参照系 `CatalogUseCase`（View→ドメイン語彙の壁の note。参照系ケースは出ない）と、golden の状態から引数を合成できる参照系 `ShelfUseCase`（golden 回帰と Retrieve が 1 ケースずつ）。
- 時計ポートを受ける参照系 `LoansUseCase`（今日貸した本）— 参照系の契約テストのフックに Clock のフィールド（today）が配線され、定理由来のケースは時計の値をケースの args から取る。golden の状態は時計を運ばないので golden 回帰は合成できずスキップする（note）。CLI の views は採取の今日（`Runtime/Views.lean` の `goldenClock`）で評価する。

CLI（`mini/lean/Main.lean`）は golden の採取用で、init だけを答える。`basic.request.json` は採取に使ったリクエストの脇書き。
採り直し（`$M` = `lean2kotlin/generator/src/test/resources/mini`、`$L` = このリポジトリの `lean2kotlin/lean`、`$W` はリポジトリの外の作業ディレクトリ — `mini/lean` の下に `.lake` を作らない）:
1. `cp -r $M/lean $W/mini-lean`
2. `$W/ws/lakefile.toml` に `name`（任意の名前）と、`mini-lean`（path `$W/mini-lean`）・`lean2kotlin`（path `$L`）の `[[require]]`、`$W/ws/lean-toolchain` に `$M/lean/lean-toolchain` の写し、`$W/ws/Driver.lean` に `import Mini` / `import Lean2Kotlin.Extract` / `set_option maxHeartbeats 4000000 in` に続けて `#kotlin_ir "Mini" "$W/ir.json"`（binder の上書きは無い — `Mini.Runtime` が全 binder を持つ）。
3. `cd $W/ws && lake build Mini Lean2Kotlin && lake env lean Driver.lean` のあと `$W/ir.json` を `$M/ir.json` へ写す。
4. `cd $W/mini-lean && lake build mini && jq -c .init $M/golden/basic.request.json | lake exe mini > $M/golden/basic-init.json`
5. `cd lean2kotlin/generator && ./gradlew --no-daemon test --tests lean2kotlin.MiniGenerationTest -Dlean2kotlin.updateMiniSnapshot=true` — `MiniGenerationTest` が生成した `kotlin-main` / `kotlin-test` で `generated/` を置き換えてから突き合わせる（Port が無いので `kotlin-adapter-test` は出ない）。生成器の出力だけが変わったときは 5 だけでよい。

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
