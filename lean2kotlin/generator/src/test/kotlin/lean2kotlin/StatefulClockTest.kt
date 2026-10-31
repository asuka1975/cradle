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
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * 更新系の契約テストは時計をフィールドの名前ごとに 1 回だけ配線する — validate と execute が時計を別の名前
 * (`_clock` と `clock`)や別の型で受けても実装フックの仮引数は 1 つで、各ケースの値はそのケースのメソッドの引数から取る。
 * 素材は Mini の LendBookUseCase の validate に時計の引数を足し、validate_ok のケースに execute のケースと違う日を運ばせたもの。
 */
class StatefulClockTest {

	private val miniJson = Json.parseToJsonElement(testResources.resolve("mini/ir.json").readText()).jsonObject

	private fun JsonObject.mapArray(key: String, f: (JsonObject) -> JsonObject) =
		JsonObject(this + mapOf(key to JsonArray(getValue(key).jsonArray.map { f(it.jsonObject) })))

	private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content

	/** Mini の validate に時計の引数を足し、validate_ok のケースにその日を運ばせたもの。 */
	private fun miniWithValidateClock(params: List<Pair<String, String>>, types: List<String> = emptyList()): Ir {
		val clockArg = Json.parseToJsonElement("""{"today":"2031-01-02"}""")
		val ir = miniJson
			.mapArray("useCases") { s ->
				if (s.str("name") != "LendBookUseCase") s
				else s.mapArray("methods") { m ->
					if (m.str("name") != "validate") m
					else JsonObject(m + mapOf("params" to JsonArray(m.getValue("params").jsonArray + params.map { (name, type) ->
						Json.parseToJsonElement("""{"name":"$name","type":{"name":"$type","k":"ref"}}""")
					})))
				}
			}
			.mapArray("contracts") { c ->
				if (c.str("useCase") != "LendBookUseCase" || c.str("method") != "validate") c
				else c.mapArray("cases") { case ->
					JsonObject(case + mapOf("args" to JsonObject(case.getValue("args").jsonObject + params.map { (name, _) -> name to clockArg })))
				}
			}
		return Ir.parse(JsonObject(ir + ("types" to JsonArray(ir.getValue("types").jsonArray + types.map(Json::parseToJsonElement)))).toString())
	}

	private fun clockType(name: String, fieldType: String = "date") =
		"""{"shape":{"kind":"structure","fields":[{"type":{"k":"$fieldType"},"name":"today"}]},"role":"clockPort","module":"Mini.Application.$name","lean":"Mini.Application.$name","kotlin":"$name"}"""

	private fun emit(parsed: Ir, out: Path) =
		EmitTests(parsed, Kotlinize(parsed), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"),
			Golden.load(testResources.resolve("mini/golden")).snapshots) {}.emitAll()

	/** フックの仮引数は today の 1 つで、どの呼び出しも日を 1 つだけ渡す。validate のケースは足した引数の日、execute のケースは clock の日。 */
	private fun assertOneClock(out: Path) {
		val test = out.resolve("application/usecase/lendbookusecase/LendBookUseCaseContractTest.kt").readText()
		assertTrue("時計は固定の today を配線する(Clock ポート)" in test, test)
		assertTrue("\tprotected abstract fun useCase(bookRepository: BookRepository, actor: ActorContext, `_actor`: ActorContext, " +
			"today: java.time.LocalDate): LendBookUseCase\n" in test, test)
		val calls = test.lines().filter { it.startsWith("\t\tval useCase = useCase(") }
		assertEquals(17, calls.size, calls.joinToString("\n"))
		assertTrue(calls.all { it.split("java.time.LocalDate.").size == 2 }, calls.joinToString("\n"))
		assertEquals(4, calls.count { it.endsWith(", java.time.LocalDate.parse(\"2031-01-02\"))") }, calls.joinToString("\n"))
		assertEquals(13, calls.count { Regex(""", java\.time\.LocalDate\.parse\("2024-10-0[45]"\)\)$""").containsMatchIn(it) }, calls.joinToString("\n"))
	}

	private val clock = "Mini.Application.Clock"
	private val validationClock = "Mini.Application.ValidationClock"

	@Test
	fun `validate と execute が時計を別の名前で受けても、フックは時計のフィールドを 1 回だけ受け、値はケースのメソッドの引数から取る`(@TempDir out: Path) {
		emit(miniWithValidateClock(listOf("_clock" to clock)), out)
		assertOneClock(out)
	}

	@Test
	fun `validate と execute が型の違う時計を同じ名前で受けても、同じ名前のフィールドはフックの引数 1 つにまとまる`(@TempDir out: Path) {
		emit(miniWithValidateClock(listOf("clock" to validationClock), listOf(clockType("ValidationClock"))), out)
		assertOneClock(out)
	}

	@Test
	fun `validate と execute が型の違う時計を別の名前で受けても、同じ名前のフィールドはフックの引数 1 つにまとまる`(@TempDir out: Path) {
		emit(miniWithValidateClock(listOf("_vclock" to validationClock), listOf(clockType("ValidationClock"))), out)
		assertOneClock(out)
	}

	@Test
	fun `同じ名前のフィールドの型が時計ごとに違うと、理由を言って止める`(@TempDir out: Path) {
		val parsed = miniWithValidateClock(listOf("_vclock" to validationClock), listOf(clockType("ValidationClock", "datetime")))
		val e = assertFailsWith<IllegalStateException> { emit(parsed, out) }
		assertEquals("LendBookUseCase: 時計のフィールド today の型が時計ごとに違い(java.time.LocalDate・java.time.LocalDateTime)、フックの引数 1 つに写せません", e.message)
	}

	@Test
	fun `1 つのメソッドが型の違う時計で同じ名前のフィールドを受けると、理由を言って止める`(@TempDir out: Path) {
		val parsed = miniWithValidateClock(listOf("_clock" to clock, "_vclock" to validationClock), listOf(clockType("ValidationClock")))
		val e = assertFailsWith<IllegalStateException> { emit(parsed, out) }
		assertEquals("LendBookUseCase.validate: 型の違う時計 _clock・_vclock が同じ名前のフィールド today を持ち、フックの引数 1 つでは値を分けられません", e.message)
	}
}
