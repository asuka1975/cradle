---
description: Cradle の芯 — 仕様はハーネスであり、ハーネスは決定論的である。開発の順序・正本の所在・道具の使い方
---

# Cradle — Lean 仕様駆動開発の芯

- **仕様は Lean の実行可能仕様（`lean/`）であり、正しさの問いは推測で答えず、モデルを動かして答える。**
  仕様について問われたら `cradle spec-query`（`.claude/skills/cradle/scripts/cradle.mjs spec-query`）で
  シナリオを走らせ、その出力を引用する。型や構成子の問いは `spec-query print <Name>`。
- **現在地は `cradle status` が正。** 作業を始める前に一度走らせ、どのフェーズにいるかを確かめる。
- **開発の順序**: 探索（/ddd）→ インフラ設計（/infra-design）→ Lean 化（/lean-domain-model）→ モックアップで確認（/domain-mockup）
  → API 契約（/api-contract）→ フロントエンド（相手は Lean CLI）→ **人間による画面確認** → バックエンド（/backend-implement）→ E2E（/e2e-parity）。
  バックエンドが最後なのは、モデルの正しさは人間が画面で動かして初めて分かるから。
  モデルを変えた直後にバックエンドがコンパイルできない期間は正常で、それを理由に先回りしない。
  修正点が出たら戻る先は Lean の 1 か所。下流を先に触らない。
- **決まっていないことは実装しない。** ドメインの事実は `documents/ddd/` の正式ドキュメント（event-timeline / hotspots の resolved / ubiquitous-language の確定）にある裏付けだけを根拠にする。
  `ux-review.md` / `model-review.md` の open 項目、`documents/ai-notes/` は裏付けにならない。未決に出会ったらコードを書かず、問いを `documents/ai-notes/` に置いて /ddd に戻す。
- **正本は 1 か所**。ドメインの事実 = `documents/ddd/`、設計の決定 = `documents/infra-design/`、REST 契約 = `documents/codebase/openapi.yaml`、
  実行可能仕様 = `lean/`、生成物の源 = Lean と契約。同じ情報を 2 か所に写さない（写した瞬間から片方が腐る）。
- **生成物は編集しない。** `backend/src/generated/`・`build/generated/`・`frontend/src/api/generated/` は再生成で全上書きされる。直すなら源を直して再生成する。hook が直接編集を止める。
- **`documents/developer/` は人間専用。** 読むのは自由だが AI は作成も編集もしない。
- **`documents/ai-notes/` は規約ではない。** AI の申し送りと規約の候補で、ユーザーが承認したものだけが規約になる。そこを根拠にコードを書かない。
- **Lean を変えたら**: `lake build` → `cradle golden-check`（変えるつもりのなかった流れが変わっていないか）→ 変えた意図があるものだけ `--update`。
  生成を回したら `cradle regen-impact` で、変わった生成シンボルを参照する手書き実装と契約テストを確かめてから実装に着手する。
- **ビルドが通ったら止まらない**: `gradlew build` 成功後は sql-perf-review と backend-design-review、frontend を触ったら frontend-ux-review。指摘は提示で終えず直す。
- **止まる前に**: `cradle unslop --diff` の error を 0 にする。ai-notes に書き置く課題があれば「規約ではない」の断りを冒頭に置く。
- 対話・成果物・レポートは日本語。エキスパートの言葉は言い換えず、そのまま残す。
