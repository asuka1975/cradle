# Lean CLI プロトコル（Cradle 標準）

実行可能仕様は `lake exe <exe>` で JSON stdin → JSON stdout の CLI になる。1 リクエスト 1 プロセス。
モックアップ（仕様アニメーション）・golden・`cradle spec-query`・E2E 台本生成はすべてこの 1 本の口だけを使う。
CLI を持たない Lean 仕様は Cradle のハーネスに乗らない。
口は 2 つの経路を持つ: 5 つの cmd（Port を使わない手）と、外部能力と内部入力を扱う `cmd: "external"`（version 1）。
既存の 5 cmd の形と意味は変えず、拡張は `external` だけで行う。`external` を知らない実行器は未知の cmd として拒否する — それが未移行の印。
CLI の `Main.lean` は骨格の持ち物で作り込まない（Cradle の更新で敷き直す）。プロジェクトが書くのは `Runtime/` の配線だけ。

## リクエスト（5 cmd）

| cmd | 必須 | 任意 | 応答 |
|---|---|---|---|
| `init` | `scenario` | `viewer` `actor` `today` | `{"ok":{"state","views"}}` |
| `step` | `state` `command` `actor` | `viewer` `today` | `{"ok":{…}}` / `{"domainError":…}` |
| `views` | `state` | `viewer` `actor` `today` | `{"ok":{…}}`（状態は動かさず射影し直す） |
| `flow` | `scenario` `commands` | `actor` `viewer` `today` | `{"ok":{"trace":[…]}}` |
| `dump` | `scenario` `commands` | `actor` `viewer` `today` | `{"ok":{"initial":{…},"trace":[…]}}` |

- `viewer`: 誰として見ているか（同一性）。無ければどの画面も `null`（そこに無い）。
- `actor`: 誰として操作しているか（名義）。**コマンドの中には無い**。`step` に必須。
- `today`: 境界の時計。ISO-8601 `"uuuu-MM-dd"`。省略時はシナリオの基準日。暦に無い日付は `{"error":…}`。
- `commands` の各要素は `{"actor":…,"command":…}` の組か、コマンドそのもの（名義はリクエストの既定）。
- コマンドのワイヤ形式は `{"<構成子名>": <ペイロード>}`（平ら）。
- 外から受け取った `state` は `Snapshot.check` を通してから使い、通らなければ `{"error":…}`。
- Port を持つモデルでも 5 cmd はそのまま有効。Port を使わない手は変わらない。Port を使う手は、要求（`request`）の前に断られれば `{"domainError":…}`（状態不変・外部は呼ばない）、
  要求が通る手には script が要るので `{"error":"this command needs cmd external with an environment: …"}`（プロトコルエラー。`domainError` にも `harnessError` にもならない）。
  障害契約の指名は `external` だけにある。`init` / `views` は影響を受けない。

## 応答の 3 種（5 cmd）

| 形 | 意味 |
|---|---|
| `{"ok": …}` | 通った |
| `{"domainError": …}` | 業務として断られた（`DomainError` の語彙。状態は変わっていない） |
| `{"error": "…"}` | プロトコルエラー（形が悪い・未知の scenario / cmd・検査に通らない state） |

`trace` の各要素は `{"actor","command","state","views"}`（通った）か `{"actor","command","domainError"}`（断られた）。
断られた手も trace に残る — 失敗系も契約テスト・E2E の材料になる。

## external — 外部能力と内部入力

すべてのリクエストに `"cmd":"external"` と `"version":1`。action ごとに受ける欄は決まっていて、表に無い欄・版違い・不明な action はプロトコルエラー。

| action | 必須 | 任意 | 応答 |
|---|---|---|---|
| `init` | `scenario` | `environment` か `env`（どちらか一方）、`viewer` `actor` `today` | `{"ok":{"state","views","env"}}` |
| `step` | `state` `env` `input` | `viewer` `actor` `today` | `{"ok":{"result",…}}` / `{"harnessError":…}` |
| `views` | `state` | `viewer` `actor` `today` | `{"ok":{"state","views"}}`（環境は消費しない） |
| `flow` / `dump` | `scenario` `inputs` | `environment` か `env`、`stopAt`、`viewer` `actor` `today` | `{"ok":{"trace":[…],"env":…}}`（`dump` は `initial` も）/ `{"harnessError":…}` |

- 環境: `environment` は `Runtime/Scenarios.lean` の `environmentByName` にある名前、`env` は script そのもの `{"script":[…],"cursor":n}`。両方あれば不正。どちらも無ければ空の環境（script `[]`・cursor 0）。
  外から受けた `env` は `Environment.check`（cursor が script の範囲内）を通す。環境は状態と同じく応答で返し、次の `step` が受け取る（プロセス内に持たない）。
- 入力（`input`、`inputs` の各要素）: `{"command":…,"actor":…?,"fault":…?}` か `{"observation":…,"fault":…?}`。
  command の要素に `actor` が無ければリクエストの `actor` が既定（どちらにも無ければプロトコルエラー）。要素の `actor` が勝つ。
  observation の要素に `actor` があれば不正（内部入力に利用者はいない）。`init` / `views` のリクエストの `actor` は `opened` の名義。
- `fault` はモデルの `@[faultContract]` の def 名（例 `"savingFailed"`）で、その中断点で止めた状態を返させる指名。任意の事後状態を外から渡す口ではない。
- `viewer` / `actor` / `today` / `state` / `env` の値が decode できなければプロトコルエラー。`null` は無いのと同じ。

### 応答

| 形 | 意味 |
|---|---|
| `{"ok":{"result":"applied","state","views","env","interactions"}}` | 通った。`interactions` はこの手で消費した外部能力の往復 |
| `{"ok":{"result":"refused","domainError",…}}` | 業務として断られた（状態不変）。要求の前の拒否は外部を呼ばず cursor 不変、観測の後の拒否は cursor 消費済み |
| `{"ok":{"result":"fault","faultContract":{"name","portCalls"},…}}` | 指名した障害契約で中断した状態。`name` は `<UseCase>.<def>`、`portCalls` はそこまでの外部呼び出しの数（0 / 1） |
| `{"error":"…"}` | プロトコルエラー |
| `{"harnessError":{"step":n\|null,"message":"…"}}` | ハーネスの失敗。業務の拒否にも外部の観測にも化けない |

- ハーネスの失敗: script が尽きた（要求があるのに次のやり取りが無い）、別の Port 操作（script の次が別の Port・操作）、要求の不一致（モデルの要求と script の期待が違う）、
  知らない障害契約の名前、拒否される入力への障害の指名（要求の前でも観測の後でも — 障害契約は execute が受け入れる入力にだけ宣言される）、
  `flow` / `dump` の完了時に script が残っている（`stopAt` が無いのに全消費でない、または `stopAt` と cursor が違う）。
- `harnessError` は常にトップレベルの 1 形。`flow` / `dump` は最初の失敗で止まり、そこまでの trace も返さない。`step` は失敗した入力の番号（1 始まり）。
  `step` action と完了時の検査では `null`。
- `trace` の各要素 = 入力の写し（`actor` と `command`、または `observation`。指名した `fault` の名前）に `step` の `ok` の中身（`result` 以下）が続く。
  `flow` は連続する `step` の定義そのもの（`Runtime/Reachable.lean` の `flow`。`cradle golden-check` の `chain` が突き合わせる）。
- `stopAt`: 途中で止める流れは終了時の cursor を明示する。無ければ全消費を検査する。

### Interaction のワイヤ形式

`script` と `interactions` の要素は `{"port","operation","request","outcome"}`。
`port` は `Application/Port/<Port>/`（Domain 所有なら `Domain/Port/<Port>/`）のディレクトリ名そのまま、`operation` は `<操作>.lean` のファイル名の先頭を小文字にしたもの
（抽出器の `ports[].name` / `operations[].method`、生成 Kotlin の `interface <Port>` / `fun <operation>` と同じ綴り）。`request` / `outcome` は Port の `Request` / `Outcome` の `deriving instance` のワイヤ。
綴りは `cradle lean-check` が `Runtime/Json.lean` の文字列で、`cradle golden-check` が応答に現れる port / operation の対で検査する。

## views の規約

- 口（フィールド）は**画面（UseCase）の名前**。
- 画面ごとに `Option`: `null` = そこに無い / 見られない、`[]` = 見えたうえで空。**この 2 つを潰さない**。
- 見え方の値は View 自身の語彙（View→Row の壁・View→ドメイン語彙の壁）。

## golden の規約

| ファイル | 中身 |
|---|---|
| `golden/<name>-init.json` | `init` の応答そのもの（`external` なら `env` も） |
| `golden/<name>-flow.json` | `flow` の応答そのもの（初期状態は同じ `<name>` の init） |
| `golden/<name>.request.json` | 脇書き: 再生に使った 2 つのリクエスト `{"version":1,"init":{…},"flow":{…}}` |

golden の中身を作るのは常に Lean（人手で組み立てたものは 1 つも無い）。
`cradle golden-check` が再生して突き合わせ、意図しない変化を検知する。更新は `--update` だけ。

- 脇書きの `version` は脇書きの形の版（1）。無ければ旧形式 `{"init","flow"}` で、5 cmd で採った golden にだけ許す。1 以外の値は `external` でなくても error。
  `version` が 1 で `init.cmd` が `init`（5 cmd）でもよい（モックアップはいつも version 1 で書く）。`init` / `flow` の中の `version` は `external` プロトコルの版で、実行器が再生時に検査する。2 つの版は独立で、脇書きの判定に効くのは外の版だけ。
- `external` の golden かどうかは脇書きの `init.cmd` が `external` かで決まる（版は見ない）。脇書きの無い `external` の golden（応答に `env` や `result` がある）は再生できない error で、`--manifest` からの復元はしない。
- 保存した `external` の golden の `flow` は、script を全消費しているか、記録した最後の `env.cursor` を `stopAt` に持つ（モックアップが自動で付ける。例は生成器の回帰素材 `lean2kotlin/scaffold-check/port/lean/golden/` の `payment-partial` — 環境 `paymentLost` を 2 手で止め `stopAt` に 1）。
- `cradle golden-check` は `init` と `flow` を再生して応答そのものを突き合わせ、`external` の golden ではさらに `flow` の入力列を `init` + `step` の連鎖で打ち直して再生した `flow` と一致すること（`chain`）と、
  応答に現れる port / operation の対がモデルの Port にあることを検査する。トップに `ok` の無い再生結果は `--update` でも書かない。
