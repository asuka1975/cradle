---
name: domain-mockup
description: Use to create, update or run the spec-animation mockup under lean/mockup — "run the mockup", "show the model on a screen", "try this scenario", "demo for the expert", "save a golden" — and to build the domain-language screens that let the expert review the model without reading JSON. The mockup executes the Lean model as-is; no logic in JS.
---

# 仕様アニメーション（モックアップ）

`lean/mockup/` は Lean モデルをそのまま実行エンジンにする使い捨ての検証 UI。本番 frontend ではない。
狙いは 2 つ: 開発前にモデルの帰結をエキスパートが画面で確かめる（Lean が読めない人への読める化）と、golden の採取。
このフェーズの成果物は **エキスパートが JSON を読まずに主要な流れを一巡できる画面**。骨格の汎用 UI で終わらせない。

## 鉄則: UI にロジックを 1 行も書かない

- 合計・並び替え・フィルタ・可否判定を JS で書かない。表示に必要な加工は Lean の `Runtime/Views.lean` に足す。
- state は Lean が返した JSON をそのまま持ち、そのまま送り返す。UI で変形しない。
- シナリオはベタ書きせず `{"cmd":"init"}` で取る。増やすなら `Runtime/Scenarios.lean`。
- サーバー（`server.mjs`）の役割は 4 つだけ: 静的配信・`/api/lean` の素通し・`/api/golden`（応答をそのまま保存）・`/api/meta`（spec-query の結果と用語集）。判断を書かない。
- ボタンを段階で隠さない。可否は validate が決め、拒否は domainError としてその場に出す。
- 「誰として」の切り替えはセッションの切り替え。viewer と actor は必ず同時に動く。

## 土台（骨格の汎用 UI）

cradle-init スキルが敷く `public/index.html` は、views の口ごとの表、`/api/meta` の schemas（Lean の Command 構造体の型）から生成した入力欄、用語集（`ubiquitous-language.md` の英語候補 → 用語）による表示名を持つ。判断は持たない。
人が打つ表記が内部表現と違う値オブジェクトは、`Runtime/Json.lean` の手書き `FromJson`（文字列 1 本を受ける）と docstring の注記で欄になる（schemas の `hint`）。型名の特別扱いを index.html に書かない。
これは「動く」が「読める」ではない。集約と操作の関係、誰が何をできるかは、ドメインの語彙で並べて初めて見える。

## 作り込み（必須）

1. `cradle status` で画面の口（Views）を確かめる。口が無い・足りないなら先に lean-domain-model スキルで `Views` に足す（描画は Lean の結果を写すだけ。UI で補わない）。
2. 画面の単位は **Views の口ごとに 1 画面（タブ）**。名前はユビキタス言語の用語。`null`（見られない）と `[]`（見えたうえで空）を描き分ける。フロントエンドはこの規則を引き継がない（画面の単位は業務のまとまり — frontend スキル）。
3. 操作の置き場は **コマンドごとに 1 フォーム。対象の行の横に置く**。行の ID はフォームが持ち、人に打たせない。対象を持たない操作（登録など）は口の上に置く。入力欄のラベルは用語、Option は任意入力、列挙は選択肢。
4. 「誰として」は、シナリオに現れる名義（views に出る人・部署など）の一覧から選ぶ。viewer と actor を同時に切り替える。
5. 置かないもの: Command に無い操作のボタン（反機能）、段階で隠すボタン、documents で却下されたもの。
6. 拒否（domainError）はその場に Lean の語彙で出す。state は巻き戻さない。
7. golden 保存と操作ログは骨格のまま残す。

作り込みは `index.html` の描画を口ごと・コマンドごとに足す形で行う（骨格の `lean()`・`send()`・`renderAll()` の骨は残す）。JS でこしらえるのは描画と入力欄だけ。
作り込んだら冒頭の注記「Cradle 標準の汎用モックアップ」を、この画面が何を映すかの一文に置き換える（`cradle status` はその注記で「汎用 UI のまま」かを見る）。
Cradle を更新したあと骨格を敷き直すのは `server.mjs` だけ（`cradle-init` の `--only lean/mockup/server.mjs --force`）。`index.html` は作り込み後のものが正本。

## 起動

```bash
cd lean && lake build && node mockup/server.mjs   # → http://localhost:8787（cradle.json の ports.mockup）
```

すでに動いているポートを使い回す前に、それがこのプロジェクトのものか確かめる（`curl -s http://localhost:8787/api/meta`）。

## golden の採取

操作ログを「golden として保存」→ `golden/<name>-init.json` / `<name>-flow.json` / `<name>.request.json`。中身を作るのは Lean。
採ったら `cradle golden-check` が通ることを確かめ、名前と流れの一言を PR / コミットに書く（README に表を手で保つのではなく、`<name>.request.json` が正）。

## 動作確認

- init → 最初の口が用語の名前で映る。「誰として」を変えると見える範囲が変わる（`null` と `[]` の描き分け）。
- `documents/ddd/event-timeline.md` の出来事を順に、JSON を読まずに一巡できる。断られる手も試し、拒否がその場に出る。
- resolved の HS ごとに 1 項目、その結論が画面で見えることを確かめる。
- 画面とモデルの食い違いを感じたら、UI にロジックが漏れているか views が仕様とずれているかのどちらか。index.html で辻褄合わせをしない。
