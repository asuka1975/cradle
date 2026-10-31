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
 * 参照系の契約テストも時計をフィールドの名前ごとに 1 回だけ配線する(遷移契約と同じ) — 1 つのメソッドが時計を 2 つ受けてもフックの仮引数を重ねない。
 * 素材は Mini の LoansUseCase の execute に時計の引数を足したもの。
 */
class ReadClockTest {

	private val miniJson = Json.parseToJsonElement(testResources.resolve("mini/ir.json").readText()).jsonObject

	private fun JsonObject.mapArray(key: String, f: (JsonObject) -> JsonObject) =
		JsonObject(this + mapOf(key to JsonArray(getValue(key).jsonArray.map { f(it.jsonObject) })))

	private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content

	private fun miniWithSecondClock(type: String, types: List<String> = emptyList()): Ir {
		val param = Json.parseToJsonElement("""{"name":"clock2","type":{"name":"$type","k":"ref"}}""")
		val ir = miniJson.mapArray("useCases") { s ->
			if (s.str("name") != "LoansUseCase") s
			else s.mapArray("methods") { m ->
				if (m.str("name") != "execute") m
				else JsonObject(m + mapOf("params" to JsonArray(m.getValue("params").jsonArray + param)))
			}
		}
		return Ir.parse(JsonObject(ir + ("types" to JsonArray(ir.getValue("types").jsonArray + types.map(Json::parseToJsonElement)))).toString())
	}

	private fun emit(parsed: Ir, out: Path) =
		EmitTests(parsed, Kotlinize(parsed), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"),
			Golden.load(testResources.resolve("mini/golden")).snapshots) {}.emitAll()

	@Test
	fun `同じ型の時計を 2 つ受けても、フックは時計のフィールドを 1 回だけ受ける`(@TempDir out: Path) {
		emit(miniWithSecondClock("Mini.Application.Clock"), out)
		val test = out.resolve("application/usecase/loansusecase/LoansUseCaseContractTest.kt").readText()
		assertTrue(Regex("""protected abstract fun useCase\(today: java\.time\.LocalDate, [^)]*\): LoansUseCase""").containsMatchIn(test), test)
		assertEquals(1, Regex("""today: java\.time\.LocalDate""").findAll(test).count(), test)
		val calls = test.lines().filter { "useCase(" in it && "abstract" !in it }
		// どの呼び出しも時計の日を 1 つだけ渡し、次は ReadModel の行(Row の lentOn も日付なので、並びで見る)
		assertTrue(calls.isNotEmpty() && calls.all { Regex("""^\s*useCase\(java\.time\.LocalDate\.parse\("[^"]*"\), listOf""").containsMatchIn(it) }, calls.joinToString("\n"))
	}

	@Test
	fun `型の違う時計が同じ名前のフィールドを持つと、理由を言って止める`(@TempDir out: Path) {
		val validation = """{"shape":{"kind":"structure","fields":[{"type":{"k":"date"},"name":"today"}]},"role":"clockPort","module":"Mini.Application.ValidationClock","lean":"Mini.Application.ValidationClock","kotlin":"ValidationClock"}"""
		val e = assertFailsWith<IllegalStateException> { emit(miniWithSecondClock("Mini.Application.ValidationClock", listOf(validation)), out) }
		assertEquals("LoansUseCase.execute: 型の違う時計 clock・clock2 が同じ名前のフィールド today を持ち、フックの引数 1 つでは値を分けられません", e.message)
	}
}
