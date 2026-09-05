# backend の Gradle 配線（lean2kotlin・OpenAPI・jOOQ・ktlint 独自ルール）

`init.mjs --backend <package>` が `backend/ktlint-rules/`・`backend/.editorconfig`・`backend/gradle.properties` を敷く。残りは下の断片を `build.gradle.kts` / `settings.gradle.kts` に足す。

## settings.gradle.kts

```kotlin
pluginManagement {
	// lean2kotlin の Gradle plugin を composite build で解決する。場所は環境変数で与える（機械固有パスをコミットしない）。
	includeBuild(System.getenv("LEAN2KOTLIN_HOME")?.let { "$it/generator" } ?: "../../lean2kotlin/generator")
	repositories { gradlePluginPortal(); mavenCentral() }
}
rootProject.name = "<project>"
include("ktlint-rules")
```

## build.gradle.kts（要点）

```kotlin
plugins {
	kotlin("jvm") version "<kotlin>"
	kotlin("plugin.spring") version "<kotlin>"
	id("org.springframework.boot") version "<boot>"
	id("io.spring.dependency-management") version "<dm>"
	id("dev.lean2kotlin")
	id("org.jlleitschuh.gradle.ktlint") version "<ktlint-gradle>"
	id("org.openapi.generator") version "<openapi-generator>"
}

dependencies {
	ktlintRuleset(project(":ktlint-rules"))   // 設計上の作法をリンタで検査する
	testImplementation("io.kotest:kotest-property:<kotest>")   // 生成された契約テスト（PBT）が要求する
	testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-core")
}

ktlint {
	version = providers.gradleProperty("ktlintVersion")
	filter { exclude { it.file.path.contains("${File.separator}generated${File.separator}") } }   // 生成物は検査しない
}

lean2kotlin {
	kotlinPackage = "<package>.domain"
	goldenDir = file("../lean/golden")
	leanRootNamespace = "<Root>"
	leanExtractorDir = file(System.getenv("LEAN2KOTLIN_HOME")?.let { "$it/lean" } ?: "../../lean2kotlin/lean")
	leanDomainDir = file("../lean")
	// 型引数の binder が <Root>.Runtime.<binder> で解決できないものだけ上書きする
	// binderOverrides.put("G", "<Root>.Application.NoteIdGeneratorState")
}

// OpenAPI: documents/codebase/openapi.yaml → Controller interface（interfaceOnly + skipDefaultInterface）と Request/Response
// jOOQ: src/main/resources/db/schema.sql → build/generated/jooq（DDLDatabase）
// どちらも compileKotlin が依存し、出力は git 管理外。
```

`compileKotlin` は毎回 `extractLeanIr`（`lake build`）に依存する。Lean を触らないタスクで IR が既にあるなら `-x extractLeanIr` で飛ばしてよい。

## 生成器の既知の癖

- validate 面の `@[contract]` は生成器を落とす → モデル側で指名を外す。
- フィールド 0 の `@[actorContext]` は不正な Kotlin になる → 印の型は使わない（`cradle lean-check` が検査する）。
- Runtime 在住の参照専用 ID VO は `runtime` パッケージに出る → 同一性の VO は Entity の持ち物にするか、`Domain/ValueObject.lean` に置く。
- golden は `<name>-init.json` / `<name>-flow.json` の 2 本組でなければ無視される（note が出る）。note は失敗として読む。

## 抽出が失敗したとき（Lean 側を直す）

| エラー | 対処 |
|---|---|
| 型 X に区分がありません | 置き場（Domain/ValueObject・Domain/Entity）か `@[valueObject]` / `@[aggregateRoot]` の印を与える |
| 型引数 G に対応する `<Root>.Runtime.G` がありません | binder 名を Runtime の型名に合わせるか、`binderOverrides` で対応づける |
| Kotlin 名 X が衝突 / 識別子として不正 | Lean 側で改名する |
| フィクスチャ / 期待値を構成できません | `Repr` / `DecidableEq` の deriving、契約定理の前提が Decidable か、量化変数が生成可能な型か |
| validate 面の契約 | `@[contract]` を外す（execute 面の系） |
| golden が無視された | `<name>-init.json` / `<name>-flow.json` の 2 本組か、トップレベルが `{"ok": …}` か（`cradle golden-check`） |

## 生成ログ note のトリアージ

| note | 意味 | 戻り先 |
|---|---|---|
| golden … 無視 | 命名か形が規約と違う | golden を採り直す |
| View→Row の壁 / View→ドメイン語彙の壁 | View が Row やふるまい持ちの VO を運んでいる | View 自身の語彙を導入（Lean） |
| 署名を写像できない | 契約面に写像できない型（関数・依存型・`Int` など） | 型の語彙を見直す（Lean） |
| 契約定理を翻訳できません | 前提が Decidable でない・fixture から期待値を計算できない | 定理の形を見直す（Lean） |
| 参照系 … 読み飛ばし | execute 面でない定理に `@[contract]` | 指名を外す（Lean） |
| interface のみ生成（テストなし） | fixture / golden が無い | fixture か golden を足す |
