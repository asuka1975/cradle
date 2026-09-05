---
name: domain-mockup
description: Use to create, update or run the spec-animation mockup under lean/mockup — "run the mockup", "show the model on a screen", "try this scenario", "demo for the expert", "save a golden". The mockup executes the Lean model as-is; no logic in JS.
---

# 仕様アニメーション（モックアップ）

`lean/mockup/` は Lean モデルをそのまま実行エンジンにする使い捨ての検証 UI。本番 frontend ではない。
狙いは 2 つ: 開発前にモデルの帰結を目視で確かめる（Lean が読めない人への読める化）と、golden の採取。

## 鉄則: UI にロジックを 1 行も書かない

- 合計・並び替え・フィルタ・可否判定を JS で書かない。表示に必要な加工は Lean の `Runtime/Views.lean` に足す。
- state は Lean が返した JSON をそのまま持ち、そのまま送り返す。UI で変形しない。
- シナリオはベタ書きせず `{"cmd":"init"}` で取る。増やすなら `Runtime/Scenarios.lean`。
- サーバー（`server.mjs`）の役割は 4 つだけ: 静的配信・`/api/lean` の素通し・`/api/golden`（応答をそのまま保存）・`/api/meta`（spec-query の結果）。判断を書かない。
- ボタンを段階で隠さない。可否は validate が決め、拒否は domainError としてその場に出す。
- 「誰として」の切り替えはセッションの切り替え。viewer と actor は必ず同時に動く。

## 構成

cradle-init スキルが敷く汎用の UI（`public/index.html`）は views を表と木で描き、コマンドは構成子名の一覧（`/api/meta`）と JSON 欄で送る。
ドメインの語彙で作り込む必要が出たら: Views に足す（Lean）→ `lake build` → 描画だけ足す。

## 起動

```bash
cd lean && lake build && node mockup/server.mjs   # → http://localhost:8787（cradle.json の ports.mockup）
```

すでに動いているポートを使い回す前に、それがこのプロジェクトのものか確かめる（`curl -s http://localhost:8787/api/meta`）。

## golden の採取

操作ログを「golden として保存」→ `golden/<name>-init.json` / `<name>-flow.json` / `<name>.request.json`。中身を作るのは Lean。
採ったら `cradle golden-check` が通ることを確かめ、名前と流れの一言を PR / コミットに書く（README に表を手で保つのではなく、`<name>.request.json` が正）。

## 動作確認

- init → 最初のシナリオが映る。viewer を変えると見える範囲が変わる（`null` と `[]` の区別が描き分けられている）。
- 主要な流れを一巡し、documents の記述どおりの帰結になるか目視する。断られる手も試す。
- 画面とモデルの食い違いを感じたら、UI にロジックが漏れているか views が仕様とずれているかのどちらか。index.html で辻褄合わせをしない。
