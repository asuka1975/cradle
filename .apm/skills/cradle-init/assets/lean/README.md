# lean/ — 実行可能仕様

`documents/ddd/` の探索成果物を Lean 4 で形式化したもの。本番実装ではなく、**機械検証可能なドキュメント**。

- 検証: `lake build` = 型検査・証明検査・`#guard` シナリオ表明の一括検査。`cradle lean-check` が層の壁を検査する
- 問い合わせ: `cradle spec-query`（仕様に関する問いは推測せず、モデルを動かして答える）
- モックアップ: `mockup/`（このモデルをそのまま実行エンジンにする仕様アニメーション）
- `golden/`: モデルから吐いた入出力例（CLI の応答そのもの）。バックエンドの契約テストの期待値。`cradle golden-check` が回帰を検査する

ドメインの事実の出どころは `documents/ddd/`。決まっていないことはモデル化せず、問いは `documents/ddd/model-review.md` に預ける。

## 層構成

```
lean/
├── Main.lean                  JSON stdin/stdout CLI（init / step / views / flow / dump）
├── golden/                    <name>-init.json / <name>-flow.json / <name>.request.json
├── mockup/                    仕様アニメーション（無知なサーバー + 汎用の描画）
└── <Root>/
    ├── Prelude.lean           層に依存しない汎用補題
    ├── Domain/                ドメイン層 = ドメインモデルの家（Application も Runtime も import しない）
    │   ├── Annotations.lean   @[aggregateRoot] / @[valueObject] / @[repositoryState] / @[contract] / @[actorContext] / @[faultContract]
    │   ├── ValueObject.lean   値の市民（状態が運ぶ値だけ）
    │   ├── Error.lean         失敗の語彙 DomainError（1 分岐 1 構成子）
    │   └── Entity/            具体構造体 + ふるまい + @[contract] 定理群
    ├── Application/           アプリケーション層 = 外部 Actor との面（Domain の影）
    │   ├── ActorContext.lean  名義（状態でも入力でもない第 3 の引数種）
    │   ├── RepositoryState.lean 観測モデル（集約ルートの制約は構造体の Prop フィールド）と ID の泉
    │   ├── ReadModel.lean     Row（業務事実だけ）
    │   ├── View.lean          閲覧の共有語彙（View→Row の壁・View→ドメイン語彙の壁）
    │   ├── Projection.lean    書き込み → 読み取りの射影（Entity を読める唯一の読み側）
    │   ├── Port/<Port>/<操作>.lean  外部能力の Port（固定名 Request / Outcome — 要求と観測の語彙だけ。Domain が所有するなら Domain/Port/）
    │   └── UseCase/           1 UseCase 1 ディレクトリ（validate / execute は固定名）
    │       ├── <更新系>UseCase/   Command.lean + UseCase.lean（Port を使うなら request / mkRequest / apply も固定名）
    │       └── <参照系>UseCase/   ReadModel.lean + QueryService.lean（固定名 query）+ UseCase.lean
    ├── Runtime/               実行系（非規範 — 表現の仮置き・境界）
    │   ├── Ids.lean           同一性の仮置き + 泉の具体化
    │   ├── Command.lean       コマンドの輸送形式 + Actor + 反機能の一覧
    │   ├── Machine.lean       Snapshot / check（泉の境界）/ apply（today と actor と check の証明を受け取る）
    │   ├── Reachable.lean     可到達性（apply が check を保つことの証明）
    │   ├── Views.lean         射影と画面の束（viewer と today を受け取る）
    │   ├── Json.lean          JSON の後付け（ワイヤ形式はここで固定）
    │   └── Scenarios.lean     名前付き初期状態 + #guard
    └── Laws/Properties.lean   保証の境界への転送（仮定は Reachable が放電）
```

## CLI プロトコル

```
{"cmd":"init","scenario":"basic","viewer":…,"actor":…,"today":"2026-01-01"} → {"ok":{"state":…,"views":…}}
{"cmd":"step","state":…,"command":…,"actor":…,"viewer":…,"today":…}        → {"ok":{…}} | {"domainError":…} | {"error":…}
{"cmd":"views","state":…,"viewer":…,"today":…}                               → {"ok":{…}}（状態は動かさず射影し直す）
{"cmd":"flow","scenario":…,"commands":[…],"actor":…,"viewer":…,"today":…}   → {"ok":{"trace":[…]}}
{"cmd":"dump", …}                                                             → {"ok":{"initial":{…},"trace":[…]}}
```

コマンドのワイヤ形式は `{"<構成子名>": <ペイロード>}`。**ペイロードに名義は入らない** — `actor` が別に運ぶ。
`viewer` が無ければどの画面も `null`（そこに無い）。`null` と `[]`（見えたうえで空）は別の事実。
日付は ISO-8601 `"uuuu-MM-dd"`。暦に無い日付はプロトコルエラー。
