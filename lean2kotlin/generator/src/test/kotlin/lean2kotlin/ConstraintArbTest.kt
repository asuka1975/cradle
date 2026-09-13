package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 観測モデルの制約(IR の constraints)が Arb と Repository 契約テストへ写ることを、
 * 手書きの最小 IR(unique-name: 名前の一意性は値のあるものだけ、入れ子の個体あり)で観測する。
 */
class ConstraintArbTest {

	private val ir = Ir.parse(testResources.resolve("unique-name/ir.json").readText())

	private fun generate(out: Path) {
		EmitTests(ir, Kotlinize(ir), Output(out, "mini", "\t"), emptyList()) {}.emitAll()
	}

	@Test
	fun `集約の列の Arb は同一性と宣言された制約で間引き、入れ子の個体の id を列の位置で変位させる`(@TempDir out: Path) {
		generate(out)
		val arbs = out.resolve("GeneratedArbs.kt").readText()
		assertTrue(
			"/** `Mini.Application.RoomRepositoryState` の制約(uniqueIds: id・uniqueNames: name)と同一性を満たす個体の列。" +
				"間引きで size を割った列は引き直す。\n    入れ子の個体の id は列の位置で変位させる(同一性はサイト全体で一意)。 */\n" +
				"internal fun arbRoomRepository(size: IntRange = 0..5): Arb<List<RoomFixture>> =\n" +
				"\tArb.list(arbRoom(), size).map { xs -> xs.distinctBy { x -> x.id }" +
				".let { ys -> val seen = HashSet<RoomName>(); ys.filter { x -> x.name == null || seen.add(x.name) } } }" +
				".map { xs -> xs.mapIndexed { i, x -> x.copy(members = x.members.map { y -> y.copy(id = MemberId(y.id.id + i * 1000000L)) }) } }" +
				".filter { it.size in size }" in arbs,
			arbs)
		// 集約自身の Arb: 入れ子の個体の列は同一性で間引く(集約に制約の宣言は無い)
		assertTrue("Arb.list(arbMember(), 0..5).map { xs -> xs.distinctBy { x -> x.id } }" in arbs, arbs)
	}

	@Test
	fun `Repository 契約テストは制約を満たす列を播種し、末尾の個体を先頭の id に写して update する`(@TempDir out: Path) {
		generate(out)
		val test = out.resolve("domain/repository/RoomRepositoryContractTest.kt").readText()
		assertTrue("import mini.arbRoomRepository" in test, test)
		assertTrue(" * 個体の列は `Mini.Application.RoomRepositoryState` の制約を満たすように引く(arbRoomRepository)。" in test, test)
		assertTrue("checkAll(PropTestConfig(seed = 42), arbRoomRepository()) { fs ->" in test, test)
		assertTrue("checkAll(PropTestConfig(seed = 42), arbRoomRepository(4..7)) { fs ->\n" +
			"\t\t\t\tval seeded = fs.dropLast(1)\n" +
			"\t\t\t\tval at = seeded.size / 2\n" +
			"\t\t\t\tval updated = fs.last().copy(id = seeded[at].id)\n" in test, test)
		assertTrue("assertEquals(seeded.mapIndexed { j, f -> if (j == at) updated else f }, repo.findAll().map { it.toFixture() })" in test, test)
		assertEquals(3, Regex("@Test").findAll(test).count())
	}
}
