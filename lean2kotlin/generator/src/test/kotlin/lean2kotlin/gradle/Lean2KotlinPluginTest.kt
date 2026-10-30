package lean2kotlin.gradle

import org.gradle.api.Project
import org.gradle.api.internal.project.ProjectInternal
import org.gradle.testfixtures.ProjectBuilder
import org.junit.jupiter.api.io.TempDir
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
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
	fun `kotlin jvm が無ければ source set adapterTest とタスク adapterContractTest を作らない`(@TempDir dir: File) {
		val p = project(dir)
		(p as ProjectInternal).evaluate()
		assertNull(p.tasks.findByName("adapterContractTest"))
		assertNull(p.extensions.findByName("sourceSets"))
	}
}
