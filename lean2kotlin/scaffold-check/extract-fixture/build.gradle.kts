plugins {
	id("dev.lean2kotlin")
}

val lean2kotlinHome: File by gradle.extra

// 抽出だけの回帰素材「倉庫の注文」（lean/）。IR は diagnostics.dropped を持つ — 生成器は 1 件でも失敗にするので
// 生成には通さず、抽出した IR を expected-ir.json と突き合わせる。kotlin-jvm を当てないのでコンパイルへの配線も無い
lean2kotlin {
	leanRootNamespace = "Depot"
	leanExtractorDir = lean2kotlinHome.resolve("lean")
	leanDomainDir = layout.projectDirectory.dir("lean")
}

// 根からまとめて generateKotlinFromLean を回しても、この IR は生成に渡さない
tasks.named("generateKotlinFromLean") { enabled = false }
