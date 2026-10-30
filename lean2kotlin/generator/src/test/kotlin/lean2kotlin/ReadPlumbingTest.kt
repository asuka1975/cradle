package lean2kotlin

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 参照系の契約テストは配管を役割ごとに配線する — 主体は丸ごと、ReadModel はフィールドに展開、時計は Clock の
 * フィールドごと。それ以外の配管(State・外部能力の観測・precise な入力)は ReadModel として展開せず、note して
 * ケースを生成しない。素材は Mini の IR を差し替えたもの(時計を受ける LoansUseCase の素の生成は MiniGenerationTest)。
 */
class ReadPlumbingTest {

	private val miniJson = Json.parseToJsonElement(testResources.resolve("mini/ir.json").readText()).jsonObject

	private fun JsonObject.mapArray(key: String, f: (JsonObject) -> JsonObject) =
		JsonObject(this + mapOf(key to JsonArray(getValue(key).jsonArray.map { f(it.jsonObject) })))

	private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content

	/** useCase の契約テストの本文と、生成の note のうち useCase のもの。 */
	private fun emit(ir: JsonObject, out: Path, useCase: String, pkg: String): Pair<String, List<String>> {
		val lines = mutableListOf<String>()
		val parsed = Ir.parse(ir.toString())
		EmitTests(parsed, Kotlinize(parsed), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"),
			Golden.load(testResources.resolve("mini/golden")).snapshots) { lines += it }.emitAll()
		return out.resolve("application/usecase/$pkg/${useCase}ContractTest.kt").readText() to
			lines.filter { useCase in it }
	}

	@Test
	fun `State・外部能力の観測・precise な入力を受ける参照系は、配線できない引数ごとに note してケースを出さない`(@TempDir out: Path) {
		// 外部能力の観測は sealed — ReadModel として展開すると構造体の形を仮定して落ちる
		val outcome = Json.parseToJsonElement("""{"lean":"Mini.Application.Port.Stock.Count.Outcome","kotlin":"StockCountOutcome","role":"portOutcome","module":"Mini.Application.Port.Stock.Count",
			"shape":{"kind":"sealed","ctors":[{"name":"counted","fields":[{"name":"n","type":{"k":"nat"}}]},{"name":"unavailable","fields":[]}]}}""")
		val extra = Json.parseToJsonElement("""[{"name":"before","type":{"k":"ref","name":"Mini.Application.BookRepositoryState"}},
			{"name":"outcome","type":{"k":"ref","name":"Mini.Application.Port.Stock.Count.Outcome"}},
			{"name":"book","type":{"k":"ref","name":"Mini.Runtime.BookId"}}]""").jsonArray
		val ir = JsonObject(miniJson + mapOf("types" to JsonArray(miniJson.getValue("types").jsonArray + outcome)))
			.mapArray("useCases") { s ->
				if (s.str("name") != "ShelfUseCase") s
				else s.mapArray("methods") { m ->
					if (m.str("name") != "execute") m
					else JsonObject(m + mapOf("params" to JsonArray(m.getValue("params").jsonArray + extra)))
				}
			}
		val (test, notes) = emit(ir, out, "ShelfUseCase", "shelfusecase")
		assertTrue("\tprotected abstract fun useCase(books: List<BookRow>): ShelfUseCase\n" in test, test)
		assertFalse("@Test" in test, test)
		assertEquals(listOf(
			"  note: ShelfUseCase.execute: 配線 before(repositoryState)は参照系の契約テストに写せません — 参照系ケースは生成できません",
			"  note: ShelfUseCase.execute: 配線 outcome(portOutcome)は参照系の契約テストに写せません — 参照系ケースは生成できません",
			"  note: ShelfUseCase.execute: 配線 book(precise な入力)は参照系の契約テストに写せません — 参照系ケースは生成できません",
			"  note: 契約テスト: ShelfUseCase — golden+定理で 0 ケース(参照系)",
		), notes)
	}

	@Test
	fun `時計の値がケースに無ければ、時計のフィールドの既定値を配線する`(@TempDir out: Path) {
		// 定理由来の最初のケースから時計の引数を落とす(遷移契約の固定 today と同じ扱い)
		val ir = miniJson.mapArray("contracts") { c ->
			if (c.str("useCase") != "LoansUseCase") c
			else JsonObject(c + mapOf("cases" to JsonArray(c.getValue("cases").jsonArray.take(1).map { case ->
				val o = case.jsonObject
				JsonObject(o + mapOf("args" to JsonObject(o.getValue("args").jsonObject - "clock")))
			})))
		}
		val (test, notes) = emit(ir, out, "LoansUseCase", "loansusecase")
		assertTrue("\tprotected abstract fun useCase(today: java.time.LocalDate, books: List<BookRow>): LoansUseCase\n" in test, test)
		assertTrue("\t\t\tuseCase(java.time.LocalDate.ofEpochDay(0L), listOf<BookRow>(" in test, test)
		assertEquals(listOf(
			"  note: LoansUseCase.execute: 引数を合成できないため basic-init をスキップ",
			"  note: 契約テスト: LoansUseCase — golden+定理で 1 ケース(参照系)",
		), notes)
	}
}
