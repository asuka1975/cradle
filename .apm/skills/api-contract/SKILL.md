---
name: api-contract
description: Use when adding or changing REST endpoints or the OpenAPI contract — deriving endpoints from the Lean commands and views, writing documents/codebase/openapi.yaml first, then regenerating the backend controller interfaces and the frontend client.
---

# API 契約（Lean → openapi.yaml → 生成）

正本は `documents/codebase/openapi.yaml`。実装より先に契約を直し、両側を生成し直す。

## 手順

1. `cradle spec-query meta` でコマンドの構成子・内部入力（observations。提供元の通知・契機）・外部能力の Port・画面の口を取る。`spec-query print` でペイロードと View の形を取る。
2. 契約を書く: コマンド 1 構成子 = 1 エンドポイント（`POST /api/…`、成功は 204、`x-cradle-kind: command`）。観測（内部入力）は提供元から受ける口が要るときだけエンドポイントを持つ（`x-cradle-kind: observation`。worker だけが受けるものは作らない）。GET 以外の操作はすべて `x-cradle-kind` と `x-cradle-model`（`<Root>.Runtime.Command.<構成子>` か `<Root>.Runtime.Observation.<構成子>`）を宣言する。画面 1 つ = 1 `GET`。名義（actor）はリクエストに現れず、観測の受信口にも名義は無い。「今日」も受け取らない。観測は利用者の入力欄に出さない。
3. 各操作の 422 に、その UseCase の validate / execute が返しうる `DomainError` を列挙する（`Domain/Error.lean` と UseCase の契約定理から）。403（立場）と 404（宛先なし）は分ける。
4. 文字列には長さ上限、識別子には形式。入力検証は契約から生成させる。
5. View の値は View 自身の語彙（日付は ISO 文字列）。契約の語彙 = 画面の語彙。
6. 生成: backend は `./gradlew generateApi`（Controller interface + Request/Response）、frontend は `pnpm gen:api`。写し漏れはコンパイルエラーで出る。
7. このスキルの `scripts/contract-check.mjs` で確かめる: GET 以外の操作がすべて `x-cradle-kind` と `x-cradle-model` を宣言している（宣言の無い操作は除外せず NG）、`x-cradle-model` がモデルにある構成子を指す、コマンドと `command` の操作が 1 対 1、観測の操作は高々 1 つ、画面の口に GET がある（`cradle.json` の `api.outletsWithoutEndpoint` に挙げた口を除く）。

## 書かないもの

HS / MQ / UX の ID・経緯・存在しない操作の一覧・申し送り。契約書は「いまどうであるか」だけ。
