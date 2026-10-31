package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Retrieve テスト(DDL)の射影定理のケース: Retrieve フックは集約の列だけを受ける — 観測モデルが集約の列のほかにフィールドを
 * 運ぶと、射影がそれに依っていても入力に渡せないので、矛盾しうるテストを出さずに理由を言う(List でも List でなくても同じ)。
 * 素材は Sprout の NoteRepositoryState にフィールドを足したもの。
 */
class ProjectionDdlTest {

	private val stateLean = "Sprout.Application.NoteRepositoryState"

	private fun emitWithExtra(out: Path, extra: IrField): Pair<EmitTests, List<String>> {
		val sprout = sproutIr()
		val types = sprout.types.map { td ->
			if (td.lean != stateLean) td
			else td.copy(shape = IrShape.Structure((td.shape as IrShape.Structure).fields + extra))
		}
		val ir = Ir(sprout.rootNamespace, types, sprout.queryServices, sprout.useCases, sprout.domainServices,
			sprout.useCaseRules, sprout.contracts, sprout.faultContracts, sprout.behaviors, sprout.ports, sprout.dropped)
		val lines = mutableListOf<String>()
		val tests = EmitTests(ir, Kotlinize(ir), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) { lines += it }
		tests.emitAll()
		return tests to lines
	}

	private fun assertNoProjectionCases(out: Path, extra: IrField) {
		val (tests, lines) = emitWithExtra(out, extra)
		assertTrue(out.resolve("application/ReadModelDdlContractTest.kt").readText().let { "noteRows_ids" !in it })
		assertEquals(listOf("  note: NoteRow: 観測モデル NoteRepositoryState の集約の列のほかのフィールド(${extra.name})は Retrieve フックに渡せないので、射影定理 noteRows_ids のケースを生成できません"),
			lines.filter { "noteRows_ids" in it && "NoteRepositoryState" in it })
		assertTrue("projection/$stateLean/noteRows_ids" !in tests.emittedContracts)
	}

	@Test
	fun `観測モデルが集約の列のほかに List を運ぶと、射影定理のケースを出さず理由を言う`(@TempDir out: Path) {
		assertNoProjectionCases(out, IrField("tags", IrType.ListOf(IrType.Str)))
	}

	@Test
	fun `観測モデルが集約の列のほかに List でないフィールドを運んでも、射影定理のケースを出さず理由を言う`(@TempDir out: Path) {
		assertNoProjectionCases(out, IrField("archived", IrType.Bool))
	}
}
