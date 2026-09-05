# Lean CLI プロトコル（Cradle 標準）

実行可能仕様は `lake exe <exe>` で JSON stdin → JSON stdout の CLI になる。1 リクエスト 1 プロセス。
モックアップ（仕様アニメーション）・golden・`cradle spec-query`・E2E 台本生成はすべてこの 1 本の口だけを使う。
CLI を持たない Lean 仕様は Cradle のハーネスに乗らない。

## リクエスト

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

## 応答の 3 種

| 形 | 意味 |
|---|---|
| `{"ok": …}` | 通った |
| `{"domainError": …}` | 業務として断られた（`DomainError` の語彙。状態は変わっていない） |
| `{"error": "…"}` | プロトコルエラー（形が悪い・未知の scenario / cmd・検査に通らない state） |

`trace` の各要素は `{"actor","command","state","views"}`（通った）か `{"actor","command","domainError"}`（断られた）。
断られた手も trace に残る — 失敗系も契約テスト・E2E の材料になる。

## views の規約

- 口（フィールド）は**画面（UseCase）の名前**。
- 画面ごとに `Option`: `null` = そこに無い / 見られない、`[]` = 見えたうえで空。**この 2 つを潰さない**。
- 見え方の値は View 自身の語彙（View→Row の壁・View→ドメイン語彙の壁）。

## golden の規約

| ファイル | 中身 |
|---|---|
| `golden/<name>-init.json` | `init` の応答そのもの |
| `golden/<name>-flow.json` | `flow` の応答そのもの（初期状態は同じ `<name>` の init） |
| `golden/<name>.request.json` | 再生に使った 2 つのリクエスト `{"init":{…},"flow":{…}}` |

golden の中身を作るのは常に Lean（人手で組み立てたものは 1 つも無い）。
`cradle golden-check` が再生して突き合わせ、意図しない変化を検知する。更新は `--update` だけ。
