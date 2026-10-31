package lean2kotlin

import kotlinx.serialization.json.Json
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * 対(Pair)と断るふるまいの結果(DomainResult)の中の entity-like: fixture 語彙の型・観測正規化・入力位置のリテラルは、
 * 対の中も fixture 語彙への到達(reachesEntityLike)と同じく降りて写す。entity-like に届かない対と結果は本番の型のまま。
 * 素材は手書きの IR: ふるまい持ちの VO の題(Title)、題と数の対を運ぶ VO の書架記号(Shelfmark — 対を通じて橋渡し型になる)、
 * 同じ対を運ぶ Command。
 */
class PairFixtureTest {

	private val title = IrTypeDef("T.Title", "Title", "valueObject",
		IrShape.Structure(listOf(IrField("text", IrType.Str))), null, module = "T.Domain.ValueObject")
	private val err = IrTypeDef("T.Err", "Err", "error", IrShape.Enum(listOf("bad")), null, module = "T.Domain.Error")
	private val titled = IrType.PairOf(IrType.Ref(title.lean), IrType.Nat)
	private val plain = IrType.PairOf(IrType.Nat, IrType.Str)
	private val shelfmark = IrTypeDef("T.Shelfmark", "Shelfmark", "valueObject",
		IrShape.Structure(listOf(IrField("mark", titled), IrField("plain", plain))), null, module = "T.Domain.ValueObject")
	private val cmd = IrTypeDef("T.Cmd", "Cmd", "command",
		IrShape.Structure(listOf(IrField("mark", titled), IrField("plain", plain))), null,
		module = "T.Application.UseCase.ShelveUseCase.Command")
	private val valid = IrBehavior(title.lean, "T.Domain.ValueObject",
		listOf(IrMethod("valid", "", listOf(IrField("t", IrType.Ref(title.lean))), IrType.Bool)))
	private val ir = Ir("T", listOf(title, err, shelfmark, cmd), emptyList(), emptyList(), emptyList(), behaviors = listOf(valid))

	private fun tests(out: Path, k: Kotlinize = Kotlinize(ir)) =
		EmitTests(ir, k, Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) {}

	@Test
	fun `entity-like を運ぶ対と結果の fixture 語彙の型は中身を fixture にし、届かない対と結果は本番の型のまま`() {
		val k = Kotlinize(ir)
		assertEquals("Pair<TitleFixture, Long>", k.typeRefFixture(titled))
		assertEquals("DomainResult<Err, TitleFixture>", k.typeRefFixture(IrType.Result(IrType.Ref(err.lean), IrType.Ref(title.lean))))
		assertEquals("listOf<Pair<TitleFixture, Long>>(Pair(TitleFixture(text = \"a\"), 1L))",
			k.literal(IrType.ListOf(titled), Json.parseToJsonElement("""[[{"text":"a"},1]]""")))
		for (t in listOf(plain, IrType.Result(IrType.Ref(err.lean), IrType.Nat), IrType.PairOf(IrType.Ref(err.lean), plain))) {
			assertEquals(k.typeRef(t), k.typeRefFixture(t))
		}
	}

	@Test
	fun `entity-like を運ぶ対の観測正規化は対の各側を写し、届かない対は写さない`(@TempDir out: Path) {
		val tests = tests(out)
		assertEquals(".let { p -> Pair(p.first.toFixture(), p.second) }", tests.fixtureNorm(titled))
		assertEquals(".let { p -> Pair(p.first, p.second.map { it.toFixture() }) }",
			tests.fixtureNorm(IrType.PairOf(IrType.Nat, IrType.ListOf(IrType.Ref(title.lean)))))
		assertEquals("", tests.fixtureNorm(plain))
		tests.emitAll()
		val fixtures = out.resolve("GeneratedFixtures.kt").readText()
		assertEquals(listOf(
			"data class ShelfmarkFixture(val mark: Pair<TitleFixture, Long>, val plain: Pair<Long, String>)",
			"fun Shelfmark.toFixture(): ShelfmarkFixture = ShelfmarkFixture(mark = mark.let { p -> Pair(p.first.toFixture(), p.second) }, plain = plain)",
		), fixtures.lines().filter { it.contains("ShelfmarkFixture(") }, fixtures)
	}

	@Test
	fun `入力位置の対は各側を入力位置のリテラルで書き、entity-like は実体化フックに写す`(@TempDir out: Path) {
		val k = Kotlinize(ir)
		val tests = tests(out, k)
		assertEquals("Pair(title(TitleFixture(text = \"a\")), 1L)",
			tests.inputLiteral(titled, Json.parseToJsonElement("""[{"text":"a"},1]""")))
		val plainJson = Json.parseToJsonElement("""[1,"x"]""")
		assertEquals(k.literal(plain, plainJson), tests.inputLiteral(plain, plainJson))
		assertEquals("Cmd(mark = Pair(title(TitleFixture(text = \"a\")), 2L), plain = Pair(1L, \"x\"))",
			tests.inputLiteral(IrType.Ref(cmd.lean), Json.parseToJsonElement("""{"mark":[{"text":"a"},2],"plain":[1,"x"]}""")))
	}
}
