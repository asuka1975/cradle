package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 全件制約(all)と上限制約(atMost)が Arb と Repository 契約テストへ写ることを、
 * 手書きの最小 IR(constrained-list: 列挙のフィールドに上限、Bool のフィールドに全件)で観測する。
 * 観測モデルに add / update があり Entity にファクトリの無い形で、Repository の操作が観測モデルから導かれることも見る。
 */
class ConstrainedListArbTest {

	private val ir = Ir.parse(testResources.resolve("constrained-list/ir.json").readText())
	private val k = Kotlinize(ir)

	private fun generate(out: Path) {
		EmitTests(ir, k, Output(out, "mini", "\t"), emptyList()) {}.emitAll()
	}

	@Test
	fun `集約の列の Arb は同一性で間引き、全件制約は述語で絞り、上限制約は満たす要素を先頭から max 件までにする`(@TempDir out: Path) {
		generate(out)
		val arbs = out.resolve("GeneratedArbs.kt").readText()
		assertTrue("import mini.domain.valueobject.Phase" in arbs, arbs)
		assertTrue(
			"/** `Mini.Application.GameRepositoryState` の制約(uniqueIds: id・allArchived: 全件 archived = true・atMostOneActive: phase ≠ \"finished\" は高々 1 件)と同一性を満たす個体の列。" +
				"間引きで size を割った列は引き直す。 */\n" +
				"internal fun arbGameRepository(size: IntRange = 0..5): Arb<List<GameFixture>> =\n" +
				"\tArb.list(arbGame(), size).map { xs -> xs.distinctBy { x -> x.id }" +
				".filter { x -> x.archived == true }" +
				".let { ys -> var k = 0; ys.filter { x -> !(x.phase != Phase.Finished) || k++ < 1 } } }" +
				".filter { it.size in size }" in arbs,
			arbs)
	}

	@Test
	fun `Repository の操作は観測モデルの add と update から導かれ、契約テストは制約を満たす列を播種する`(@TempDir out: Path) {
		val game = ir.typeDef("Mini.Domain.Game")
		assertTrue(k.factoryMethodsOf(game).isEmpty())
		assertTrue(k.instanceMethodsOf(game).isEmpty())
		assertEquals(Kotlinize.RepoOps(find = true, add = true, update = true), k.repoOps(game))
		generate(out)
		val test = out.resolve("domain/repository/GameRepositoryContractTest.kt").readText()
		assertTrue(" * 個体の列は `Mini.Application.GameRepositoryState` の制約を満たすように引く(arbGameRepository)。" in test, test)
		assertTrue("for (f in fs) repo.add(entity(f))" in test, test)
		assertTrue("repo.update(entity(updated))" in test, test)
		assertEquals(3, Regex("@Test").findAll(test).count())
	}

	@Test
	fun `constrainExpr は all を filter に、atMost を先頭から max 件までの filter に写す`() {
		val state = ir.typeDef("Mini.Application.GameRepositoryState")
		val rc = k.rootCollectionOf(ir.typeDef("Mini.Domain.Game"))!!
		val keys = k.constraintKeysOf(state, rc.coll)
		assertEquals(listOf("uniqueIds", "allArchived", "atMostOneActive"), keys.map { it.constraint.name })
		assertEquals("xs.filter { x -> x.archived == true }", k.constrainExpr("xs", keys.filter { it.constraint.kind == "all" }))
		assertEquals(
			"xs.let { ys -> var k = 0; ys.filter { x -> !(x.phase != Phase.Finished) || k++ < 1 } }",
			k.constrainExpr("xs", keys.filter { it.constraint.kind == "atMost" }))
	}
}
