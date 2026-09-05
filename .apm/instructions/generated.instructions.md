---
description: 生成物は源を直して再生成する
applyTo: "**/src/generated/**,**/build/generated/**,**/api/generated/**"
---

- このディレクトリは生成物。再生成で全上書きされるので直接編集しない（hook が止める）。
- 源: Kotlin の型・interface・契約テスト = `lean/`（`cradle regen-impact` で再生成と影響範囲）、Controller interface と Request/Response = `documents/codebase/openapi.yaml`、frontend の型 = 同じ契約（`pnpm gen:api`）、jOOQ = `schema.sql`。
- 生成された interface に実装や default メソッドを足さない。実装は別ファイルの実装クラス。
- 生成された抽象契約テストは具象サブクラスで実装を注入して走らせる。走っていない契約テストは無いのと同じ。
- 生成ログの note（「無視」「語彙の壁」「生成されなかった」）は失敗として読む。黙って通さない。
- 生成物は git 管理に置く（gitignore しない）。再生成して `git diff --exit-code` が 0 であることが「同期している」の定義で、CI もそれを検査する。`cradle regen-impact` はこの前提で差分を読む。
