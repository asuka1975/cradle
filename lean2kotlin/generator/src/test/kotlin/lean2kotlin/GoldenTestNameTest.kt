package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * golden の出どころ(ファイル名の接頭辞)を運ぶテスト名: JVM はバッククォートの中でも `. ; [ ] / < > : \` を名前に許さず、
 * Kotlin はバッククォートの名前にバッククォートと改行を許さないので、テスト名に入れるときだけ _ にする。生成のログの note は出どころをそのまま書く。
 */
class GoldenTestNameTest {

	@Test
	fun `JVM が名前に許さない文字だけを置き換え、ほかの文字はそのまま残す`() {
		assertEquals("a_b_c_d_e_f_g_h_i_j", testNameSafe("a.b;c[d]e/f<g>h:i\\j"))
		for (s in listOf("basic-init", "payment-flow #3", "棚の一覧 (再) — 2026-01-05", "x_y")) assertEquals(s, testNameSafe(s))
	}

	@Test
	fun `バッククォート名を閉じるバッククォートと改行も置き換える`() {
		assertEquals("a_b_c_d", testNameSafe("a`b\nc\rd"))
	}

	@Test
	fun `バッククォートと改行を含む golden のテスト名は宣言を壊さない`(@TempDir out: Path) {
		val ir = miniIr()
		for (source in listOf("basic`v2-init", "basic\nv2-init")) {
			val snaps = Golden.load(testResources.resolve("mini/golden")).snapshots.map { it.copy(source = source) }
			EmitTests(ir, Kotlinize(ir), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), snaps) {}.emitAll()
			val shelf = out.resolve("application/usecase/shelfusecase/ShelfUseCaseContractTest.kt").readText()
			val ddl = out.resolve("application/ReadModelDdlContractTest.kt").readText()
			assertTrue(shelf.contains("\tfun `execute は golden basic_v2-init を再現する`() {\n"), shelf)
			assertTrue(ddl.contains("\tfun `LoansReadModel は golden basic_v2-init の状態から Retrieve できる`() {\n"), ddl)
		}
	}

	@Test
	fun `バッククォートだけが違う golden の組はテスト名の衝突として読まない`(@TempDir dir: Path) {
		val files = testResources.resolve("mini/golden").listDirectoryEntries()
		for (prefix in listOf("a`b", "a_b")) for (f in files) dir.resolve(f.name.replace("basic", prefix)).writeText(f.readText())
		val load = Golden.load(dir)
		assertEquals(emptyList(), load.snapshots)
		assertEquals(1, load.errors.count { "テスト名にすると同じ a_b になる（`. ; [ ] / < > : \\` とバッククォート・改行は _ にする）" in it }, load.errors.joinToString("\n"))
	}

	@Test
	fun `点を含む golden の参照系と Retrieve のテスト名は点を置き換え、note は出どころのまま書く`(@TempDir out: Path) {
		val ir = miniIr()
		val snaps = Golden.load(testResources.resolve("mini/golden")).snapshots.map { it.copy(source = "basic.v2-init") }
		val log = mutableListOf<String>()
		EmitTests(ir, Kotlinize(ir), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), snaps) { log += it }.emitAll()
		val shelf = out.resolve("application/usecase/shelfusecase/ShelfUseCaseContractTest.kt").readText()
		val ddl = out.resolve("application/ReadModelDdlContractTest.kt").readText()
		assertTrue(shelf.contains("\tfun `execute は golden basic_v2-init を再現する`() {\n"), shelf)
		for (rm in listOf("LoansReadModel", "ShelfReadModel")) {
			assertTrue(ddl.contains("\tfun `$rm は golden basic_v2-init の状態から Retrieve できる`() {\n"), ddl)
		}
		assertFalse(shelf.contains("basic.v2") || ddl.contains("basic.v2"))
		assertTrue("  note: LoansUseCase.execute: 引数を合成できないため basic.v2-init をスキップ" in log, log.joinToString("\n"))
	}
}
