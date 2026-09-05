# 導入

## 新規プロダクト

1. `apm init` → `apm.yml` の `targets` に `claude`、`apm install asuka1975/cradle`。
2. Claude Code で `/cradle-init --project <Root>`。`lean/` に動く最小ドメインが入る。`cd lean && lake build`。
3. `/cradle-status` で現在地を確かめ、`/ddd` で探索を始める。最小ドメインは最初の形式化で置き換える。
4. backend を作る段階で lean2kotlin を導入する（`backend-implement` スキル。Gradle の `dev.lean2kotlin` plugin と `lean2kotlin { … }` の設定）。

## 既存プロジェクト（monowa 型）

1. `apm install asuka1975/cradle`。既存の `.claude/skills` / `agents` と名前が衝突するものは Cradle 側に寄せる（プロジェクト固有の事実は `CLAUDE.md` に残す）。
2. ルートに `cradle.json`（`.claude/skills/cradle/references/cradle-json.md`）。既定と違う場所（生成ディレクトリ・ポート・exe 名）だけ書く。
3. `cradle status` / `cradle lean-check` / `cradle unslop --all` を走らせ、出たものを直す。既存の golden には `<name>.request.json` を足す（`golden-check --manifest` で一度再生してから `--update` で作り直してもよい）。
4. `documents/codestyle/` の汎用規約は `.claude/rules/` に置き換わる。プロジェクト固有の決めごとだけを残す。

## ai-notes からの昇格

ユーザーが承認した候補のうち、このプロジェクト固有のものは `documents/decisions.md` に転記する。どのプロダクトにも効くものは Cradle に提案する（`.claude/rules/` を直接編集しない）。

## ハーネスの更新

`apm update` で新しい版を取り、`apm audit` で配布物への手編集が無いことを確かめる。規約を足したいときは Cradle 側に PR を出す（プロジェクトの `.claude/rules/` を直接編集すると次の install で上書きされる）。
