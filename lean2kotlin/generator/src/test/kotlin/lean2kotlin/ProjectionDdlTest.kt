package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Retrieve テスト(DDL)の射影定理のケース: 集約の列は観測モデルの規約(rootCollectionOf の List<Root>)で引く —
 * 観測モデルが集約の列のほかに List を運んでも、射影定理のケースを落とさない。
 * 素材は Sprout の NoteRepositoryState に文字列の列を足したもの。
 */
class ProjectionDdlTest {

	private val stateLean = "Sprout.Application.NoteRepositoryState"

	@Test
	fun `観測モデルが集約の列のほかに List を運んでも、射影定理のケースを出す`(@TempDir out: Path) {
		val sprout = sproutIr()
		val types = sprout.types.map { td ->
			if (td.lean != stateLean) td
			else td.copy(shape = IrShape.Structure((td.shape as IrShape.Structure).fields + IrField("tags", IrType.ListOf(IrType.Str))))
		}
		val ir = Ir(sprout.rootNamespace, types, sprout.queryServices, sprout.useCases, sprout.domainServices,
			sprout.useCaseRules, sprout.contracts, sprout.faultContracts, sprout.behaviors, sprout.ports, sprout.dropped)
		val lines = mutableListOf<String>()
		val tests = EmitTests(ir, Kotlinize(ir), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) { lines += it }
		tests.emitAll()
		val ddl = out.resolve("application/ReadModelDdlContractTest.kt").readText()
		for (i in 1..4) assertTrue("fun `retrieveNotesReadModel は NoteRow の定理 noteRows_ids を再現する($i)`()" in ddl, ddl)
		assertEquals(listOf("  note: Retrieve テスト: ReadModel 1 種 — golden+射影定理で 4 ケース"),
			lines.filter { "ReadModelDdlContractTest" in it || "Retrieve テスト" in it })
		assertTrue("projection/$stateLean/noteRows_ids" in tests.emittedContracts)
	}
}
