package lean2kotlin

import kotlinx.serialization.json.Json
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.isRegularFile
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText
import kotlin.io.path.walk
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * 名前の無い引数の構成子(形の欄名は arg<序数>)の値の読み方: 抽出器の ctor 分解と合成シリアライザは {"c":{"arg0":…}} と書き、
 * Lean の derive した ToJson(golden と、インスタンスを通ったオラクル)は引数 1 つなら裸の値、2 つ以上なら配列で書く。どちらも同じ式になる。
 * 実物の derive の形は extract-fixture の expected-ir.json(Depot.Hold)が固定している。
 */
class SealedUnnamedArgTest {

	private val hold = IrTypeDef("T.Hold", "Hold", "valueObject", IrShape.Sealed(listOf(
		IrCtor("onDock", listOf(IrField("arg0", IrType.Nat))),
		IrCtor("atBay", listOf(IrField("arg0", IrType.Nat), IrField("arg1", IrType.Nat))),
		IrCtor("mixed", listOf(IrField("row", IrType.Nat), IrField("arg1", IrType.Nat))),
		IrCtor("named", listOf(IrField("row", IrType.Nat))),
	)), null, module = "T.Domain.ValueObject")
	private val slot = IrTypeDef("T.Slot", "Slot", "valueObject",
		IrShape.Structure(listOf(IrField("hold", IrType.Ref(hold.lean)))), null, module = "T.Domain.ValueObject")
	private val ir = Ir("T", listOf(hold, slot), emptyList(), emptyList(), emptyList())

	private fun renderers(out: Path): List<(IrTypeDef, String) -> String> {
		val k = Kotlinize(ir)
		val tests = EmitTests(ir, k, Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) {}
		return listOf(
			{ td, j -> k.refLiteral(td, Json.parseToJsonElement(j)) },
			{ td, j -> tests.inputRefLiteral(td, Json.parseToJsonElement(j)) },
		)
	}

	@Test
	fun `欄名の鍵の形と derive の形は同じ式になる`(@TempDir out: Path) {
		for (render in renderers(out)) {
			for (j in listOf("""{"onDock":5}""", """{"onDock":{"arg0":5}}""")) assertEquals("Hold.OnDock(arg0 = 5L)", render(hold, j), j)
			for (j in listOf("""{"atBay":[1,2]}""", """{"atBay":{"arg0":1,"arg1":2}}""")) assertEquals("Hold.AtBay(arg0 = 1L, arg1 = 2L)", render(hold, j), j)
			for (j in listOf("""{"mixed":[1,2]}""", """{"mixed":{"row":1,"arg1":2}}""")) assertEquals("Hold.Mixed(row = 1L, arg1 = 2L)", render(hold, j), j)
			assertEquals("Hold.Named(row = 1L)", render(hold, """{"named":{"row":1}}"""))
			// structure の derive が中の sealed を裸の値で書いた形
			assertEquals("Slot(hold = Hold.OnDock(arg0 = 5L))", render(slot, """{"hold":{"onDock":5}}"""))
		}
	}

	@Test
	fun `引数の JSON が形に合わなければ、型と構成子を言って止める`(@TempDir out: Path) {
		for (render in renderers(out)) {
			assertEquals("T.Hold.atBay: 構成子の引数の JSON が不正です: [1]",
				assertFailsWith<IllegalStateException> { render(hold, """{"atBay":[1]}""") }.message)
			assertEquals("T.Hold.atBay: 構成子の引数の JSON が不正です: 1",
				assertFailsWith<IllegalStateException> { render(hold, """{"atBay":1}""") }.message)
			assertEquals("T.Hold.atBay: 構成子の引数の JSON が不正です: {\"arg0\":1}",
				assertFailsWith<IllegalStateException> { render(hold, """{"atBay":{"arg0":1}}""") }.message)
			// 名前のある引数だけの構成子は derive でも object なので、裸の値は誤り
			assertEquals("T.Hold.named: 構成子の引数の JSON が不正です: 1",
				assertFailsWith<IllegalStateException> { render(hold, """{"named":1}""") }.message)
		}
	}

	@Test
	fun `単一の名前の無い引数の中の値が形に合わなくても、型と構成子を言って止める`(@TempDir out: Path) {
		for (render in renderers(out)) for ((j, body) in listOf(
			"""{"onDock":{"wrong":5}}""" to """{"wrong":5}""", """{"onDock":[5]}""" to "[5]", """{"onDock":"x"}""" to "\"x\"")) {
			val e = assertFailsWith<IllegalStateException>(j) { render(hold, j) }
			assertTrue(e.message!!.startsWith("T.Hold.onDock: 構成子の引数の JSON が不正です: $body("), e.message)
		}
	}

	@Test
	fun `golden が derive の形で運ぶ名前の無い引数も、生成を止めずに読む`(@TempDir tmp: Path) {
		// Mini の Place.box の引数を名前の無いものにした形。golden は derive の形(裸の値)で、オラクルは欄名の鍵で書く
		val ir = Ir.parse(Json.parseToJsonElement(testResources.resolve("mini/ir.json").readText()).toString()
			.replace("""{"type":{"name":"Mini.Title","k":"ref"},"name":"label"}""", """{"type":{"name":"Mini.Title","k":"ref"},"name":"arg0"}""")
			.replace("""{"box":{"label":""", """{"box":{"arg0":"""))
		val goldenDir = tmp.resolve("golden").createDirectories()
		for (f in testResources.resolve("mini/golden").listDirectoryEntries())
			goldenDir.resolve(f.name).writeText(Regex("""\{"box":\{"label":(\{[^}]*\})\}\}""").replace(f.readText()) { """{"box":${it.groupValues[1]}}""" })
		assertTrue("""{"box":{"text":""" in goldenDir.resolve("basic-init.json").readText())
		val out = tmp.resolve("out")
		generationLog(ir, Golden.load(goldenDir), "t", out)
		assertTrue(out.resolve("kotlin-test").walk().filter { it.isRegularFile() }.any { "Box(arg0 = " in it.readText() })
	}

	@Test
	fun `実物の抽出器が出したオラクルを、合成シリアライザの形もインスタンスの形も読む`() {
		val fixture = Ir.parse(Path.of("../scaffold-check/extract-fixture/expected-ir.json").readText())
		val k = Kotlinize(fixture)
		fun oks(theorem: String, lean: String) =
			fixture.contracts.single { it.theorem == theorem }.cases.take(1).map { k.literal(IrType.Ref(lean), it.ok!!) }.single()
		assertEquals("DomainError.OutOfStock(arg0 = 0L)", oks("shortage_eq", "Depot.DomainError"))
		assertEquals("Hold.OnDock(arg0 = 4L)", oks("dockHold_eq", "Depot.Hold"))
		assertEquals("Hold.AtBay(arg0 = 4L, arg1 = 4L)", oks("bayHold_eq", "Depot.Hold"))
		assertEquals("Hold.Mixed(row = 4L, arg1 = 4L)", oks("mixedHold_eq", "Depot.Hold"))
	}
}
