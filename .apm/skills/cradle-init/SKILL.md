---
name: cradle-init
description: Use to start a new product on Cradle or to add the Cradle skeleton to an existing repository — writes cradle.json, CLAUDE.md, documents/{ddd,ai-notes,infra-design,codebase} templates, and a compiling Lean executable-spec scaffold with a minimal example domain, mockup and CLI.
---

# 骨格を敷く

```bash
node .claude/skills/cradle-init/scripts/init.mjs --project <Root> [--dir <path>] [--backend <package>] [--dry-run] [--force]
```

`<Root>` は Lean のルート名前空間（大文字始まり。例: `MonoWa`）。lake の exe 名はその小文字。

敷くもの: `cradle.json`、`CLAUDE.md`、`.gitignore`（追記）、`.github/workflows/cradle.yml`（lake build と cradle の検査を CI で回す）、`documents/ddd/`（5 ファイル）、`documents/ai-notes/README.md`、`documents/infra-design/`（README + 01〜04）、`documents/codebase/openapi.yaml`、
`lean/`（動く最小ドメイン「メモ」付き。`lake build` → CLI → モックアップ → golden がその場で通る）。既存ファイルは据え置く。
`--backend com.example.notes` を付けると `backend/ktlint-rules/`（設計上の作法を検査する独自ルール 8 本）・`.editorconfig`・`gradle.properties` も敷く（backend フェーズの入口で）。

## 敷いたあと

1. `cd lean && lake build` → `cradle status`（Lean が「ビルド済」になる）。
2. `lean/README.md` のドメインの節を書き、`CLAUDE.md` の「このプロジェクト固有の事実」を埋める。
3. `/ddd` で探索を始める。最小ドメイン（Note）は形式化の最初のセッションで置き換える（形は残す）。
4. backend / frontend / e2e / infra は各フェーズのスキルが順に作る（順序を飛ばさない）。

## Lean の骨格に含まれるもの

`Prelude`・`Domain/{Annotations,ValueObject,Error,Entity/Note}`・`Application/{ActorContext,RepositoryState,ReadModel,View,Projection,UseCase/{PostNote,CloseNote,Notes}}`・
`Runtime/{Ids,Command,Machine,Reachable,Views,Json,Scenarios}`・`Laws/Properties`・`Main.lean`（Cradle 標準プロトコル）・`mockup/`。
どのファイルもそのまま規約の実例で、`references/lean-conventions.md`（lean-domain-model スキル）が指す。
