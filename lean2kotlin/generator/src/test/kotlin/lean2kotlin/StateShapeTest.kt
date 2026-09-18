package lean2kotlin

import kotlinx.serialization.json.Json
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * 集約の個体は `<Root>RepositoryState` の 1 本の List に全部入る — Option や単体のフィールドで
 * 個体を運ぶ観測モデルと、集約ルートを Option / List で直接運ぶ UseCase の State は、
 * 黙って読み飛ばさず理由付きで止まることを観測する。
 */
class StateShapeTest {

	private val gameId = IrTypeDef(
		lean = "Mini.Runtime.GameId", kotlin = "GameId", role = "valueObject", isId = true, module = "Mini.Runtime.Ids",
		shape = IrShape.Structure(listOf(IrField("id", IrType.Nat))), id = null)
	private val game = IrTypeDef(
		lean = "Mini.Domain.Game", kotlin = "Game", role = "aggregateRoot", module = "Mini.Domain.Entity.Game",
		shape = IrShape.Structure(listOf(IrField("id", IrType.Ref("Mini.Runtime.GameId")), IrField("closed", IrType.Bool))),
		id = IrType.Ref("Mini.Runtime.GameId"))
	private fun state(vararg fields: IrField) = IrTypeDef(
		lean = "Mini.Application.GameRepositoryState", kotlin = "GameRepositoryState", role = "repositoryState",
		module = "Mini.Application.RepositoryState", shape = IrShape.Structure(fields.toList()), id = null)
	private val games = IrField("games", IrType.ListOf(IrType.Ref("Mini.Domain.Game")))
	private val active = IrField("active", IrType.OptionOf(IrType.Ref("Mini.Domain.Game")))

	@Test
	fun `観測モデルは集約の列を 1 本の List で運ぶ`() {
		val k = Kotlinize(Ir("Mini", listOf(gameId, game, state(games)), emptyList(), emptyList(), emptyList()))
		assertEquals("games", k.rootCollectionOf(game)?.coll?.name)
	}

	@Test
	fun `Option のフィールドで個体を運ぶ観測モデルは理由付きで止まる`() {
		val k = Kotlinize(Ir("Mini", listOf(gameId, game, state(active, games)), emptyList(), emptyList(), emptyList()))
		val e = assertFailsWith<IllegalArgumentException> { k.rootCollectionOf(game) }
		assertTrue("1 本の List" in e.message!!, e.message)
		assertTrue("[active]" in e.message!!, e.message)
	}

	@Test
	fun `集約の列を 2 本持つ観測モデルも止まる`() {
		val finished = IrField("finished", IrType.ListOf(IrType.Ref("Mini.Domain.Game")))
		val k = Kotlinize(Ir("Mini", listOf(gameId, game, state(games, finished)), emptyList(), emptyList(), emptyList()))
		val e = assertFailsWith<IllegalArgumentException> { k.rootCollectionOf(game) }
		assertTrue("[games, finished]" in e.message!!, e.message)
	}

	@Test
	fun `集約ルートを Option で直接運ぶ UseCase の State は遷移テストの生成で止まる`(@TempDir out: Path) {
		val world = IrTypeDef(
			lean = "Mini.Application.SpeakUseCase.State", kotlin = "SpeakState", role = "repositoryState",
			module = "Mini.Application.UseCase.SpeakUseCase.UseCase",
			shape = IrShape.Structure(listOf(active, IrField("finished", IrType.Ref("Mini.Application.GameRepositoryState")))), id = null)
		val command = IrTypeDef(
			lean = "Mini.Application.SpeakUseCase.Command", kotlin = "SpeakCommand", role = "command",
			module = "Mini.Application.UseCase.SpeakUseCase.Command", shape = IrShape.Structure(listOf(IrField("word", IrType.Str))), id = null)
		val error = IrTypeDef(
			lean = "Mini.DomainError", kotlin = "DomainError", role = "error", module = "Mini.Domain.Error",
			shape = IrShape.Enum(listOf("wrongPhase")), id = null)
		val execute = IrMethod("execute", "", listOf(
			IrField("c", IrType.Ref("Mini.Application.SpeakUseCase.Command")),
			IrField("before", IrType.Ref("Mini.Application.SpeakUseCase.State"))),
			IrType.Result(IrType.Ref("Mini.DomainError"), IrType.Unit))
		val case = IrContractCase(
			kind = "transition", args = mapOf("c" to Json.parseToJsonElement("""{"word":"a"}""")), error = null,
			stateType = "Mini.Application.SpeakUseCase.State",
			before = Json.parseToJsonElement("""{"active":null,"finished":{"games":[]}}"""),
			after = Json.parseToJsonElement("""{"active":null,"finished":{"games":[]}}"""))
		val ir = Ir("Mini", listOf(gameId, game, state(games), world, command, error), emptyList(),
			listOf(IrService("SpeakUseCase", "SpeakUseCase", listOf(execute))), emptyList(),
			contracts = listOf(IrContract("usecase", "SpeakUseCase", "execute", "execute_ok", "", listOf(case))))
		val e = assertFailsWith<IllegalArgumentException> {
			EmitTests(ir, Kotlinize(ir), Output(out, "mini", "\t"), Output(out.resolve("adapter"), "mini", "\t"), emptyList()) {}.emitAll()
		}
		assertTrue("Mini.Application.SpeakUseCase.State.active" in e.message!!, e.message)
		assertTrue("Option / List / 単体で直接運ぶ形は読めない" in e.message!!, e.message)
	}

	@Test
	fun `集約ルートを単体のフィールドで直接運ぶ UseCase の State も止まる`(@TempDir out: Path) {
		val current = IrField("current", IrType.Ref("Mini.Domain.Game"))
		val world = IrTypeDef(
			lean = "Mini.Application.SpeakUseCase.State", kotlin = "SpeakState", role = "repositoryState",
			module = "Mini.Application.UseCase.SpeakUseCase.UseCase",
			shape = IrShape.Structure(listOf(current, IrField("finished", IrType.Ref("Mini.Application.GameRepositoryState")))), id = null)
		val ir = speakIr(world, before = """{"current":{"id":{"id":1},"closed":false},"finished":{"games":[]}}""")
		val e = assertFailsWith<IllegalArgumentException> {
			EmitTests(ir, Kotlinize(ir), Output(out, "mini", "\t"), Output(out.resolve("adapter"), "mini", "\t"), emptyList()) {}.emitAll()
		}
		assertTrue("Mini.Application.SpeakUseCase.State.current" in e.message!!, e.message)
		assertTrue("Option / List / 単体で直接運ぶ形は読めない" in e.message!!, e.message)
	}

	@Test
	fun `播種する個体があるのに Repository に add の根拠が無い契約は理由付きで止まる`(@TempDir out: Path) {
		// Game にファクトリのふるまいは無く、観測モデルにも add が無い(behaviors 無し)— 播種できない
		val ir = speakIr(state(games), before = """{"games":[{"id":{"id":1},"closed":false}]}""")
		val e = assertFailsWith<IllegalArgumentException> {
			EmitTests(ir, Kotlinize(ir), Output(out, "mini", "\t"), Output(out.resolve("adapter"), "mini", "\t"), emptyList()) {}.emitAll()
		}
		assertTrue("Mini.Domain.Game: 契約の State が個体を播種するが Repository に add が無い" in e.message!!, e.message)
	}

	/** SpeakUseCase の execute を 1 本の遷移契約で持つ最小 IR(before の型は stateTd)。 */
	private fun speakIr(stateTd: IrTypeDef, before: String): Ir {
		val command = IrTypeDef(
			lean = "Mini.Application.SpeakUseCase.Command", kotlin = "SpeakCommand", role = "command",
			module = "Mini.Application.UseCase.SpeakUseCase.Command", shape = IrShape.Structure(listOf(IrField("word", IrType.Str))), id = null)
		val error = IrTypeDef(
			lean = "Mini.DomainError", kotlin = "DomainError", role = "error", module = "Mini.Domain.Error",
			shape = IrShape.Enum(listOf("wrongPhase")), id = null)
		val execute = IrMethod("execute", "", listOf(
			IrField("c", IrType.Ref("Mini.Application.SpeakUseCase.Command")),
			IrField("before", IrType.Ref(stateTd.lean))),
			IrType.Result(IrType.Ref("Mini.DomainError"), IrType.Unit))
		val case = IrContractCase(
			kind = "transition", args = mapOf("c" to Json.parseToJsonElement("""{"word":"a"}""")), error = null,
			stateType = stateTd.lean, before = Json.parseToJsonElement(before), after = Json.parseToJsonElement(before))
		val observed = if (stateTd.lean == "Mini.Application.GameRepositoryState") listOf(stateTd) else listOf(state(games), stateTd)
		return Ir("Mini", listOf(gameId, game, command, error) + observed, emptyList(),
			listOf(IrService("SpeakUseCase", "SpeakUseCase", listOf(execute))), emptyList(),
			contracts = listOf(IrContract("usecase", "SpeakUseCase", "execute", "execute_ok", "", listOf(case))))
	}
}
