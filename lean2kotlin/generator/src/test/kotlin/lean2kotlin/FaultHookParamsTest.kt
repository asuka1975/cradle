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
 * 障害契約のフックは execute が同名で 2 度受ける主体・時計を重ねて宣言しない — Lean は同名の binder を重ねて
 * 書けるが、Kotlin は同名の仮引数を重ねられない(遷移契約のフックと同じく、主体は名前ごと、時計は Clock の
 * フィールドごとに 1 つ)。素材は Mini の LendBookUseCase の execute に同名の `actor` / `clock` をもう 1 つ
 * 足したもの(ケースの args は名前ごとに 1 つ)。
 */
class FaultHookParamsTest {

	private val miniJson = Json.parseToJsonElement(testResources.resolve("mini/ir.json").readText()).jsonObject

	private fun JsonObject.mapArray(key: String, f: (JsonObject) -> JsonObject) =
		JsonObject(this + mapOf(key to JsonArray(getValue(key).jsonArray.map { f(it.jsonObject) })))

	private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content

	/** LendBookUseCase の execute の `c` の後に param を足した IR から生成した障害契約テストの本文。 */
	private fun faultTest(param: String, out: Path): String {
		val extra = Json.parseToJsonElement(param)
		val ir = miniJson.mapArray("useCases") { s ->
			if (s.str("name") != "LendBookUseCase") s
			else s.mapArray("methods") { m ->
				if (m.str("name") != "execute") m
				else JsonObject(m + mapOf("params" to JsonArray(m.getValue("params").jsonArray.flatMap {
					if (it.jsonObject.str("name") == "c") listOf(it, extra) else listOf(it)
				})))
			}
		}
		val parsed = Ir.parse(ir.toString())
		EmitTests(parsed, Kotlinize(parsed), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"),
			Golden.load(testResources.resolve("mini/golden")).snapshots) {}.emitAll()
		return out.resolve("application/usecase/lendbookusecase/LendBookUseCaseFaultContractTest.kt").readText()
	}

	/** フックは主体と today を 1 つずつ宣言し、どの呼び出しも主体と日を 1 つずつ渡す。 */
	private fun assertSingleActorAndClock(test: String) {
		assertTrue("\tprotected abstract fun faultedSavingFailed(bookRepository: BookRepository, actor: ActorContext, " +
			"today: java.time.LocalDate): LendBookUseCase\n" in test, test)
		val calls = test.lines().filter { it.startsWith("\t\tval useCase = faultedSavingFailed(") }
		assertEquals(2, calls.size, calls.joinToString("\n"))
		assertTrue(calls.all { it.split("ActorContext(").size == 2 && it.split("java.time.LocalDate.").size == 2 },
			calls.joinToString("\n"))
	}

	@Test
	fun `execute が同名の主体を 2 つ受けても、障害契約のフックは主体を 1 回だけ受ける`(@TempDir out: Path) {
		assertSingleActorAndClock(faultTest("""{"name":"actor","type":{"name":"Mini.Application.ActorContext","k":"ref"}}""", out))
	}

	@Test
	fun `execute が同名の時計を 2 つ受けても、障害契約のフックは today を 1 回だけ受ける`(@TempDir out: Path) {
		assertSingleActorAndClock(faultTest("""{"name":"clock","type":{"name":"Mini.Application.Clock","k":"ref"}}""", out))
	}
}
