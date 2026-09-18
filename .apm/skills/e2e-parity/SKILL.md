---
name: e2e-parity
description: Use after the backend follows the model — derive E2E flow scripts from Lean golden traces, replay them against the Lean-backed dev screens and the real REST backend with Playwright, and compare observations. Also use to add a flow when a new command or screen appeared.
---

# E2E（Lean × REST の一致）

人間が Lean CLI 相手の画面で確かめた挙動と、追随させた backend（REST）が同じ観測を返すことを、画面を実際に辿って突き合わせる。

## 手順

1. **台本を起こす**: このスキルの `scripts/flows-from-golden.mjs --out e2e/scenarios/from-golden.json`。
   golden の trace から人物・手・通った / 断られた・そのとき見えた口を機械で列挙する。手で台本を書かない。
   既に手書きの台本を持つプロジェクトは、台本を from-golden.json と同じ `steps` の形（`command` / `actor` / `outcome`）に寄せ、置き場を `cradle.json` の `e2e.scenarios` に書いて `scripts/flows-from-golden.mjs --check` を回す（受け入れの条件は e2e 規則）。
2. **画面への写し**: 各手を「どの画面で・どの要素を・どう操作するか」に写す（ここだけが手書き）。ID に頼らず、ラベル + 当事者で紙面を特定する。日付は相対指定。
3. **前提**: local スタック（infra-implement フェーズの成果物。`infra.up` で立て、`cradle doctor --local` が fresh）と Lean CLI サーバ、dev の画面。テスト用 DB は開発ループと分ける。
4. **播種**: REST 側の初期盤面は golden の init state から REST 経由で作る（DB への直接 INSERT は最小限、test-harness 専用と明記）。
5. **実行**: 両方をその場で走らせて突き合わせる。`workers: 1`。固定スリープでなく DOM の変化を待つ。
6. **差分**: 「backend の追随漏れ」か「モデルの見直し」かを切り分ける。後者は Lean に戻る（frontend 改修からやり直し）。

## 網羅

golden にある流れはすべて台本にする。拒否の手・自動で起きる帰結（番回しなど）・日付で変わる見え方（時計固定）を落とさない。
画面に出ない操作（管理専用など）は対象外と明記し、API 直叩きのテストに回す。
