plugins {
	kotlin("jvm") version "2.3.21"
	id("dev.lean2kotlin")
}

java {
	toolchain {
		languageVersion = JavaLanguageVersion.of(21)
	}
}

repositories {
	mavenCentral()
}

dependencies {
	testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
	// 生成された契約テスト（PBT）が要求する
	testImplementation("io.kotest:kotest-property:5.9.1")
	testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
}

tasks.test {
	useJUnitPlatform()
}

// 生成された契約テスト（PBT）が kotest の PropTestConfig を使う
tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
	compilerOptions.optIn.add("io.kotest.common.ExperimentalKotest")
}

val lean2kotlinHome: File by gradle.extra

// 骨格（assets/lean）は写して使う — 抽出が作る .lake を assets の下に置かない（init.mjs は assets/lean を丸ごと歩く）
val scaffoldLean = layout.buildDirectory.dir("scaffold/lean")
val syncScaffold by tasks.registering(Sync::class) {
	from("../../.apm/skills/cradle-init/assets/lean") { exclude(".lake/**", "mockup/**") }
	into(scaffoldLean)
	preserve { include(".lake/**") }   // 写し先の lake キャッシュは残す
}
tasks.named("extractLeanIr") { dependsOn(syncScaffold) }

lean2kotlin {
	kotlinPackage = "dev.cradle.scaffold"
	goldenDir = scaffoldLean.map { it.dir("golden") }
	leanRootNamespace = "Sprout"
	leanExtractorDir = lean2kotlinHome.resolve("lean")
	leanDomainDir = scaffoldLean
	// 骨格の PostNoteUseCase は泉の生成器状態を型引数 G で受ける
	binderOverrides.put("G", "Sprout.Application.NoteIdGeneratorState")
}
