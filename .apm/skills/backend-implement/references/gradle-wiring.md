# backend の Gradle 配線（lean2kotlin・OpenAPI・jOOQ・ktlint 独自ルール）

先に `cradle doctor` で lean2kotlin が ok であること。生成器は `apm install` が `apm_modules/<owner>/cradle/lean2kotlin/`（local path で install したときは `<owner>` = `_local`）に配る。別のチェックアウトを使うときだけ `LEAN2KOTLIN_HOME` で場所を上書きする（機械固有パスはコミットしない）。
`init.mjs --backend <package>` が `backend/ktlint-rules/`・`backend/.editorconfig`・`backend/gradle.properties` を敷く。残りは下の断片を `build.gradle.kts` / `settings.gradle.kts` に足す。

## settings.gradle.kts

```kotlin
pluginManagement {
	// lean2kotlin の Gradle plugin を composite build で解決する。pluginManagement は settings の最初のブロックなので解決の式はこの中に書き、
	// build.gradle.kts（leanExtractorDir）には gradle.extra で渡す — 解決の式は 1 度だけ
	val lean2kotlinHome: File =
		System.getenv("LEAN2KOTLIN_HOME")?.let { settingsDir.resolve(it).normalize() }
			?: settingsDir.resolve("../apm_modules").normalize().listFiles()?.sortedBy { it.name }
				?.map { it.resolve("cradle/lean2kotlin") }?.firstOrNull { it.resolve("generator/settings.gradle.kts").isFile }
			?: error("lean2kotlin が見つからない — プロジェクト直下で apm install を実行して apm_modules/<owner>/cradle/lean2kotlin/ を配るか、LEAN2KOTLIN_HOME に generator/ と lean/ を持つ場所を与える")
	require(lean2kotlinHome.resolve("generator/settings.gradle.kts").isFile && lean2kotlinHome.resolve("lean/lakefile.toml").isFile) { "lean2kotlin の置き場が不正（generator/ と lean/ が無い）: $lean2kotlinHome" }
	gradle.extra["lean2kotlinHome"] = lean2kotlinHome
	includeBuild(lean2kotlinHome.resolve("generator"))
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

// 生成された契約テスト（PBT）が kotest の PropTestConfig を使う
tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
	compilerOptions.optIn.add("io.kotest.common.ExperimentalKotest")
}

// settings.gradle.kts が解決した lean2kotlin の置き場
val lean2kotlinHome: File by gradle.extra

lean2kotlin {
	kotlinPackage = "<package>.domain"   // 生成器がこの下に domain.entity / application.usecase … を切る
	goldenDir = file("../lean/golden")
	leanRootNamespace = "<Root>"
	leanExtractorDir = lean2kotlinHome.resolve("lean")
	leanDomainDir = file("../lean")
	// 型引数の binder が <Root>.Runtime.<binder> で解決できないものを上書きする。骨格の PostNoteUseCase は泉の生成器状態を型引数 G で受けるので、骨格のままでもこの 1 行が要る
	binderOverrides.put("G", "<Root>.Application.NoteIdGeneratorState")
}

// OpenAPI: documents/codebase/openapi.yaml → Controller interface（interfaceOnly + skipDefaultInterface）と Request/Response
// jOOQ: src/main/resources/db/schema.sql → build/generated/jooq（DDLDatabase）
// どちらも compileKotlin が依存し、出力は git 管理外。
```

`compileKotlin` は毎回 `extractLeanIr`（`lake build`）に依存する。Lean を触らないタスクで IR が既にあるなら `-x extractLeanIr` で飛ばしてよい。
抽出器は対象ドメインの `lean-toolchain` でビルドされる（`apm_modules/…/lean2kotlin/lean/.lake` に落ちる。`apm install` のたびに作り直し）。
CI では `apm_modules/` が無いので、`./gradlew build` の前に `apm install --frozen` を走らせる。

## 生成器の既知の癖

- 参照系で execute 面でない定理に `@[contract]` を付けると note「参照系の検証面ではないため読み飛ばし」が出て、そのファミリは生成されない → モデル側で指名を外す。
- 印だけの主体（フィールド 0 の `@[actorContext]`）は作らない（`cradle lean-check` が止める）。
- Runtime 在住の参照専用 ID VO は `runtime` パッケージに出る → 同一性の VO は Entity の持ち物にするか、`Domain/ValueObject.lean` に置く。
- golden は `<name>-init.json` / `<name>-flow.json` の 2 本組でなければ無視される（note が出る）。note は失敗として読む。

## 抽出が失敗したとき（多くは Lean 側を直す）

| エラー | 対処 |
|---|---|
| 型 X に区分がありません | 置き場（Domain/ValueObject・Domain/Entity）か `@[valueObject]` / `@[aggregateRoot]` の印を与える |
| 型引数 G に対応する `<Root>.Runtime.G` がありません | binder 名を Runtime の型名に合わせるか、`binderOverrides` で対応づける |
| Kotlin 名 X が衝突 / 識別子として不正 | Lean 側で改名する |
| フィクスチャ / 期待値を構成できません | `Repr` / `DecidableEq` の deriving、契約定理の前提が Decidable か、量化変数が生成可能な型か |
| 参照系の execute 面でない定理の契約 | `@[contract]` を外す（execute 面の系） |
| golden が無視された | `<name>-init.json` / `<name>-flow.json` の 2 本組か、トップレベルが `{"ok": …}` か（`cradle golden-check`） |
| `Key <field> is missing in the map` | 読み取りの golden 回帰テストで、Row のフィールドが状態の要素に無い。同梱の生成器は合成できない Row を入れ子まで note で飛ばす（この例外は古い生成器の文言） |
| `<型>.<field>: JSON に無い` | fixture・入力リテラルの経路で JSON に無いフィールド → golden か fixture を採り直す |

## 生成ログ note のトリアージ

| note | 意味 | 戻り先 |
|---|---|---|
| golden … 無視 | 命名か形が規約と違う | golden を採り直す |
| View→Row の壁 / View→ドメイン語彙の壁 | View が Row やふるまい持ちの VO を運んでいる | View 自身の語彙を導入（Lean） |
| 署名を写像できない | 契約面に写像できない型（関数・依存型・`Int` など） | 型の語彙を見直す（Lean） |
| 契約定理を翻訳できません | 前提が Decidable でない・fixture から期待値を計算できない | 定理の形を見直す（Lean） |
| … は読める制約の形ではない | `<Root>RepositoryState` の Prop フィールドが `(coll.map (·.f)).Nodup` / `(coll.filterMap (·.f)).Nodup` / `∀ x ∈ coll, x.f = c` / `(coll.filter p).length ≤ n`（lean-conventions §9）でない | 制約をその形に書き直す（Lean）。書けない制約は fixture が満たすとは限らない |
| 参照系 … 読み飛ばし | execute 面でない定理に `@[contract]` | 指名を外す（Lean） |
| interface のみ生成（テストなし） | fixture / golden が無い | fixture か golden を足す |
| … の要素に無いフィールド … 合成できません | 計算する読み取りモデル（集約横断の集計・別集約からの引き） | 無し（読み取りの回帰は `cradle golden-check` と E2E が担う） |
