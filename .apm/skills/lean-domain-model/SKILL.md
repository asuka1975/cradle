---
name: lean-domain-model
description: Use to create, update or verify the Lean 4 executable specification under lean/ from the exploration documents (event-timeline, hotspots, ubiquitous-language, ux-review, model-review) — initial generation, reflecting a session's results, fixing lake build, adding a command or a screen, checking a proposed feature against the model. Formalization questions go to model-review.md as MQ, never to the expert directly.
---

# Lean 実行可能仕様の生成・更新

`documents/ddd/` → `lean/` の一方向。documents を書き換えない（書けるのは `model-review.md` への MQ 起票と自分の起票行の訂正だけ）。
規約の要点は lean-spec 規則、詳細と骨格例は `references/lean-conventions.md`。骨格は cradle-init スキルが敷く（動く最小ドメイン付き）。

## 入力の読み方（5 ファイルとも必ず読む）

| ファイル | 寄与 |
|---|---|
| `ubiquitous-language.md` | 型名・フィールド名の源（英語候補をそのまま識別子に）。「確定」だけ型にする |
| `event-timeline.md` | 更新系イベント 1 つ = UseCase 1 ディレクトリ。主体「サイト」のイベントは execute の帰結 |
| `hotspots.md` | resolved の結論だけを不変条件に。状態 `撤回` の結論は使わない。open はモデル化しない |
| `ux-review.md` | 「却下」は反機能として固定。「反映済」は二重取り込みに注意。open は不可 |
| `model-review.md` | 自分の起票の帳簿。反映済 / 却下になった MQ の暫定解釈を確定し `-- 起票候補` を出典参照に置き換える |

## 手順

### 初回

1. `cradle status` で `lean/` の状態を確かめる。骨格が無ければ cradle-init スキル。
2. Domain（ValueObject → Error → Entity → DomainService）→ Application（ActorContext → RepositoryState → ReadModel → View → Projection → UseCase）→ Runtime（Ids → Command → Observation → Environment → Machine → Reachable → Views → Json → Scenarios）→ Laws の順に、骨格のサンプル（メモ: `Entity/Note`・PostNote / CloseNote / Notes の UseCase・`basic` シナリオ・golden の `basic`）を丸ごと置き換える。サンプルの型や語彙を実ドメインに混ぜない。置き換わると `cradle lean-check` の scaffold 警告と `cradle status` の「骨格のサンプル」が消える。
   `Views` は集約ごとに一覧の口を必ず持つ（lean-spec 規則）。口が無いモデルは画面でも golden でも観測できない。
3. `lake build` が通るまで直す。証明が難航するものは `sorry` + `-- TODO(proof):` で先に進み、全体を成立させてから戻る。
4. シナリオの期待値は `#eval` で確認してから `#guard` で固定する。
5. `cradle lean-check`、`lake exe <exe> <<< '{"cmd":"init","scenario":"basic","viewer":…}'` で疎通。
6. golden を採る（モックアップの「golden として保存」— 脇書き `<name>.request.json` も書く — か、`cradle spec-query raw` で流した init / flow の応答をそのまま保存 + 脇書き。外部能力を使う流れは環境つきの `external` で採る）。

### 差分更新（セッション後）

1. `git diff` で documents の変更点（新 resolved HS・新イベント・却下 / 反映された UX・MQ の状態変化）を特定する。
2. 影響するモジュールだけを更新する。resolved が状態 `撤回` になったか結論が変わったら、旧結論に基づく型・定理を必ず削除・改訂する（出典 ID を grep）。
3. `lake build` → `cradle lean-check` → `cradle golden-check`。証明が壊れたら、それは documents とモデルの不整合の検知が機能した瞬間なので報告に含める。golden の変化は意図したものだけ `--update`。

### コマンド（更新系）を増やす

`Application/UseCase/<名前>UseCase/{Command,UseCase}.lean` → 失敗の語彙が要れば `Domain/Error.lean` → 対象 Entity にふるまいと `@[contract]` 定理 →
`Runtime/Command.lean` に構成子（match 非網羅でビルドが落ちて気づく）→ `Runtime/Machine.lean` の `applyCommand` に 1 腕（Port を持たない骨格の形なら apply の腕 — `execute` への 1 行）→ `Runtime/Json.lean` にワイヤ（人が打つ表記が違う値は手書き FromJson + docstring）→
`Runtime/Reachable.lean` の check 保存に 1 腕（`applyExternal_sound` の腕。`execute_ok_shape` と `check_of_<root>_add` / `_update`）→ `Scenarios.lean` に `#guard`。

### Port を使うコマンド / 内部入力を増やす

Port の語彙 `Application/Port/<Port>/<操作>.lean`（`Request` / `Outcome`）→ UseCase（Port を使う固定形 `validate` / `mkRequest` / `request` / `apply` / `execute`。内部入力なら `Observation.lean` + `UseCase.lean`、名義は受けない）→ 障害契約 `@[faultContract]` の def（中断点ごと。観測を引数に取るかで消費位置）→
`Runtime/Environment.lean` の `Interaction` に Port 操作ごとの構成子 → `Runtime/Command.lean`（利用者の操作）か `Runtime/Observation.lean`（内部入力。`Command.lean` には混ぜない）に構成子 →
`Runtime/Machine.lean` の `applyCommand` / `applyObservation` に 1 腕（`withFault` の表は `@[faultContract]` の def の部分適用を `FaultSpec.beforeCall` / `afterResponse` で包む → `viaPort` に `request` / 観測の取り出し / `execute`。Port を使わない腕は `direct`）→
`Runtime/Json.lean` に `Request` / `Outcome` の `deriving instance` と `Interaction` の腕（port はディレクトリ名、operation はファイル名の先頭小文字）→ `Runtime/Reachable.lean` の `applyExternal_sound` に腕（成功は `execute_ok_shape`、fault は def の形）→
`Scenarios.lean` に名前付きの環境（`environmentByName`）と `#guard`（成功の流れと障害契約ごとの消費位置）。Port を使うコマンドは 5 cmd の経路（apply）には通せない — 環境が要るので `external` で打つ。

### 画面（参照系）を増やす

`Application/UseCase/<画面>UseCase/{ReadModel,QueryService,UseCase}.lean` → `Application/View.lean` に View の語彙 → `Runtime/Views.lean` の束に口を足す（`Option`）→ `Runtime/Json.lean` → `Laws/Properties.lean` に転送。
Row に足りない事実が出たら、足す前に「そのフィールドを決定するドメイン事実は何か」を問う（MQ 起票）。

### 追加ロジックの整合性検証

独立ファイル `<Root>/Extensions/<Name>.lean` に書き、既存の契約定理・反機能への証明義務を課す。書けない証明がそのまま矛盾点の一覧。マージしない。

## マッピング

- 確定した用語は英語候補で型・フィールドに。英語候補が空の用語は文脈から命名し、日本語の原語を docstring に残す。作った名前は用語集に無いので、docstring の 1 文目がそのまま暫定の呼び名として探索に戻る（`cradle unslop` の lean-name-unlisted が列挙し、`naming.md` に写る）。用語集の英語候補が識別子と違う行を見つけたら識別子を改名する（用語集 → Lean の一方向）。
- 同一性が探索で確定しているものは構造で表す（同名の並存は「防がない」のではなく「同一性に関与しないから当然」）。定理が `rfl` で済むならモデルが正しい証拠。
- resolved HS は (a) 型で表現不能にする (b) `<Root>RepositoryState` の Prop フィールド（一意制約）にする (c) 集約ローカルの定理にする、の順で割り当てる。
- 却下された UX 提案は反機能として `Runtime/Command.lean` の一覧に書き、コマンドが無いこととフレーム定理で固定する。
- すべての型・定理・分岐の docstring に出典（`[HS-xxx]` `[イベント#n]`）。ステータス語は書かない。導出した事実は「(導出)」。

## MQ の起票

型にしようとして初めて露呈する曖昧さは最大の副産物。勝手に決めず、作業を最後まで進めてから**バッチで** `model-review.md` に起票する
（種別: 曖昧 / 対立 / 未決、「形式化で詰まった箇所」「モデルの暫定解釈」必須）。モデル側はゆるい解釈を採り `-- 起票候補: [MQ-xxx]` を残す。
報告本文にしか書かない起票は禁止。既存 MQ と重複しない。

## 報告

```
## モデル更新報告
- 反映した documents の変更: [HS-xxx resolved, UX-xxx 却下, MQ-xxx 反映済, …]
- 更新モジュール: …
- ビルド: 成功 / 失敗（原因）  lean-check: OK / NG  golden-check: 全一致 / CHANGED n 件（意図: …）
- 証明状況: sorry n 件（一覧と TODO 理由）
- 用語集に無い名前: n 件（cradle unslop --all の lean-name-unlisted）
- 反機能の防波堤: 追加 / 更新した「存在しないこと」
- 起票した MQ（model-review.md に起票済み）: …
```
