package lean2kotlin

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
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

/**
 * 参照系の契約テストは、期待値(成功側の View・エラー)か入力が interface 化された語彙へ届くとケースを生成しない —
 * Runner の note(該当の参照系ケースは生成されない)のとおりに golden 回帰も定理由来のケースも出さず、note で明示する。
 * 素材は Mini の ShelfUseCase(成功側の BookView は壁に触れない)の型を差し替えたもの。
 */
class ReadWallTest {

	private val miniJson = Json.parseToJsonElement(testResources.resolve("mini/ir.json").readText()).jsonObject

	private fun withType(lean: String, type: String, base: JsonObject = miniJson): JsonObject =
		JsonObject(base + mapOf("types" to JsonArray(base.getValue("types").jsonArray.map {
			if (it.jsonObject.getValue("lean").jsonPrimitive.content == lean) Json.parseToJsonElement(type) else it
		})))

	/** ShelfUseCase の契約テストの本文と、生成の note のうち ShelfUseCase のもの。 */
	private fun emitShelf(ir: JsonObject, out: Path, snapshots: List<GoldenSnapshot>): Pair<String, List<String>> {
		val lines = mutableListOf<String>()
		val parsed = Ir.parse(ir.toString())
		EmitTests(parsed, Kotlinize(parsed), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), snapshots) { lines += it }.emitAll()
		return out.resolve("application/usecase/shelfusecase/ShelfUseCaseContractTest.kt").readText() to
			lines.filter { "ShelfUseCase" in it }
	}

	@Test
	fun `エラーが interface 化された語彙を運ぶ参照系は golden のケースを出さない`(@TempDir out: Path) {
		// 参照系の失敗に題(ふるまい持ちの VO)を運ばせる — 壁が無ければ golden basic-init の 1 ケースが出る
		val ir = withType("Mini.Application.QueryError", """{"lean":"Mini.Application.QueryError","kotlin":"QueryError","role":"error","module":"Mini.Application.View",
			"shape":{"kind":"sealed","ctors":[{"name":"unavailable","fields":[{"name":"title","type":{"k":"ref","name":"Mini.Title"}}]}]}}""")
		val (test, notes) = emitShelf(ir, out, Golden.load(testResources.resolve("mini/golden")).snapshots)
		assertFalse("@Test" in test, test)
		assertEquals(listOf(
			"  note: ShelfUseCase: View→ドメイン語彙の壁の破れ(期待値が interface 化された語彙を運ぶ)— 参照系ケースは生成できません(モデル側の是正待ち)",
			"  note: 契約テスト: ShelfUseCase — golden+定理で 0 ケース(参照系)",
		), notes)
	}

	@Test
	fun `入力が interface 化された語彙を運ぶ参照系は定理由来のケースを出さず、入力の名前を note に出す`(@TempDir out: Path) {
		// 問い合わせに題を運ばせ、その問い合わせを渡す値形の定理を 1 本足す — 壁が無ければ q を組んだケースが出る
		val withQuery = withType("Mini.Application.ShelfUseCase.Query", """{"lean":"Mini.Application.ShelfUseCase.Query","kotlin":"ShelfQuery","role":"viewDto","module":"Mini.Application.UseCase.ShelfUseCase.QueryService",
			"shape":{"kind":"structure","fields":[{"name":"title","type":{"k":"ref","name":"Mini.Title"}}]}}""")
		val contract: JsonElement = Json.parseToJsonElement("""{"target":"usecase","useCase":"ShelfUseCase","method":"execute","theorem":"execute_titled","doc":"",
			"cases":[{"kind":"value","args":{"q":{"title":{"text":"羅生門"}}},"readModelType":"Mini.Application.ShelfUseCase.ReadModel","readModel":{"books":[]},"ok":[]}]}""")
		val ir = JsonObject(withQuery + mapOf("contracts" to JsonArray(withQuery.getValue("contracts").jsonArray + contract)))
		val (test, notes) = emitShelf(ir, out, emptyList())
		assertFalse("@Test" in test, test)
		assertEquals(listOf(
			"  note: ShelfUseCase: View→ドメイン語彙の壁の破れ(入力 q が interface 化された語彙を運ぶ)— 参照系ケースは生成できません(モデル側の是正待ち)",
			"  note: 契約テスト: ShelfUseCase — golden+定理で 0 ケース(参照系)",
		), notes)
	}
}
