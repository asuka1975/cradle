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

// 外部能力の Port を持つ最小ドメイン「ロビーの来訪受付」（lean/）。golden は持たない（CLI を持たない回帰素材）
lean2kotlin {
	kotlinPackage = "dev.cradle.lobby"
	leanRootNamespace = "Lobby"
	leanExtractorDir = lean2kotlinHome.resolve("lean")
	leanDomainDir = layout.projectDirectory.dir("lean")
	// BookVisitUseCase は来訪の泉の生成器状態を型引数 G で、StartPaymentUseCase は決済の試みの泉を P で受ける
	binderOverrides.put("G", "Lobby.Application.VisitIdGeneratorState")
	binderOverrides.put("P", "Lobby.Application.PaymentAttemptIdGeneratorState")
}
