# 導入

## Pi / OpenCode V2（プレビュー）

APMでCodex向けの規約・スキルを配り、その上に追加の統合を読み込む。
[Pi / OpenCode V2 導入手順](integrations.md)に、消費側の設定パス・依存関係・未検証の範囲を記載している。

## 新規プロダクト

1. `apm init` → `apm.yml` の `targets` に `claude` か `codex`（両方でもよい）、`apm install asuka1975/cradle`。Codex はさらに `apm compile --single-agents`（規約を 1 枚の AGENTS.md にする）。
2. cradle-init スキル（Claude Code `/cradle-init`、Codex `$cradle-init`）で `--project <Root>`。`lean/` に動く最小ドメインが入る。
   `.apm/instructions/project.instructions.md` にこのプロジェクト固有の事実を書き、`apm install` で rules に写す（Codex は `apm compile --single-agents` で AGENTS.md に）。`cd lean && lake build`。
3. cradle-status スキルで現在地を確かめ、ddd スキルで探索を始める。最小ドメインは最初の形式化で置き換える。
4. backend を作る段階で lean2kotlin を導入する（`backend-implement` スキル。Gradle の `dev.lean2kotlin` plugin と `lean2kotlin { … }` の設定）。生成器の置き場と配線は同スキルの `references/gradle-wiring.md`。`cradle doctor` で解決できることを先に確かめる。

## 既存プロジェクト（monowa 型）

1. `apm install asuka1975/cradle`。既存のスキル / エージェントと名前が衝突するものは Cradle 側に寄せる。プロジェクト固有の事実は `CLAUDE.md` / 手書きの `AGENTS.md` から `.apm/instructions/project.instructions.md` に移す（Codex では `apm compile` がルートの AGENTS.md を書き換える）。
2. ルートに `cradle.json`（cradle スキルの `references/cradle-json.md`）。既定と違う場所（生成ディレクトリ・ポート・exe 名）だけ書く。
3. `cradle status` / `cradle lean-check` / `cradle unslop --all` を走らせ、出たものを直す。既存の golden には `<name>.request.json` を足す（`golden-check --manifest` で一度再生してから `--update` で作り直してもよい）。
4. `documents/codestyle/` の汎用規約は Cradle の rules に置き換わる。プロジェクト固有の決めごとだけを残す。

## Codex で違うこと

- 規約は `.claude/rules/` の代わりに AGENTS.md（`apm compile --single-agents`）。Codex は起動時にルートから cwd までの AGENTS.md しか読まないので、ディレクトリ別に分けない。
  読込上限（`project_doc_max_bytes`、既定 32 KiB）を骨格の `.codex/config.toml` が上げる。超過は `cradle doctor` が出す。
- hooks は `.codex/hooks.json`。Claude Code と同じ stdin / stdout なので中身は共通。`.codex/` はプロジェクトを信頼したときだけ読まれ、hooks はさらに起動時のレビューで信頼したものだけが動く（`/hooks` で確かめる）。
  非対話の `codex exec` では信頼が残っていない hooks は黙って飛ばされるので、自動化では `--dangerously-bypass-hook-trust` を付ける。信頼の有無は `cradle doctor` が出す。
- サブエージェントは非同期（`spawn_agent` → `wait_agent`）。ddd スキルの探索役は `wait_agent` を最終状態まで待ち直す。急かすと問いが捨てられるので、`ddd.mjs end` は回答を中継した後でだけ通る。
- エージェントは `.codex/agents/*.toml`。Claude Code 用の `tools` 制限は落ちる（APM が警告する）。レビュアーが書き換えないことは本文の指示で担保する。
- Claude Code の `ask`（止めて人間に聞く）は無い。Lean の未コミット差分があるまま backend を触る場面は、止めずに文脈で促す。
- `cradle-status` は skill として配る（APM は prompts を Codex に配らない）。

## ai-notes からの昇格

ユーザーが承認した候補のうち、このプロジェクト固有のものは `documents/decisions.md` に転記する。どのプロダクトにも効くものは Cradle に提案する（配られた rules を直接編集しない）。

## ハーネスの更新

`apm update` で新しい版を取り、`apm audit` で配布物への手編集が無いことを確かめる。規約を足したいときは Cradle 側に PR を出す（配られた rules を直接編集すると次の install で上書きされる）。Codex は install のあと `apm compile --single-agents` も回す。
