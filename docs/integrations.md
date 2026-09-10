# Pi / OpenCode V2 統合

Cradle は APM パッケージとして Claude Code / Codex に加え、Pi と OpenCode V2 でも利用できる。

## Pi

### インストール

```bash
pi install -l /path/to/cradle
# または git 経由
pi install -l git:github.com/asuka1975/cradle
```

### 有効化 / 無効化

```bash
# 対話式
pi config -l

# Extension だけ OFF（Skills/Agents は残る）
pi config -l extensions.cradle-pi false
```

変更後は `/reload`。

### 提供されるもの

- Extension: `.apm/skills/cradle/scripts/pi-extension.ts`
- Skills: `.apm/skills/`
- Agents: `integrations/pi/agents/`

### 動作

- `tool_call` で生成物・保護領域・golden・探索正式ドキュメントへの編集をブロック
- `tool_result` でビルド・編集後の促しを追加
- `agent_end` で unslop error 検査を行い、違反があれば follow-up を投入
- Claude/Codex の Stop hook と完全には一致しない。終了検査はベストエフォート

## OpenCode V2

### 設定

`opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./integrations/opencode"]
}
```

### 提供されるもの

- Plugin: `integrations/opencode/index.ts`
- Agents: `integrations/opencode/agents/`

### 動作

- `ctx.permission.hook("evaluate")` で保護領域・生成物・golden・探索正式ドキュメントを deny
- `ctx.tool.hook("execute.after")` でビルド・編集後の促しを synthetic message で追加
- V1 の hook API とは互換がない

### 実ランタイム smoke test

```bash
npm run test:opencode
```

一時プロジェクトを作り、実際の `opencode2 serve` にこの Plugin をロードさせる。`/api/health` を確認した後、golden と探索正式ドキュメントへの permission を API 経由で評価し、いずれも `deny` になることを確認する。Plugin の依存パッケージは `integrations/opencode/package.json` の `@opencode/plugin@beta` で解決する。

## モデル

Pi/OpenCode 用の Agent にはモデルを固定しない。利用者の設定に委ねる。
Pi では `pi-subagents.agentOverrides` で、OpenCode では `agents` 設定で割り当てる。

## 既存ハーネスとの分離

Claude/Codex の `hook.mjs` と `unslop-lint.mjs` は変更しない。
Pi の判定は `.apm/skills/cradle/scripts/pi-policy.mjs`、OpenCode の判定は `integrations/opencode/index.ts` に独立して置く。
Pi は既存の `lib.mjs` と unslop 検査器を変更せず利用する。ハーネス間の判定の共通化は今回の対象外。
Pi の終了検査は `--all`、既存の Claude/Codex の終了検査は従来どおり差分を対象とする。
