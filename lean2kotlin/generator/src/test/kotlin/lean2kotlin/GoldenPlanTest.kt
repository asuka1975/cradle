package lean2kotlin

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** golden 回帰の対象の計画(planGoldenTargets)— IR と golden のスナップショットだけから決まる。 */
class GoldenPlanTest {

	private val sprout = sproutIr()
	private val notes = "NotesUseCase"
	private val queryError = "Sprout.Application.QueryError"
	private val noteView = "Sprout.Application.NoteView"

	private fun execute(ir: Ir, useCase: String) =
		ir.useCases.single { it.name == useCase }.methods.single { it.name == "execute" }

	/** views だけを持つスナップショット(計画は状態を見ない)。 */
	private fun snap(vararg keys: String) =
		GoldenSnapshot(keys.joinToString(","), JsonObject(emptyMap()), JsonObject(keys.associateWith { JsonArray(emptyList()) }))

	/** Sprout に束ね DTO NotesScreen(fields の名前の View の列)を足し、NotesUseCase.execute の成功側をそれにする。 */
	private fun sproutWithScreen(vararg fields: String): Ir {
		val screen = IrTypeDef("Sprout.Application.NotesScreen", "NotesScreen", "viewDto",
			IrShape.Structure(fields.map { IrField(it, IrType.ListOf(IrType.Ref(noteView))) }), null,
			module = "Sprout.Application.View")
		return sprout.withUseCases(sprout.types + screen) { m ->
			if (m.name == "execute") m.copy(ret = IrType.Result(IrType.Ref(queryError), IrType.Ref(screen.lean))) else m
		}
	}

	private fun Ir.withUseCases(types: List<IrTypeDef> = this.types, method: (IrMethod) -> IrMethod) =
		Ir(rootNamespace, types, queryServices,
			useCases.map { s -> if (s.name == notes) s.copy(methods = s.methods.map(method)) else s },
			domainServices, useCaseRules, contracts, faultContracts, behaviors, ports, dropped)

	@Test
	fun `Sprout の golden では NotesUseCase の execute が画面キー notes の対象になる`() {
		val plan = planGoldenTargets(sprout, Golden.load(testResources.resolve("sprout/golden")).snapshots)
		assertEquals(mapOf(notes to GoldenTarget(execute(sprout, notes), "notes")), plan)
	}

	@Test
	fun `対象は views のキーの順でなく ir の UseCase の順に並ぶ`() {
		val mini = miniIr()
		val loaded = planGoldenTargets(mini, Golden.load(testResources.resolve("mini/golden")).snapshots)
		assertEquals(listOf("CatalogUseCase" to "catalog", "LoansUseCase" to "loans", "ShelfUseCase" to "shelf"),
			loaded.map { (name, t) -> name to t.screenKey })
		val reversed = planGoldenTargets(mini, listOf(snap("shelf", "catalog")))
		assertEquals(listOf("CatalogUseCase", "ShelfUseCase"), reversed.keys.toList())
		assertEquals(execute(mini, "ShelfUseCase"), reversed.getValue("ShelfUseCase").method)
	}

	@Test
	fun `スナップショットが無いか views がどれも空なら対象は無い`() {
		assertTrue(planGoldenTargets(sprout, emptyList()).isEmpty())
		assertTrue(planGoldenTargets(sprout, listOf(snap(), snap())).isEmpty())
	}

	@Test
	fun `計画の基準は views を持つ最初のスナップショットだけで、後のスナップショットのキーは見ない`() {
		assertEquals(listOf(notes), planGoldenTargets(sprout, listOf(snap(), snap("notes"))).keys.toList())
		assertTrue(planGoldenTargets(sprout, listOf(snap(), snap("other"), snap("notes"))).isEmpty())
	}

	@Test
	fun `成功側が views のキーを束ねる DTO なら画面キーより先に束の対象になり、キーが欠ければ画面の対象に戻る`() {
		val bundled = sproutWithScreen("notes")
		assertEquals(mapOf(notes to GoldenTarget(execute(bundled, notes), null)),
			planGoldenTargets(bundled, listOf(snap("notes"))))
		val partial = sproutWithScreen("notes", "drafts")
		assertEquals(mapOf(notes to GoldenTarget(execute(partial, notes), "notes")),
			planGoldenTargets(partial, listOf(snap("notes"))))
	}

	@Test
	fun `対象は execute だけで、名前の違うメソッドが View を返しても選ばない`() {
		val renamed = sprout.withUseCases { m -> if (m.name == "execute") m.copy(name = "run") else m }
		assertTrue(planGoldenTargets(renamed, listOf(snap("notes"))).isEmpty())
	}
}
