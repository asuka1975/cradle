package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.name
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertTrue

/** Lean の doc を写した KDoc の形を、doc を書き換えた IR の生成物で観測する。 */
class KdocTest {

	private fun Ir.withTypeDocs(docs: Map<String, String>): Ir =
		Ir(rootNamespace, types.map { td -> docs[td.lean]?.let { td.copy(doc = it) } ?: td },
			queryServices, useCases, domainServices, useCaseRules, contracts, faultContracts, behaviors, ports, dropped)

	/** main 面を生成し、ファイル名 → 本文を返す。 */
	private fun generateMain(ir: Ir, out: Path): Map<String, String> {
		EmitMain(ir, Kotlinize(ir), Output(out.resolve("main"), "sprout", "\t"), Output(out.resolve("test"), "sprout", "\t")) {}.emitAll()
		return Files.walk(out).use { s -> s.filter { it.name.endsWith(".kt") }.toList() }.associate { it.name to it.readText() }
	}

	@Test
	fun `doc の無い主体ポートと段落を分けた泉の doc は行末に空白を残さない KDoc になる`(@TempDir out: Path) {
		val ir = sproutIr().withTypeDocs(mapOf(
			"Sprout.Application.ActorContext" to "",
			"Sprout.Application.NoteIdGeneratorState" to "一段落目。\n\n二段落目。"))
		val files = generateMain(ir, out)
		val actor = files.getValue("ActorContext.kt")
		assertTrue(" * Lean: `Sprout.Application.ActorContext`(actorPort — 操作の主体の調達ポート)。\n *\n *\n" in actor, actor)
		val gen = files.getValue("NoteIdGenerator.kt")
		assertTrue(" * IdGenerator ポート(命名規約 `<X>State ↔ <X>`)。\n * 一段落目。\n *\n * 二段落目。\n *\n" in gen, gen)
		for (text in listOf(actor, gen)) assertTrue(text.lines().none { it.endsWith(" ") }, text)
	}
}
