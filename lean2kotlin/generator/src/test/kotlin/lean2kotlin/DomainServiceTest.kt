package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * DomainService は 1 サービス 1 interface として `domain/domainservice/` に出る —
 * 手書きの最小 IR(domain-services: 短い名前のサービス 2 つと単一ファイルの DomainService)で観測する。
 */
class DomainServiceTest {

	private val ir = Ir.parse(testResources.resolve("domain-services/ir.json").readText())

	private fun generate(ir: Ir, out: Path) {
		EmitMain(ir, Kotlinize(ir), Output(out.resolve("main"), "mini", "\t"), Output(out.resolve("test"), "mini", "\t")) {}.emitAll()
	}

	@Test
	fun `サービスごとに interface が 1 ファイルずつ生成される`(@TempDir out: Path) {
		generate(ir, out)
		val dir = out.resolve("main/domain/domainservice")
		assertEquals(listOf("DomainService.kt", "PricingService.kt", "TaxService.kt"),
			Files.list(dir).use { s -> s.map { it.fileName.toString() }.sorted().toList() })
		val pricing = dir.resolve("PricingService.kt").readText()
		assertTrue("package mini.domain.domainservice" in pricing, pricing)
		assertTrue("interface PricingService {" in pricing, pricing)
		assertTrue("\t/** 値付けを決める。 */\n\tfun decidePricing(a: Money, b: Money): Boolean" in pricing, pricing)
		assertTrue("Lean: モジュール `Pricing` の interface 面" in pricing, pricing)
		assertTrue("import mini.domain.valueobject.Money" in pricing, pricing)
		val tax = dir.resolve("TaxService.kt").readText()
		assertTrue("interface TaxService {" in tax, tax)
		assertTrue("fun tax(m: Money): Money" in tax, tax)
		assertTrue("interface DomainService {" in dir.resolve("DomainService.kt").readText())
	}

	@Test
	fun `同名のサービスが 2 つあれば生成は上書きせず失敗する`(@TempDir out: Path) {
		val dup = Ir(ir.rootNamespace, ir.types, ir.queryServices, ir.useCases,
			ir.domainServices + ir.domainServices.first { it.name == "TaxService" }.copy(module = "Tax2"))
		val e = assertFailsWith<IllegalStateException> { generate(dup, out) }
		assertTrue("TaxService.kt" in e.message!!, e.message!!)
	}
}
