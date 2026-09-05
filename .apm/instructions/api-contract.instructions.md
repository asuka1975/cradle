---
description: REST 契約の規約 — 契約が先、コマンドと 1 対 1、名義はリクエストに現れない
applyTo: "documents/codebase/openapi.yaml,backend/src/main/kotlin/**/presentation/**"
---

# API 契約（OpenAPI）

- 正本は `documents/codebase/openapi.yaml`。エンドポイントを足す・変える前にここを直し、backend は `generateApi`、frontend は `pnpm gen:api` で追随する。
- モデルに無い操作はエンドポイントも作らない。コマンドの構成子とエンドポイントは 1 対 1、閲覧は 1 画面 1 エンドポイント。すべて `/api` 配下。
- 名義（actor / owner / raiser）はリクエストに現れない。`Authorization` だけが決める。「今日」も受け取らない。
- 各操作の失敗語彙は operation の 422 に列挙する。403（立場）と 404（宛先なし）は業務失敗と分ける。共通の 400 / 401 / 405 / 415 / 500 は個々の operation に書かない。
- 文字列には長さ上限、識別子には形式を書く。入力検証は契約から生成する（`x-field-extra-annotation` 等）。
- 書くのは「いまどうであるか」だけ。経緯・未決・存在しない操作の一覧・ID・申し送りを書かない。
- View の値は View 自身の語彙で写す（日付は ISO 文字列など）。契約の語彙 = 画面の語彙。
