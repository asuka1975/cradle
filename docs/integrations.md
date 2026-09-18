# Pi / OpenCode V2 統合（プレビュー）

既存の Claude Code / Codex の hook と検査器を変更せず、追加のアダプターから利用する。
Pi/OpenCodeの子エージェントへのガード適用と探索の質問中継は、まだ実運用の検証が済んでいない。全面的な互換対応とは扱わない。

## 共通の前提

Pi/OpenCodeでも **APMによる導入が必要**。Pi Packageだけではプロジェクトの規約や骨格を用意しない。

```bash
# 消費側のプロジェクトで実行。既存のapm.ymlがあればtargetsにcodexを追加する。
printf 'name: my-product\nversion: "0.1.0"\ntargets:\n  - codex\ndependencies:\n  apm: []\n' > apm.yml
apm install asuka1975/cradle#v0.1.0-alpha.11
apm compile --single-agents
```

- 規約は compile 後の `AGENTS.md`、スキルと道具は `.agents/skills/` を利用する。`<skills>` は Pi/OpenCodeでも `.agents/skills` と読み替える。
- 新規プロジェクトでは `.agents/skills/cradle-init/scripts/init.mjs` を `--project MyProduct` で実行し、`apm compile --single-agents` を再実行する。
- `cradle.json` は消費側の設定。保護領域・生成先などの変更はこの設定に書く。
- APMの配置が異なる場合、以下の `apm_modules/asuka1975/cradle` は実際のインストール先に読み替える。

## Pi

```bash
pi install -l ./apm_modules/asuka1975/cradle
pi config -l
```

`pi config` / `pi config -l` は対話式。ExtensionのON/OFFを選び、Pi内で `/reload` する。
設定を直接書く場合は `.pi/settings.json` の既存エントリを次のように変更する（相対パスは設定ファイル基準）。

```json
{
  "packages": [
    {
      "source": "../apm_modules/asuka1975/cradle",
      "extensions": []
    }
  ]
}
```

`extensions: []` はこのパッケージのExtensionを読み込まない指定。
Pi用Extensionは `integrations/pi/index.ts`。スキルはAPMが配った `.agents/skills` から自動検出されるため、Pi Packageからは重複登録しない。
Agentsは `integrations/pi/agents` を pi-subagents が読み込む。モデルは `subagents.agentOverrides.<name>.model` など利用者設定に委ねる。

### 動作と限界

- `tool_call` は相対パスを `ctx.cwd` 基準で既存hookへ渡す。
- 成功した `tool_result` に既存hookの促しを追記する。
- `agent_end` で既存unslop検査器の `--all` を実行し、違反一覧をfollow-upへ渡す。自己投入したfollow-upの終了は1回飛ばし、その後の通常ターンでは検査を再開する。
- Claude/CodexのStopは従来どおり差分が対象。Piの全件検査とは範囲が違う。
- Piのイベントから子の役割を識別する処理は未実装。探索役の中継操作ガードやdddの質問中継を保証しない。

## OpenCode V2

OpenCodeを使う場合だけ、SDK依存を導入する。ルートの `npm ci` やPi Packageの導入では、このネストしたパッケージはインストールされない。

```bash
npm ci --omit=dev --prefix apm_modules/asuka1975/cradle/integrations/opencode
mkdir -p .opencode/agents
cp apm_modules/asuka1975/cradle/integrations/opencode/agents/*.md .opencode/agents/
```

`opencode.json` または `opencode.jsonc` の既存設定へ追記する。

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./apm_modules/asuka1975/cradle/integrations/opencode"]
}
```

Cradle自身のcheckoutを開くときだけ `./integrations/opencode` を使う。
`cradle doctor` は設定にパスがあることを表示するが、実際のロード成功までは判定しない。
Agentsのコピーは更新時にも必要。既存の同名エージェントは上書き前に確認する。

### 動作と限界

- `permission.evaluate` の `edit` / `shell` を既存hookへ委譲する。`cradle.json` とセッションの作業ディレクトリを利用し、`read` はブロックしない。
- 探索役の識別はコマンド文字列でなく `event.agent` を使う。`ddd-domain-explorer.md` で定義した同名のエージェントを実機で起動し、通常のshellは通り、`node ddd.mjs end` は既存hookの理由付きで拒否されることを確認している。任意のID/表示名への変更まで保証するものではない。
- `execute.after` の成功結果に既存hookの促しを追加する。別のターンは起動しない。
- OpenCodeの終了検査は未実装。V1との互換性は対象外。
- 依存SDKは `0.0.0-beta-19425` に固定。実ランタイムsmokeの確認済みCLIは `0.0.0-beta-19135`。両者は同一の版番号ではないので、更新時には組合せを再検証する。

## エージェント生成

`.apm/agents/*.agent.md` を正本に `node scripts/generate-agents.mjs` で生成する。
Piの `Glob` は `find, ls` に対応させる。Claude固有のMCPツール名は移植せず除外する。
ブラウザ用MCPは利用者の環境で設定し、実画面を触れない場合は未実施と報告する。
OpenCodeには存在しない `tools` 設定を出さず、書込みを持たないレビュアーの `edit` はdeny、書込み役はaskにする。

## 開発・検証

```bash
npm ci
npm test
node scripts/generate-agents.mjs --check
npm ci --prefix integrations/opencode
npm run typecheck
node --test integrations/opencode/adapter.test.mjs
node scripts/opencode-runtime-smoke.mjs
node scripts/opencode-tools-smoke.mjs
```

実ランタイムsmokeは一時プロジェクトと独立した設定・データ領域で `opencode2 serve` を起動する。
health、goldenのdeny、探索ドキュメントのdeny/セッション印がある場合のallowを確かめる。
ツールsmokeはローカルの固定モデル応答から実際の `write` / `edit` / `shell` を呼び出す。
実機で確認した入力は `write: {path, content}`、`edit: {path, oldString, newString}`、`shell: {command}`。
Lean編集・契約編集・Gradle build・lake buildの促し、Gradle cleanでは促さないことを、保存されたツール結果まで確認する。
Gradle/Leanそのもののビルドはこのsmokeの対象外で、成功メッセージを出すテスト用実行ファイルを使う。モデルへの外部送信は行わない。
同じsmokeでmarkdown定義の探索役セッションも起動する。shellを設定でallowにした状態で通常コマンドは成功し、中継操作はhookで拒否され、実行確認用ファイルが作られないことを確かめる。質問の往復や `subagent` ツールからの起動はこの検証に含まない。

判定の抽出・共通化は別途検討する。追加した `integrations/hook-client.mjs` は既存CLIを子プロセスで呼び、入出力を変換するだけで、保護パスやビルド判定の規則は持たない。
