pluginManagement {
	// 骨格の検査: 生成器はこのリポジトリの lean2kotlin/（settings の 1 つ上）。別の checkout を試すときだけ LEAN2KOTLIN_HOME で上書きする
	val lean2kotlinHome: File =
		System.getenv("LEAN2KOTLIN_HOME")?.let { settingsDir.resolve(it).normalize() }
			?: settingsDir.resolve("..").normalize()
	require(lean2kotlinHome.resolve("generator/settings.gradle.kts").isFile && lean2kotlinHome.resolve("lean/lakefile.toml").isFile) { "lean2kotlin の置き場が不正（generator/ と lean/ が無い）: $lean2kotlinHome" }
	gradle.extra["lean2kotlinHome"] = lean2kotlinHome
	includeBuild(lean2kotlinHome.resolve("generator"))
	repositories { gradlePluginPortal(); mavenCentral() }
}
rootProject.name = "scaffold-check"
// 外部能力の Port を持つ最小ドメイン（port/lean）を同じ経路で通す回帰
include("port")
