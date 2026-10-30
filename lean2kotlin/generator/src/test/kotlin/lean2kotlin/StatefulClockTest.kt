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
import kotlin.test.assertTrue

/**
 * 更新系の契約テストは時計を Clock のフィールドごとに 1 回だけ配線する — validate と execute が時計を別の名前
 * (`_clock` と `clock`)で受けても実装フックの仮引数は 1 つで、各ケースの値はそのケースのメソッドの引数から取る。
 * 素材は Mini の LendBookUseCase の validate に `_clock` を足し、validate_ok のケースに execute のケースと違う日を運ばせたもの。
 */
class StatefulClockTest {

	private val miniJson = Json.parseToJsonElement(testResources.resolve("mini/ir.json").readText()).jsonObject

	private fun JsonObject.mapArray(key: String, f: (JsonObject) -> JsonObject) =
		JsonObject(this + mapOf(key to JsonArray(getValue(key).jsonArray.map { f(it.jsonObject) })))

	private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content

	@Test
	fun `validate と execute が時計を別の名前で受けても、フックは時計のフィールドを 1 回だけ受け、値はケースのメソッドの引数から取る`(@TempDir out: Path) {
		val clockParam = Json.parseToJsonElement("""{"name":"_clock","type":{"name":"Mini.Application.Clock","k":"ref"}}""")
		val clockArg = Json.parseToJsonElement("""{"today":"2031-01-02"}""")
		val ir = miniJson
			.mapArray("useCases") { s ->
				if (s.str("name") != "LendBookUseCase") s
				else s.mapArray("methods") { m ->
					if (m.str("name") != "validate") m
					else JsonObject(m + mapOf("params" to JsonArray(m.getValue("params").jsonArray + clockParam)))
				}
			}
			.mapArray("contracts") { c ->
				if (c.str("useCase") != "LendBookUseCase" || c.str("method") != "validate") c
				else c.mapArray("cases") { case ->
					JsonObject(case + mapOf("args" to JsonObject(case.getValue("args").jsonObject + ("_clock" to clockArg))))
				}
			}
		val parsed = Ir.parse(ir.toString())
		EmitTests(parsed, Kotlinize(parsed), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"),
			Golden.load(testResources.resolve("mini/golden")).snapshots) {}.emitAll()
		val test = out.resolve("application/usecase/lendbookusecase/LendBookUseCaseContractTest.kt").readText()
		assertTrue("時計は固定の today を配線する(Clock ポート)" in test, test)
		assertTrue("\tprotected abstract fun useCase(bookRepository: BookRepository, actor: ActorContext, `_actor`: ActorContext, " +
			"today: java.time.LocalDate): LendBookUseCase\n" in test, test)
		// どの呼び出しも日を 1 つだけ渡し、validate のケースは _clock の日、execute のケースは clock の日
		val calls = test.lines().filter { it.startsWith("\t\tval useCase = useCase(") }
		assertEquals(17, calls.size, calls.joinToString("\n"))
		assertTrue(calls.all { it.split("java.time.LocalDate.").size == 2 }, calls.joinToString("\n"))
		assertEquals(4, calls.count { it.endsWith(", java.time.LocalDate.parse(\"2031-01-02\"))") }, calls.joinToString("\n"))
		assertEquals(13, calls.count { Regex(""", java\.time\.LocalDate\.parse\("2024-10-0[45]"\)\)$""").containsMatchIn(it) }, calls.joinToString("\n"))
	}
}
