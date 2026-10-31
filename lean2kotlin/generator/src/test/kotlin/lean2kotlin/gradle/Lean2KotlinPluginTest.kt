package lean2kotlin.gradle

import org.gradle.api.GradleException
import org.gradle.api.Project
import org.gradle.api.internal.project.ProjectInternal
import org.gradle.api.tasks.SourceSetContainer
import org.gradle.testfixtures.ProjectBuilder
import org.junit.jupiter.api.condition.DisabledOnOs
import org.junit.jupiter.api.condition.OS
import org.junit.jupiter.api.io.TempDir
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// plugin の配線を ProjectBuilder で検査する(lake・Lean・入れ子の Gradle は走らせない)
class Lean2KotlinPluginTest {

	private fun project(dir: File): Project {
		val p = ProjectBuilder.builder().withProjectDir(dir).build()
		p.plugins.apply(Lean2KotlinPlugin::class.java)
		return p
	}

	private fun Project.ext() = extensions.getByType(Lean2KotlinExtension::class.java)

	private fun Project.extract() = tasks.named("extractLeanIr", ExtractLeanIrTask::class.java).get()

	private fun Project.genDependencies(): List<String> {
		val gen = tasks.getByName("generateKotlinFromLean")
		return gen.taskDependencies.getDependencies(gen).map { it.name }
	}

	@Test
	fun `生成と抽出のタスクを lean2kotlin の group に登録する`(@TempDir dir: File) {
		val p = project(dir)
		assertEquals("lean2kotlin", p.tasks.getByName("generateKotlinFromLean").group)
		assertTrue(p.tasks.getByName("generateKotlinFromLean") is GenerateKotlinFromLeanTask)
		assertEquals("lean2kotlin", p.extract().group)
	}

	@Test
	fun `拡張の既定値`(@TempDir dir: File) {
		val p = project(dir)
		val ext = p.ext()
		assertEquals(p.projectDir.resolve("src/generated/kotlin-main"), ext.mainOut.get().asFile)
		assertEquals(p.projectDir.resolve("src/generated/kotlin-test"), ext.testOut.get().asFile)
		assertEquals(p.projectDir.resolve("src/generated/kotlin-adapter-test"), ext.adapterTestOut.get().asFile)
		assertEquals("\t", ext.indent.get())
		assertEquals(true, ext.wireSourceSets.get())
		assertEquals(p.layout.buildDirectory.get().asFile.resolve("lean2kotlin/lean2kotlin-ir.json"), ext.irFile.get().asFile)
		assertFalse(ext.leanRootNamespace.isPresent)
	}

	@Test
	fun `抽出の lakeCommand は既定で lake、利用者が指定すればその値`(@TempDir dir: File) {
		assertEquals("lake", project(dir.resolve("a")).extract().lakeCommand.get())
		val p = project(dir.resolve("b"))
		p.ext().lakeCommand.set("/opt/elan/bin/lake")
		assertEquals("/opt/elan/bin/lake", p.extract().lakeCommand.get())
	}

	@Test
	fun `抽出の up-to-date 入力は両パッケージの lean・lakefile・manifest と対象の lean-toolchain`(@TempDir dir: File) {
		fun touch(root: File, vararg names: String) {
			for (n in names) root.resolve(n).apply { parentFile.mkdirs(); writeText("") }
		}
		val domain = dir.resolve("domain")
		val extractor = dir.resolve("extractor")
		touch(domain, "Sprout.lean", "Sprout/Domain.lean", "lakefile.toml", "lean-toolchain", "lake-manifest.json",
			"README.md", ".lake/build/X.lean", "build/Y.lean")
		touch(extractor, "Lean2Kotlin.lean", "lakefile.toml", "lean-toolchain", "lake-manifest.json", ".lake/build/X.lean")
		val p = project(dir.resolve("p"))
		p.ext().leanDomainDir.set(domain)
		p.ext().leanExtractorDir.set(extractor)
		// 抽出器の lean-toolchain は入れない — ワークスペースは対象の lean-toolchain で抽出器もビルドする
		assertEquals(
			setOf("domain/Sprout.lean", "domain/Sprout/Domain.lean", "domain/lakefile.toml", "domain/lean-toolchain",
				"domain/lake-manifest.json", "extractor/Lean2Kotlin.lean", "extractor/lakefile.toml", "extractor/lake-manifest.json"),
			p.extract().leanSources.files.map { it.relativeTo(dir).invariantSeparatorsPath }.toSet())
	}

	@Test
	@DisabledOnOs(OS.WINDOWS)
	fun `lake update は対象の lean-toolchain を保つ — 依存の版へ上げない`(@TempDir dir: File) {
		val calls = dir.resolve("calls.txt")
		val lake = dir.resolve("lake").apply {
			writeText("#!/bin/sh\necho \"\$*\" >> '$calls'\n[ \"\$1\" = update ] && echo '{}' > lake-manifest.json\nexit 0\n")
			setExecutable(true)
		}
		val domain = dir.resolve("domain").apply { mkdirs() }
		val extractor = dir.resolve("extractor").apply { mkdirs() }
		domain.resolve("lakefile.toml").writeText("name = \"depot-lean\"\n")
		domain.resolve("lean-toolchain").writeText("leanprover/lean4:v4.32.2\n")
		extractor.resolve("lakefile.toml").writeText("name = \"lean2kotlin\"\n")
		val p = project(dir.resolve("p"))
		p.ext().leanRootNamespace.set("Depot")
		p.ext().leanDomainDir.set(domain)
		p.ext().leanExtractorDir.set(extractor)
		p.ext().lakeCommand.set(lake.absolutePath)
		p.ext().irFile.get().asFile.apply { parentFile.mkdirs(); writeText("{}") }
		p.extract().run()
		assertEquals("update --keep-toolchain", calls.readLines().first())
	}

	@Test
	@DisabledOnOs(OS.WINDOWS)
	fun `対象と抽出器の Lean の版が違って lake build が落ちると、両方の版と直し方を言って止める`(@TempDir dir: File) {
		val lake = dir.resolve("lake").apply {
			writeText("#!/bin/sh\n[ \"\$1\" = update ] && echo '{}' > lake-manifest.json\n[ \"\$1\" = build ] && exit 1\nexit 0\n")
			setExecutable(true)
		}
		val domain = dir.resolve("domain").apply { mkdirs() }
		val extractor = dir.resolve("extractor").apply { mkdirs() }
		domain.resolve("lakefile.toml").writeText("name = \"depot-lean\"\n")
		domain.resolve("lean-toolchain").writeText("leanprover/lean4:v4.31.0\n")
		extractor.resolve("lakefile.toml").writeText("name = \"lean2kotlin\"\n")
		extractor.resolve("lean-toolchain").writeText("leanprover/lean4:v4.33.0\n")
		val p = project(dir.resolve("p"))
		p.ext().leanRootNamespace.set("Depot")
		p.ext().leanDomainDir.set(domain)
		p.ext().leanExtractorDir.set(extractor)
		p.ext().lakeCommand.set(lake.absolutePath)
		p.ext().irFile.get().asFile.apply { parentFile.mkdirs(); writeText("{}") }
		val e = assertFailsWith<GradleException> { p.extract().run() }
		assertEquals("lake build が失敗しました。対象の Lean（leanprover/lean4:v4.31.0）は抽出器の Lean（leanprover/lean4:v4.33.0）と違います — 抽出器（Lean2Kotlin/Extract.lean）でエラーが出ているなら、対象の lean-toolchain を上げてください", e.message)
		// 版が同じなら対象の Lean の失敗で、版の話はしない
		domain.resolve("lean-toolchain").writeText("leanprover/lean4:v4.33.0\n")
		assertFalse("抽出器の Lean" in (assertFails { p.extract().run() }.message ?: ""))
	}

	@Test
	@DisabledOnOs(OS.WINDOWS)
	fun `抽出は対象か抽出器の lakefile・manifest が変わったときだけワークスペースの manifest を捨てて lake update で解き直す`(@TempDir dir: File) {
		// lake の代役: サブコマンドを 1 行ずつ記録し、update ならワークスペースに manifest を書く
		val calls = dir.resolve("calls.txt")
		val lake = dir.resolve("lake").apply {
			writeText("#!/bin/sh\necho \"\$1\" >> '$calls'\n[ \"\$1\" = update ] && echo '{}' > lake-manifest.json\nexit 0\n")
			setExecutable(true)
		}
		val domain = dir.resolve("domain").apply { mkdirs() }
		val extractor = dir.resolve("extractor").apply { mkdirs() }
		domain.resolve("lakefile.toml").writeText("name = \"depot-lean\"\n")
		domain.resolve("lean-toolchain").writeText("leanprover/lean4:v4.33.0\n")
		domain.resolve("Depot.lean").writeText("def x := 1\n")
		extractor.resolve("lakefile.toml").writeText("name = \"lean2kotlin\"\n")
		extractor.resolve("lake-manifest.json").writeText("{\"packages\": []}\n")
		val p = project(dir.resolve("p"))
		p.ext().leanRootNamespace.set("Depot")
		p.ext().leanDomainDir.set(domain)
		p.ext().leanExtractorDir.set(extractor)
		p.ext().lakeCommand.set(lake.absolutePath)
		p.ext().irFile.get().asFile.apply { parentFile.mkdirs(); writeText("{}") }
		fun updates(): Boolean {
			calls.delete()
			p.extract().run()
			val subcommands = calls.readLines()
			assertEquals(listOf("build", "env"), subcommands - "update")
			return "update" in subcommands
		}
		assertTrue(updates(), "初回は manifest が無い")
		assertFalse(updates(), "何も変わらなければ解き直さない")
		domain.resolve("Depot.lean").writeText("def x := 2\n")
		domain.resolve("lean-toolchain").writeText("leanprover/lean4:v4.34.0\n")
		assertFalse(updates(), ".lean と lean-toolchain は解決に効かない")
		domain.resolve("lake-manifest.json").writeText("{\"packages\": [{\"name\": \"depb\", \"rev\": \"c1\"}]}\n")
		assertTrue(updates(), "対象の manifest が現れた")
		assertFalse(updates())
		domain.resolve("lake-manifest.json").writeText("{\"packages\": [{\"name\": \"depb\", \"rev\": \"c2\"}]}\n")
		assertTrue(updates(), "対象の固定だけが変わった")
		domain.resolve("lakefile.toml").appendText("\n[[require]]\nname = \"depc\"\npath = \"../depc\"\n")
		assertTrue(updates(), "対象に require が増えた")
		assertFalse(updates())
		extractor.resolve("lake-manifest.json").writeText("{\"packages\": [{\"name\": \"x\"}]}\n")
		assertTrue(updates(), "抽出器の固定が変わった")
		extractor.resolve("lakefile.toml").appendText("version = \"0.2.0\"\n")
		assertTrue(updates(), "抽出器の lakefile が変わった")
		domain.resolve("lake-manifest.json").delete()
		assertTrue(updates(), "対象の manifest が消えた")
		assertFalse(updates())
	}

	@Test
	fun `leanRootNamespace があれば生成は抽出に依存する`(@TempDir dir: File) {
		val p = project(dir)
		p.ext().leanRootNamespace.set("Sprout")
		(p as ProjectInternal).evaluate()
		assertTrue("extractLeanIr" in p.genDependencies(), p.genDependencies().toString())
	}

	@Test
	fun `leanRootNamespace が無ければ生成は抽出に依存しない`(@TempDir dir: File) {
		val p = project(dir)
		(p as ProjectInternal).evaluate()
		assertFalse("extractLeanIr" in p.genDependencies(), p.genDependencies().toString())
	}

	@Test
	fun `JVM の plugin が無ければ sourceSets を持ち込まずタスク adapterContractTest も作らない`(@TempDir dir: File) {
		val p = project(dir)
		(p as ProjectInternal).evaluate()
		assertNull(p.tasks.findByName("adapterContractTest"))
		assertNull(p.extensions.findByName("sourceSets"))
	}

	@Test
	fun `java だけで kotlin jvm が無ければ source set adapterTest とタスク adapterContractTest を作らない`(@TempDir dir: File) {
		val p = project(dir)
		// java で sourceSets はできる — 配線の門が java でなく kotlin jvm であることを見る
		p.plugins.apply("java")
		(p as ProjectInternal).evaluate()
		assertNull(p.extensions.getByType(SourceSetContainer::class.java).findByName("adapterTest"))
		assertNull(p.tasks.findByName("adapterContractTest"))
	}
}
