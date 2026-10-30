package lean2kotlin

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * 名前の先頭 1 文字の大小の写しは共有の 1 文字写像(capitalizeFirst / decapitalizeFirst)に揃える —
 * 文字列の写像は 1 文字が複数文字になる(ß → SS、İ → i̇)ので、宣言した名前と参照する名前が食い違う。
 */
class FirstCharCaseTest {

	private val sprout = sproutIr()

	private fun Ir.with(types: List<IrTypeDef> = this.types, useCases: List<IrService> = this.useCases) =
		Ir(rootNamespace, types, queryServices, useCases, domainServices, useCaseRules, contracts, faultContracts, behaviors, ports, dropped)

	@Test
	fun `enum の既定値は宣言と同じ構成子名を指す`(@TempDir out: Path) {
		val errLean = "Sprout.Application.QueryError"
		val ir = sprout.with(types = sprout.types.map { if (it.lean == errLean) it.copy(shape = IrShape.Enum(listOf("ßperre"))) else it })
		val k = Kotlinize(ir)
		val tests = EmitTests(ir, k, Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) {}
		assertEquals("QueryError.ßperre", tests.defaultLiteral(IrType.Ref(errLean)))
		assertEquals(k.refLiteral(ir.typeDef(errLean), JsonPrimitive("ßperre")), tests.defaultLiteral(IrType.Ref(errLean)))
	}

	@Test
	fun `golden の画面キーは UseCase 名の先頭を 1 文字のまま小文字にする`() {
		val ir = sprout.with(useCases = sprout.useCases.map { if (it.name == "NotesUseCase") it.copy(module = "İnventoryUseCase") else it })
		val snap = GoldenSnapshot("inventory", JsonObject(emptyMap()), JsonObject(mapOf("inventory" to JsonArray(emptyList()))))
		assertEquals(mapOf("NotesUseCase" to "inventory"), planGoldenTargets(ir, listOf(snap)).mapValues { it.value.screenKey })
	}
}
