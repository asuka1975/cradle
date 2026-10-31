package lean2kotlin

import kotlinx.serialization.json.*
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.name
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertTrue

/** Lean の doc を写した KDoc の形を、doc を書き換えた IR の生成物で観測する。 */
class KdocTest {

	/** KDoc を閉じる並びと入れ子のコメントを開く並びを含む文と、kdocSafe で崩した形。 */
	private val delimited = "置き場は Port/*/ の下"
	private val broken = "置き場は Port/ * / の下"

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

	/** IR の JSON で、すべての doc の頭と型の制約(invariants)の Lean 式の末尾に delimited を足す。 */
	private fun withDelimited(j: JsonElement, inInvariants: Boolean = false): JsonElement = when (j) {
		is JsonObject -> JsonObject(j.mapValues { (key, v) ->
			when {
				key == "doc" && v is JsonPrimitive && v.isString -> JsonPrimitive("$delimited ${v.content}")
				inInvariants && key == "lean" -> JsonPrimitive("${v.jsonPrimitive.content} $delimited")
				else -> withDelimited(v, key == "invariants")
			}
		})
		is JsonArray -> JsonArray(j.map { withDelimited(it, inInvariants) })
		else -> j
	}

	@Test
	fun `doc と型の制約の Lean 式に KDoc の区切りがあっても、生成物の KDoc は途中で閉じず入れ子も開かない`(@TempDir out: Path) {
		val fixtures = listOf("sprout" to "sprout/sprout-ir.json", "lobby" to "lobby/lobby-ir.json", "mini" to "mini/ir.json")
		val texts = fixtures.flatMap { (name, irPath) ->
			val ir = Ir.parse(withDelimited(Json.parseToJsonElement(testResources.resolve(irPath).readText())).toString())
			val dir = out.resolve(name)
			Lean2KotlinGeneration.generate(ir, Golden.load(testResources.resolve("$name/golden")), name,
				dir.resolve("main"), dir.resolve("test"), dir.resolve("adapterTest"), "\t") {}
			Files.walk(dir).use { s -> s.filter { it.name.endsWith(".kt") }.toList() }.map { it.readText() }
		}
		val raw = texts.flatMap { it.lines() }.filter { delimited in it }
		assertTrue(raw.isEmpty(), raw.take(5).joinToString("\n"))
		for (sink in listOf(
			"(actorPort — 操作の主体の調達ポート)。\n * $broken",  // 主体ポートの doc 全文
			"(命名規約 `<X>State ↔ <X>`)。\n * $broken",  // 泉の doc 全文
			" * - nonneg: `0 ≤ value $broken`",  // 型の制約
			"\t/**\n\t * $broken",  // validate の KDoc の頭
			"\t/** $broken",  // メンバ・テストの 1 行 KDoc
		)) assertTrue(texts.any { sink in it }, sink)
	}
}
