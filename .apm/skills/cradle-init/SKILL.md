---
name: cradle-init
description: Use to start a new product on Cradle or to add the Cradle skeleton to an existing repository — writes cradle.json, the project-facts instruction (.apm/instructions/project.instructions.md), documents/{ddd,ai-notes,infra-design,codebase} templates, CI, and a compiling Lean executable-spec scaffold with a minimal example domain, mockup and CLI.
---

# 骨格を敷く

```bash
node <skills>/cradle-init/scripts/init.mjs --project <Root> [--dir <path>] [--backend <package>] [--only <prefix>] [--dry-run] [--force]
```

`<skills>` は cradle-core 規則のとおり（Claude Code `.claude/skills` / Codex `.agents/skills`）。`<Root>` は Lean のルート名前空間（大文字始まり。例: `MonoWa`）。lake の exe 名はその小文字。

敷くもの: `cradle.json`、`.apm/instructions/project.instructions.md`（このプロジェクト固有の事実。`apm compile` が Claude Code では `.claude/rules/project.md`、Codex では AGENTS.md に写す）、`.gitignore`（追記）、
`.github/workflows/cradle.yml`（lake build と cradle の検査を CI で回す）、`documents/ddd/`（5 ファイル）、`documents/ai-notes/README.md`、`documents/infra-design/`（README + 01〜04）、`documents/codebase/openapi.yaml`、
`lean/`（動く最小ドメイン「メモ」付き。`lake build` → CLI → モックアップ → golden がその場で通る）。既存ファイルは据え置く。
ターゲット別の設定例は置き場があるものだけ: Claude Code の許可リストの例（`settings.local.json.example`。`.claude/` に置く）、`.codex/config.toml`（AGENTS.md の上限を上げる）。
`--backend com.example.notes` を付けると `backend/ktlint-rules/`（設計上の作法を検査する独自ルール 8 本）・`.editorconfig`・`gradle.properties` も敷く（backend フェーズの入口で）。
`--only <prefix> --force` は、そのパスで始まる骨格由来のファイルだけを敷き直す（例: `--only lean/mockup --force` で Cradle を更新したあとのモックアップを最新にする。ドメインのファイルには触れない）。

## 敷いたあと

1. `.apm/instructions/project.instructions.md` の「ドメイン」を埋め、`apm compile`（Codex は `apm compile --single-agents`）で rules / AGENTS.md に写す。
2. `cd lean && lake build` → `cradle status`（Lean が「ビルド済」になる）。`lean/README.md` のドメインの節を書く。
3. ddd スキルで探索を始める。最小ドメイン（Note）は探索の根拠にならず（`cradle status` が「骨格のサンプル」と示す）、形式化の最初のセッションで丸ごと置き換える（層の形は残す）。
4. backend / frontend / e2e / infra は各フェーズのスキルが順に作る（順序を飛ばさない）。

## Lean の骨格に含まれるもの

`Prelude`・`Domain/{Annotations,ValueObject,Error,Entity/Note}`・`Application/{ActorContext,RepositoryState,ReadModel,View,Projection,UseCase/{PostNote,CloseNote,Notes}}`・
`Runtime/{Ids,Command,Machine,Reachable,Views,Json,Scenarios}`・`Laws/Properties`・`Main.lean`（Cradle 標準プロトコル）・`mockup/`。
どのファイルもそのまま規約の実例で、`references/lean-conventions.md`（lean-domain-model スキル）が指す。
