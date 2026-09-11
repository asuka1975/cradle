# cradle.json

プロジェクトルートに置く Cradle の設定。`project`（Lean のルート名前空間）だけあれば動き、他は既定値で埋まる。
`cradle.json` が無い場合は `lean/lakefile.toml` の `lean_lib` 名からルートを推測する。

```json
{
  "cradle": 1,
  "project": "MonoWa",
  "lean": {
    "dir": "lean",
    "root": "MonoWa",
    "exe": "monowa",
    "golden": "lean/golden",
    "mockup": "lean/mockup",
    "sorryMax": 0,
    "entityImportAllow": ["Application/RepositoryState.lean", "Application/Projection.lean"],
    "forbiddenMentions": ["Lean2Kotlin"]
  },
  "backend": {
    "dir": "backend",
    "generated": ["backend/src/generated"],
    "regenerate": "./gradlew generateKotlinFromLean",
    "build": "./gradlew build",
    "test": "./gradlew test"
  },
  "frontend": { "dir": "frontend", "generated": ["frontend/src/api/generated"], "genApi": "pnpm gen:api" },
  "documents": {
    "dir": "documents", "ddd": "documents/ddd", "aiNotes": "documents/ai-notes",
    "developer": "documents/developer", "infraDesign": "documents/infra-design",
    "openapi": "documents/codebase/openapi.yaml"
  },
  "e2e": { "dir": "e2e" },
  "infra": { "dir": "infra", "up": "docker compose --project-directory infra/local up -d --build", "containers": ["myapp-local-backend", "myapp-local-frontend"] },
  "ports": { "mockup": 8787, "frontend": 5173, "backend": 8080, "idp": 8090 },
  "protected": ["documents/developer/**"],
  "unslop": { "disable": [], "extraHedges": [], "ignorePaths": [], "skipFiles": [] }
}
```

| キー | 意味 |
|---|---|
| `lean.root` | Lean のルート名前空間（`lean/<root>/` がモデルの家）。既定は `project` |
| `lean.exe` | `lake exe` の名前（`.lake/build/bin/<exe>`）。既定は `project` の小文字 |
| `lean.sorryMax` | 許容する `sorry` の数（`cradle lean-check`）。既定 0 |
| `lean.entityImportAllow` | 読み取り側で `Domain.Entity` の import を許す例外（射影・観測モデル） |
| `backend.generated` | 生成物のディレクトリ。hook が直接編集を止め、`regen-impact` が差分を読む |
| `backend.regenerate` | 再生成コマンド（`backend.dir` で実行） |
| `infra.up` | local スタックを立てる 1 コマンド（ルートで実行）。既定なし |
| `infra.containers` | local スタックのコンテナ名。`cradle doctor --local` が Created と HEAD の時刻を比べる |
| `protected` | AI が書き込まない領域（glob） |
| `unslop.*` | `cradle unslop` の調整。`disable` に規則 id、`ignorePaths` に実在しなくてよいパスの glob、`skipFiles` に検査しないファイルの glob（他リポジトリを引用する文書など。`apm.lock.yaml` は既定で除外） |

環境変数 `CRADLE_PROJECT_DIR`（または Claude Code の `CLAUDE_PROJECT_DIR`）でルートを、`CRADLE_CONFIG` で設定ファイルを上書きできる。
