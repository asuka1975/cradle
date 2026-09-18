package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 計算する読み取りモデル(状態の要素に無いフィールドを持つ Row)は golden の状態から
 * 引数を合成できない — EmitTests の参照系 golden 回帰を通して観測する。
 */
class SynthesizeArgTest {

	private val dir = testResources.resolve("computed-row")

	private fun run(out: Path): List<String> {
		val ir = Ir.parse(dir.resolve("ir.json").readText())
		val golden = Golden.load(dir.resolve("golden"))
		assertEquals(2, golden.snapshots.size)
		val notes = mutableListOf<String>()
		EmitTests(ir, Kotlinize(ir), Output(out, "shop", "\t"), Output(out.resolve("adapter"), "shop", "\t"), golden.snapshots) { notes += it.trim() }.emitAll()
		return notes
	}

	@Test
	fun `第一階層と入れ子の計算するフィールドが状態キーと経路つきで note に出る`(@TempDir out: Path) {
		val note = run(out).single { it.startsWith("note: OrderRow: 状態 orders の要素に無いフィールド") }
		assertTrue("OrderRow.total" in note, note)
		assertTrue("OrderRow.lines.LineRow.amount" in note, note)
	}

	@Test
	fun `同じ Row と同じ状態キーの note はスナップショットが複数でも 1 回だけ出る`(@TempDir out: Path) {
		val notes = run(out)
		assertEquals(1, notes.count { it.startsWith("note: OrderRow: 状態 orders") }, notes.toString())
	}

	@Test
	fun `合成できないスナップショットは golden 回帰から外れる`(@TempDir out: Path) {
		val notes = run(out)
		assertTrue("note: OrdersUseCase.execute: 引数を合成できないため basic-init をスキップ" in notes, notes.toString())
		assertTrue("note: OrdersUseCase.execute: 引数を合成できないため basic-flow #0 をスキップ" in notes, notes.toString())
		assertTrue("note: 契約テスト: OrdersUseCase — golden+定理で 0 ケース(参照系)" in notes, notes.toString())
		val test = out.resolve("application/usecase/ordersusecase/OrdersUseCaseContractTest.kt").readText()
		assertFalse("@Test" in test)
	}
}
