plugins {
	kotlin("jvm")
	// ルール自身も標準ルールで整える(独自ルールは読み込まない — 自分を自分で検査しない)
	id("org.jlleitschuh.gradle.ktlint")
}

description = "Cradle 独自の ktlint ルール(1ファイル1クラス・Bean 定義の作法)"

java {
	toolchain {
		languageVersion = JavaLanguageVersion.of(21)
	}
}

repositories {
	mavenCentral()
}

val ktlintVersion = providers.gradleProperty("ktlintVersion").get()

ktlint {
	version = ktlintVersion
}

tasks.withType<org.jlleitschuh.gradle.ktlint.tasks.BaseKtLintCheckTask>().configureEach {
	// ルート側と同じ理由(削除したファイルの違反が中間結果に残る)で増分実行を切る。
	outputs.upToDateWhen { false }
}

dependencies {
	// ktlint 本体は実行時に ktlint 側のクラスパスから供給される。
	// implementation にすると二重にロードされてバージョンが衝突するので compileOnly。
	compileOnly("com.pinterest.ktlint:ktlint-cli-ruleset-core:$ktlintVersion")
	compileOnly("com.pinterest.ktlint:ktlint-rule-engine-core:$ktlintVersion")

	// ルール自身のテスト。ktlint-test が JUnit5 + AssertJ を持ち込む。
	// compileOnly はテストに引き継がれないので、テストでは明示的に依存する
	// (cli-ruleset-core は CradleRuleSetProvider の登録漏れ検出テストが参照する)。
	testImplementation("com.pinterest.ktlint:ktlint-cli-ruleset-core:$ktlintVersion")
	testImplementation("com.pinterest.ktlint:ktlint-rule-engine-core:$ktlintVersion")
	testImplementation("com.pinterest.ktlint:ktlint-test:$ktlintVersion")
	// ktlint 本体が slf4j 経由でログを出す。バインディングが無いと初期化に失敗する。
	testRuntimeOnly("org.slf4j:slf4j-simple:2.0.17")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
	useJUnitPlatform()
}
