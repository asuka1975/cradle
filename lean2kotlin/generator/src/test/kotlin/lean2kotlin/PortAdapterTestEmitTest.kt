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
import kotlin.test.assertTrue

/**
 * Port の Adapter の適合テストの骨格: 観測が構成子を持たない structure のとき、
 * arrange フックが要求と期待する観測の組を返し、等値を検査する(恒真の主張を出さない)。
 */
class PortAdapterTestEmitTest {

	@Test
	fun `structure の観測は arrange が要求と期待する観測の組を返し等値を検査する`(@TempDir out: Path) {
		val base = Json.parseToJsonElement(testResources.resolve("unique-name/ir.json").readText()).jsonObject
		val request = Json.parseToJsonElement("""{"lean":"Mini.Application.Port.Ledger.Record.Request","kotlin":"LedgerRecordRequest","role":"portRequest","module":"Mini.Application.Port.Ledger.Record",
			"shape":{"kind":"structure","fields":[{"name":"amount","type":{"k":"nat"}}]}}""")
		val outcome = Json.parseToJsonElement("""{"lean":"Mini.Application.Port.Ledger.Record.Outcome","kotlin":"LedgerRecordOutcome","role":"portOutcome","module":"Mini.Application.Port.Ledger.Record",
			"shape":{"kind":"structure","fields":[{"name":"balance","type":{"k":"nat"}}]}}""")
		val ports = Json.parseToJsonElement("""[{"name":"Ledger","layer":"application","module":"Mini.Application.Port.Ledger","operations":[{"name":"Record","method":"record",
			"request":"Mini.Application.Port.Ledger.Record.Request","outcome":"Mini.Application.Port.Ledger.Record.Outcome","doc":""}]}]""")
		val ir = JsonObject(base + mapOf("types" to JsonArray(base.getValue("types").jsonArray + request + outcome), "ports" to ports))
		Lean2KotlinGeneration.generate(Ir.parse(ir.toString()), GoldenLoad(emptyList(), emptyList()), "t",
			out.resolve("main"), out.resolve("test"), out.resolve("adapter-test"), "\t") {}
		val text = out.resolve("adapter-test/application/port/ledger/LedgerAdapterContractTest.kt").readText()
		assertTrue("protected abstract fun arrangeRecord(): Pair<LedgerRecordRequest, LedgerRecordOutcome>" in text, text)
		assertTrue("\tfun `record は期待した観測を産める`() {\n\t\tval (request, expected) = arrangeRecord()\n\t\tval outcome = adapter().record(request)\n\t\tassertEquals(expected, outcome)\n\t}" in text, text)
		assertTrue("assertEquals(outcome, outcome)" !in text, text)
	}
}
