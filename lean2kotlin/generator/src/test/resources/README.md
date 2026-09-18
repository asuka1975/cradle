# テストリソース

## sprout/sprout-ir.json
骨格（`.apm/skills/cradle-init/assets/lean`、名前空間 `Sprout`）を抽出器に通した IR。
採り直し: `cd lean2kotlin/scaffold-check && ./gradlew --no-daemon extractLeanIr` のあと
`build/lean2kotlin/lean2kotlin-ir.json` をここへ写す（`GenerationTest` が `scaffold-check/src/generated` と突き合わせるので、両方を同じ生成器で採る）。

## sprout/golden/
骨格の golden（`.apm/skills/cradle-init/assets/lean/golden/` の 3 ファイル）の写し。
採り直し: 骨格の golden を更新したら同じ 3 ファイルをここへ写す。
`basic.request.json` は Golden.load が読み飛ばすことの検査に使う。

## unique-name/
手書きの最小 IR: `<Root>RepositoryState` の `constraints` に unique（id）と uniqueSome（Option のフィールド）を持ち、集約が入れ子の個体の列を運ぶ。
`ConstraintArbTest` が集約の列の Arb と Repository 契約テストの本文を検査する。抽出器の出力ではないので採り直しは無い。IR のスキーマが変わったら手で直す。

## computed-row/
手書きの最小 IR（Row に「状態の要素に無いフィールド」を持たせた読み取りモデル）と golden 1 組。
`OrderRow.total` が第一階層、`OrderRow.lines[].LineRow.amount` が入れ子の計算フィールド。
抽出器の出力ではないので採り直しは無い。IR のスキーマが変わったら手で直す。

## domain-services/
手書きの最小 IR: `domainServices` に短い名前のサービス 2 つ（`PricingService` / `TaxService`）と単一ファイル `Domain/DomainService.lean` 由来の `DomainService` を持つ。
`DomainServiceTest` がサービスごとに 1 interface が生成されることと、同名の出力先が衝突したら失敗することを検査する。抽出器の出力ではないので採り直しは無い。IR のスキーマが変わったら手で直す。
