plugins {
	kotlin("jvm") version "2.3.21"
	`java-gradle-plugin`
}

group = "dev.lean2kotlin"
version = "0.1.3"

repositories {
	mavenCentral()
}

dependencies {
	// IR(JSON) のパースに JsonElement API のみ使う(@Serializable のコード生成は不要)
	implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
	testImplementation(kotlin("test"))
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
	jvmToolchain(21)
}

gradlePlugin {
	plugins {
		create("lean2kotlin") {
			id = "dev.lean2kotlin"
			implementationClass = "lean2kotlin.gradle.Lean2KotlinPlugin"
			displayName = "lean2kotlin"
			description = "Lean ドメインモデルから Kotlin(型・interface・golden 契約テスト)を生成する"
		}
	}
}

tasks.test {
	useJUnitPlatform()
	// GenerationTest / LobbyGenerationTest が突き合わせる生成物のスナップショット — 変われば再実行する
	inputs.dir("../scaffold-check/src/generated").withPathSensitivity(PathSensitivity.RELATIVE)
	inputs.dir("../scaffold-check/port/src/generated").withPathSensitivity(PathSensitivity.RELATIVE)
}
