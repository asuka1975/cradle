package lean2kotlin

import kotlinx.serialization.json.Json
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * オラクル値の JSON の形の検査: fixture 語彙のリテラル(refLiteral)と入力位置のリテラル(inputRefLiteral)は
 * 同じ JSON の形を同じ検査で読み、形の崩れた JSON には同じ文言で生成を止める(コンパイルできない式を出さない)。
 */
class LiteralJsonCheckTest {

	private val kind = IrTypeDef("T.Kind", "Kind", "valueObject",
		IrShape.Sealed(listOf(IrCtor("plain", emptyList()), IrCtor("tagged", listOf(IrField("label", IrType.Str))))), null,
		module = "T.Domain.ValueObject")
	private val cmd = IrTypeDef("T.Cmd", "Cmd", "command",
		IrShape.Structure(listOf(IrField("title", IrType.Str), IrField("kind", IrType.Ref(kind.lean)))), null,
		module = "T.Application.UseCase.PostUseCase.Command")
	private val ir = Ir("T", listOf(kind, cmd), emptyList(), emptyList(), emptyList())

	private fun renderers(out: Path): List<(IrTypeDef, String) -> String> {
		val k = Kotlinize(ir)
		val tests = EmitTests(ir, k, Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) {}
		return listOf(
			{ td, j -> k.refLiteral(td, Json.parseToJsonElement(j)) },
			{ td, j -> tests.inputRefLiteral(td, Json.parseToJsonElement(j)) },
		)
	}

	@Test
	fun `形の正しい JSON は両方のリテラルで同じ式になる`(@TempDir out: Path) {
		for (render in renderers(out)) {
			assertEquals("Kind.Plain", render(kind, "\"plain\""))
			// 引数の無い構成子は object 形でも中身を読まない
			assertEquals("Kind.Plain", render(kind, """{"plain":null}"""))
			assertEquals("Kind.Tagged(label = \"a\")", render(kind, """{"tagged":{"label":"a"}}"""))
		}
	}

	@Test
	fun `形の崩れた JSON は両方のリテラルで同じ文言の失敗にする`(@TempDir out: Path) {
		for (render in renderers(out)) {
			assertEquals("T.Cmd.kind: JSON に無い",
				assertFailsWith<IllegalArgumentException> { render(cmd, """{"title":"x"}""") }.message)
			// 引数のある構成子を文字列で書いた値
			assertFailsWith<IllegalArgumentException> { render(kind, "\"tagged\"") }
			assertEquals("T.Kind: sealed 値の JSON が不正です: {\"plain\":null,\"tagged\":{\"label\":\"a\"}}",
				assertFailsWith<IllegalArgumentException> { render(kind, """{"plain":null,"tagged":{"label":"a"}}""") }.message)
			assertEquals("T.Kind.label: JSON に無い",
				assertFailsWith<IllegalArgumentException> { render(kind, """{"tagged":{}}""") }.message)
			assertEquals("T.Kind: 不明なコンストラクタ other",
				assertFailsWith<IllegalStateException> { render(kind, """{"other":{}}""") }.message)
		}
	}
}
