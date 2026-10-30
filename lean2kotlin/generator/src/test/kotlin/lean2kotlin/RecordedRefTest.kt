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
 * テストの本文に書く型名と fixture 名は参照として記録する — import は記録からだけ作る。
 * ケースの値がその型を通らなくても、宣言や型引数に書いた名前は import に載る。
 */
class RecordedRefTest {

	@Test
	fun `Entity の実体化フックが宣言する fixture は、ケースの値が通らなくても import に載る`(@TempDir out: Path) {
		val base = Json.parseToJsonElement(testResources.resolve("lobby/lobby-ir.json").readText()).jsonObject
		// 主体のフィールドに VisitorName は無く、ケースは cs を空で渡す — VisitorNameFixture はフックの宣言にしか現れない
		val method = Json.parseToJsonElement("""{"name":"countCompanions","doc":"","ret":{"k":"nat"},
			"params":[{"name":"a","type":{"k":"ref","name":"Lobby.Domain.PaymentAttempt"}},
			{"name":"cs","type":{"k":"list","of":{"k":"ref","name":"Lobby.VisitorName"}}}]}""")
		val behaviors = base.getValue("behaviors").jsonArray.map { b ->
			if (b.jsonObject.getValue("subject").jsonPrimitive.content != "Lobby.Domain.PaymentAttempt") b
			else JsonObject(b.jsonObject + mapOf("methods" to JsonArray(b.jsonObject.getValue("methods").jsonArray + method)))
		}
		val attempt = """{"id":{"id":91},"visit":{"id":91},"amount":{"value":{"numerator":1,"denominator":2}},"tries":4,"phase":"pending"}"""
		val contract = Json.parseToJsonElement("""{"target":"behaviors","useCase":"Lobby.Domain.PaymentAttempt",
			"method":"countCompanions","theorem":"countCompanions_empty","doc":"",
			"cases":[{"kind":"pure","args":{"a":$attempt,"cs":[]},"ok":0}]}""")
		val ir = Ir.parse(JsonObject(base + mapOf(
			"behaviors" to JsonArray(behaviors),
			"contracts" to JsonArray(base.getValue("contracts").jsonArray + contract))).toString())
		EmitTests(ir, Kotlinize(ir), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) {}.emitAll()
		val test = out.resolve("domain/entity/PaymentAttemptEntityContractTest.kt").readText()
		assertTrue("\tprotected abstract fun visitorName(fixture: VisitorNameFixture): VisitorName\n" in test, test)
		assertTrue("listOf<VisitorName>()" in test, test)
		assertTrue("import t.VisitorNameFixture\n" in test, test)
	}

	@Test
	fun `空の状態コレクションから合成する Row の列も Row を参照として記録する`(@TempDir out: Path) {
		val ir = sproutIr()
		val k = Kotlinize(ir)
		val emit = EmitTests(ir, k, Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) {}
		val (literal, collected) = k.collecting {
			emit.synthesizeArg(IrType.ListOf(IrType.Ref("Sprout.Application.NoteRow")),
				JsonObject(mapOf("notes" to JsonArray(emptyList()))))
		}
		assertEquals("listOf<NoteRow>()", literal)
		assertEquals(setOf("Sprout.Application.NoteRow"), collected.refs)
	}
}
