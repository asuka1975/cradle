---
name: frontend
description: Use for the frontend phase after the API contract exists — deciding the screens as units of work (one job a person finishes in one go, per actor of the event timeline), collecting the views and commands each screen needs, keeping the screen map in frontend/README.md, building against the Lean CLI, then handing over to frontend-ux-review and the human screen check. Not for the spec-animation mockup (domain-mockup).
---

# フロントエンド

現場の人が仕事を終わらせる画面を `frontend/` に作る。相手は Lean CLI（frontend 規約）。
順序の確認から始める: `cradle status` で API 契約が着手済（操作がある）で、モックアップが作り込み済であること。
open の HS / MQ を見て、典型的な 1 件を最初から最後まで歩ける流れが `documents/ddd/event-timeline.md` にあり、open の HS / MQ がその流れを止めていないこと。止めているなら ddd スキルに戻る。材料が無いまま始めない。

## 画面の単位

業務のまとまり。主体（`event-timeline.md` の主体列）ごとに、その人が一続きで終わらせる仕事 1 つ = 1 画面。集約ごとでもコマンドごとでもない。
1 画面に要る口（Views）とコマンドを集め、要らないものは出さない。

## モックアップとの違い

共通なのは「契約への口」と「判断を持たない」だけ。

| | モックアップ | フロントエンド |
|---|---|---|
| 相手 | ドメインエキスパート | 現場の人 |
| 目的 | モデルの帰結を漏れなく確かめる・golden を採る | 仕事を終わらせる |
| 単位 | 口ごと・コマンドごと（全部見えることが要件） | 業務のまとまりごと（要らないものは出さない） |
| 寿命 | 使い捨て | 本番 |

## 手順

1. 主体ごとに仕事を列挙し、画面に割る（単位は上の節）。
2. 画面ごとに使う口（Views）とコマンドを `cradle spec-query meta` から集める（`observations` は内部入力で画面の操作ではないので集めない）。足りない口は Lean に戻す（frontend 規約）。
3. `frontend/README.md` に「画面 ↔ 仕事（主体）↔ 口・コマンド」の対応表を持つ。
4. `frontend/` の package（openapi-fetch と `gen:api`）が無ければ先に作り、`pnpm gen:api` で契約クライアントを生成する。口はその生成物 1 枚（frontend 規約）。
5. 相手は Lean CLI。dev は `node lean/mockup/server.mjs` の `/api/lean` を fetch 注入で使う。
6. `pnpm lint` / `pnpm test` → frontend-ux-review → 人間による画面確認（ゲート）。

## 決めごと

- モックアップの口ごとのタブ・コマンドごとのフォームを持ち込まない。名義は画面で選ばない（frontend 規約）。
- 判断を画面に書かない・未決をデザインで埋めない（frontend 規約）。
