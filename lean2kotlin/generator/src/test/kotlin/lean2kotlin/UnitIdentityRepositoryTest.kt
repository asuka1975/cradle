package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 同一性が Unit の集約(サイトに 1 つだけ)の Repository 契約テスト: Arb が引くのは fixture で、fixture は集約の interface を
 * 実装しない — 同一性を持つ集約と同じく、実体化フック entity で実装に写して save し、get の観測を toFixture で fixture に戻して比べる。
 * 素材は Mini の IR に観測モデルを持たない Unit 同一性の集約(貸出の決まり)を足したもの。Mini の Lean には足さない —
 * Retrieve テストは集約ごとに golden の状態のコレクションを引くので、golden に無い集約を足すと Mini の golden ケースが消える。
 */
class UnitIdentityRepositoryTest {

	private val mini = miniIr()
	private val rules = IrTypeDef("Mini.Domain.LendingRules", "LendingRules", "aggregateRoot",
		IrShape.Structure(listOf(IrField("id", IrType.Unit), IrField("loanDays", IrType.Nat))), IrType.Unit,
		module = "Mini.Domain.Entity.LendingRules", doc = "棚の貸出の決まり。棚に 1 つだけある。 ")
	private val ir = Ir(mini.rootNamespace, mini.types + rules, mini.queryServices, mini.useCases, mini.domainServices,
		mini.useCaseRules, mini.contracts, mini.faultContracts, mini.behaviors, mini.ports, mini.dropped)

	@Test
	fun `Unit 同一性の集約の契約テストは fixture を実体化フックで写して save し、get を toFixture で比べる`(@TempDir out: Path) {
		EmitTests(ir, Kotlinize(ir), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) {}.emitAll()
		val body = out.resolve("domain/repository/LendingRulesRepositoryContractTest.kt").readText()
		assertEquals(listOf(
			"\tprotected abstract fun repository(): LendingRulesRepository",
			"\t/** fixture の実体化(観測が一致する実装の Entity を返す)。 */",
			"\tprotected abstract fun entity(fixture: LendingRulesFixture): LendingRules",
		), body.lines().dropWhile { !it.startsWith("abstract class ") }.drop(1).take(3), body)
		assertEquals(listOf(
			"\t\t\t\trepo.save(entity(a))",
			"\t\t\t\tassertEquals(a, repo.get()?.toFixture())",
			"\t\t\t\trepo.save(entity(b))",
			"\t\t\t\tassertEquals(b, repo.get()?.toFixture())",
		), body.lines().filter { it.contains("repo.save(") || it.contains("repo.get()") }, body)
		assertTrue(body.contains("\tfun `保存前の get は null`() {\n\t\tassertNull(repository().get())\n"), body)
		for (imp in listOf("t.LendingRulesFixture", "t.domain.entity.LendingRules", "t.toFixture")) {
			assertTrue(body.lines().contains("import $imp"), body)
		}
		assertFalse(body.contains("repo.save(a)") || body.contains("assertEquals(a, repo.get())"), body)
	}
}
