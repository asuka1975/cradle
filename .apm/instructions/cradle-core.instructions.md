---
description: Cradle の芯 — 仕様はハーネスであり、ハーネスは決定論的である。開発の順序・正本の所在・道具の使い方
---

# Cradle — Lean 仕様駆動開発の芯

- **仕様は Lean の実行可能仕様（`lean/`）であり、正しさの問いは推測で答えず、モデルを動かして答える。**
  仕様について問われたら `cradle spec-query` でシナリオを走らせ、その出力を引用する。型や構成子の問いは `spec-query print <Name>`。
- **道具の呼び方**: `cradle <command>` = `node <skills>/cradle/scripts/cradle.mjs <command>`（プロジェクトルートで実行）。
  `<skills>` は Cradle のスキル置き場で、Claude Code では `.claude/skills`、Codex では `.agents/skills`。
  他のスキルの道具（`ddd.mjs`・`init.mjs` など）も同じ置き場の各スキルの `scripts/` にある。
  スキルは Claude Code では `/名前`、Codex では `$名前` で呼ぶ。規約もスキルも以下では名前だけで書く。
- **現在地は `cradle status` が正。** 作業を始める前に一度走らせ、どのフェーズにいるかを確かめる。
- **開発の順序**: 探索（ddd）→ インフラ設計（infra-design）→ Lean 化（lean-domain-model）→ モックアップで確認（domain-mockup）
  → API 契約（api-contract）→ フロントエンド（frontend。相手は Lean CLI）→ **人間による画面確認** → バックエンド（backend-implement）→ インフラ実装（infra-implement）→ E2E（e2e-parity）→ 本番投入（infra-implement）。括弧内はスキル名。
  バックエンドが画面確認の後なのは、モデルの正しさは人間が画面で動かして初めて分かるから。
  モデルを変えた直後にバックエンドがコンパイルできない期間は正常で、それを理由に先回りしない。
  修正点が出たら戻る先は Lean の 1 か所。下流を先に触らない。
- **決まっていないことは実装しない。** ドメインの事実は `documents/ddd/` の正式ドキュメント（event-timeline / hotspots の resolved / ubiquitous-language の確定）にある裏付けだけを根拠にする。
  `ux-review.md` / `model-review.md` の open 項目、`documents/ai-notes/` は裏付けにならない。未決に出会ったらコードを書かず、問いを `documents/ai-notes/` に置いて ddd に戻す。
- **正本は 1 か所**。ドメインの事実 = `documents/ddd/`、設計の決定 = `documents/infra-design/`、REST 契約 = `documents/codebase/openapi.yaml`、
  実行可能仕様 = `lean/`、生成物の源 = Lean と契約。同じ情報を 2 か所に写さない（写した瞬間から片方が腐る）。
- **生成物は編集しない。** `backend/src/generated/`・`build/generated/`・`frontend/src/api/generated/` は再生成で全上書きされる。直すなら源を直して再生成する。hook が直接編集を止める。
- **骨格のサンプルドメインは事実ではない。** `cradle status` が Lean を「骨格のサンプル」と言う間、`lean/` の型・ユースケース・シナリオ（メモ）を探索・設計・実装の根拠にしない。探索の根拠は `documents/ddd/`（プロダクトの一言・出来事・用語）だけで、`lean/` のサンプルは根拠にしない。実ドメインの形式化でサンプルを丸ごと置き換える。
- **`documents/developer/` は人間専用。** 読むのは自由だが AI は作成も編集もしない。
- **`documents/ai-notes/` は規約ではない。** AI の申し送りと規約の候補で、ユーザーが承認したものだけが規約になる。そこを根拠にコードを書かない。
- **Lean を変えたら**: `lake build` → `cradle golden-check`（変えるつもりのなかった流れが変わっていないか）→ 変えた意図があるものだけ `--update`。
  生成を回したら `cradle regen-impact` で、変わった生成シンボルを参照する手書き実装と契約テストを確かめてから実装に着手する。
- **ビルドが通ったら止まらない**: `gradlew build` 成功後は sql-perf-review と backend-design-review、frontend を触ったら frontend-ux-review。指摘は提示で終えず直す。
- **止まる前に**: `cradle unslop --diff` の error を 0 にする。ai-notes に書き置く課題があれば「規約ではない」の断りを冒頭に置く。
- 対話・成果物・レポートは日本語。エキスパートの言葉は言い換えず、そのまま残す。
