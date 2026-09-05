---
name: cradle
description: Use when you need the current position in the Lean spec-driven pipeline, or any deterministic check of a Cradle project — status, golden regression, Lean layer walls, regeneration impact, unslop lint, ddd cleanup. Runs the scripts under scripts/ and reports their output verbatim.
---

# cradle — 決定論的な道具の入口

すべて `node .claude/skills/cradle/scripts/cradle.mjs <command>`（プロジェクトルートで実行。以下 `cradle <command>` と書く）。
設定は `cradle.json`（`references/cradle-json.md`）。CLI プロトコルは `references/protocol.md`。

| command | 何をするか | いつ |
|---|---|---|
| `status` | パイプラインの現在地（フェーズごとの事実と次の一手） | 作業の最初。プロダクトオーナーに現在地を説明するとき |
| `spec-query …` | Lean を動かして仕様に答える（`spec-query` スキル） | 仕様に関する問いすべて |
| `golden-check [--update]` | golden を再生して突き合わせる | `lake build` が通ったあと、モデルを変えたとき |
| `lean-check [--build]` | 層の壁・sorry・axiom・生成器への言及 | Lean を編集したあと、コミット前 |
| `regen-impact [--dry-run]` | 再生成 → 生成物の差分 → 参照する手書き実装と契約テスト → golden 回帰 | Lean を変えて backend に追随するとき |
| `unslop [--diff\|--all]` | コメント規約・腐ったパス・逃げ言葉・握りつぶし | 止まる前（Stop hook が error を差し戻す） |
| `ddd-clean-check [--build]` | 探索の残骸（questions.md・probe-・lean の差分）が無いこと | /ddd の終わり |
| `doctor` | 道具の有無と版（node / lake / elan / java / pnpm / apm …） | 導入時、道具が見つからないと言われたとき |

## 使い方の決めごと

- 出力は要約せず、そのまま引用する。判断（意図した変化か・直すか）は出力を見てから書く。
- `golden-check` で CHANGED が出たら、意図した変更だけを `--update` し、golden の差分を変更理由とともにコミットする。意図していない流れが変わっていたら、それがモデル変更の意図しない影響。
- `regen-impact` は生成ディレクトリがクリーンな状態で回す（差分だけ読むなら `--no-regen`）。
- どの道具も `CRADLE_PROJECT_DIR` でルートを指定できる（Claude Code の hook からは `CLAUDE_PROJECT_DIR`）。
- 道具が無いことを確かめる問い（「〜は存在するか」）は `spec-query print` と `meta` で確かめてから答える。

## 道具が落ちたとき

- `Lean CLI がありません` → `cd lean && lake build`。
- `cradle.json に project が要ります` → ルートに `cradle.json` を置く（`/cradle-init`）。
- `golden の request.json が無い` → `--manifest` で scenario / viewer / today を補うか、モックアップで採り直す。
