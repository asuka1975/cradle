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

/**
 * fixture のパラメータの既定値: entity-like の fixture は既定値のあるフィールドに既定値を付け、橋渡し型の fixture は付けない。
 * 素材は Mini の題(ふるまい持ちの VO)と版(題を運ぶ橋渡し型)のフィールドに既定値を足したもの。
 */
class FixtureDefaultTest {

	private val miniJson = Json.parseToJsonElement(testResources.resolve("mini/ir.json").readText()).jsonObject

	private fun withTypes(types: Map<String, String>): JsonObject =
		JsonObject(miniJson + mapOf("types" to JsonArray(miniJson.getValue("types").jsonArray.map {
			types[it.jsonObject.getValue("lean").jsonPrimitive.content]?.let(Json::parseToJsonElement) ?: it
		})))

	@Test
	fun `entity-like の fixture は既定値のあるフィールドに既定値を付け、橋渡し型の fixture は付けない`(@TempDir out: Path) {
		val ir = Ir.parse(withTypes(mapOf(
			"Mini.Title" to """{"lean":"Mini.Title","kotlin":"Title","role":"valueObject","module":"Mini.Domain.ValueObject","doc":"",
				"shape":{"kind":"structure","fields":[{"name":"text","type":{"k":"withDefault","of":{"k":"string"},"default":"無題"}}]}}""",
			"Mini.Edition" to """{"lean":"Mini.Edition","kotlin":"Edition","role":"valueObject","module":"Mini.Domain.ValueObject","doc":"",
				"shape":{"kind":"structure","fields":[{"name":"title","type":{"k":"ref","name":"Mini.Title"}},
					{"name":"number","type":{"k":"withDefault","of":{"k":"nat"},"default":1}}]}}""",
		)).toString())
		EmitTests(ir, Kotlinize(ir), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) {}.emitAll()
		val fixtures = out.resolve("GeneratedFixtures.kt").readText()
		assertEquals(listOf(
			"data class TitleFixture(val text: String = \"無題\")",
			"data class EditionFixture(val title: TitleFixture, val number: Long)",
		), fixtures.lines().filter { it.startsWith("data class TitleFixture(") || it.startsWith("data class EditionFixture(") }, fixtures)
	}
}
