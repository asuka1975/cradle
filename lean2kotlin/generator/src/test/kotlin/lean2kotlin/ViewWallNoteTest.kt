package lean2kotlin

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * View の壁の破れ(View→Row・View→ドメイン語彙)は生成を止めない note: Row の壁は View だけ、
 * ドメイン語彙の壁は View とエラーを見て、壁ごとに IR の型の順で、同じ参照は 1 度だけ出す。
 */
class ViewWallNoteTest {

	@Test
	fun `View の壁の破れは Row の壁を先に、型の順で、参照ごとに 1 度だけ note に出る`(@TempDir out: Path) {
		val base = Json.parseToJsonElement(testResources.resolve("unique-name/ir.json").readText()).jsonObject
		val row = Json.parseToJsonElement("""{"lean":"Mini.Application.RoomRow","kotlin":"RoomRow","role":"readModelRow","module":"Mini.Application.ReadModel",
			"shape":{"kind":"structure","fields":[{"name":"name","type":{"k":"string"}}]}}""")
		// エラーが Row を運んでも Row の壁の対象ではない
		val error = Json.parseToJsonElement("""{"lean":"Mini.Application.LookupError","kotlin":"LookupError","role":"error","module":"Mini.Application.Error",
			"shape":{"kind":"sealed","ctors":[{"name":"missing","fields":[{"name":"room","type":{"k":"ref","name":"Mini.Domain.Room"}}]},
			{"name":"stale","fields":[{"name":"row","type":{"k":"ref","name":"Mini.Application.RoomRow"}}]}]}}""")
		val view = Json.parseToJsonElement("""{"lean":"Mini.Application.RoomView","kotlin":"RoomView","role":"viewDto","module":"Mini.Application.View",
			"shape":{"kind":"structure","fields":[{"name":"row","type":{"k":"ref","name":"Mini.Application.RoomRow"}},
			{"name":"rows","type":{"k":"list","of":{"k":"ref","name":"Mini.Application.RoomRow"}}},
			{"name":"room","type":{"k":"ref","name":"Mini.Domain.Room"}},
			{"name":"previous","type":{"k":"option","of":{"k":"ref","name":"Mini.Domain.Room"}}}]}}""")
		val ir = JsonObject(base + mapOf("types" to JsonArray(base.getValue("types").jsonArray + row + error + view)))
		val lines = mutableListOf<String>()
		Lean2KotlinGeneration.generate(Ir.parse(ir.toString()), GoldenLoad(emptyList(), emptyList()), "t",
			out.resolve("main"), out.resolve("test"), out.resolve("adapter-test"), "\t") { lines += it }
		assertEquals(listOf(
			"note: View→Row の壁の破れ: Mini.Application.RoomView が Row(Mini.Application.RoomRow)を運んでいます — " +
				"View の語彙は View 自身が持つべきです(Lean の View 定義側の是正が必要)",
			"note: View→ドメイン語彙の壁の破れ: Mini.Application.LookupError が interface 化された語彙(Mini.Domain.Room 経由)を運んでいます — " +
				"期待値の比較が成立しないため該当の参照系ケースは生成されません(モデル側で View 自身の語彙を導入してください)",
			"note: View→ドメイン語彙の壁の破れ: Mini.Application.RoomView が interface 化された語彙(Mini.Domain.Room 経由)を運んでいます — " +
				"期待値の比較が成立しないため該当の参照系ケースは生成されません(モデル側で View 自身の語彙を導入してください)",
		), lines.filter { it.startsWith("note: View→") })
	}
}
