package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * 骨格の IR と golden を通した生成の全体を、scaffold-check の src/generated
 * (生成器の出力の実物スナップショット)と突き合わせる。
 */
class GenerationTest {

	private val snapshot: Path = Path.of("../scaffold-check/src/generated")

	private fun generate(out: Path): List<String> {
		val golden = Golden.load(testResources.resolve("sprout/golden"))
		val notes = mutableListOf<String>()
		Lean2KotlinGeneration.generate(
			sproutIr(), golden, "dev.cradle.scaffold",
			out.resolve("kotlin-main"), out.resolve("kotlin-test"), out.resolve("kotlin-adapter-test"), "\t") { notes += it.trim() }
		return notes.filter { it.startsWith("note: ") }
	}

	@Test
	fun `生成されるファイルの一覧と本文は scaffold-check の src generated と一致する`(@TempDir out: Path) {
		generate(out)
		assertSnapshotMatches(snapshot, out)
	}

	@Test
	fun `note の集合は既知の集合と一致する`(@TempDir out: Path) {
		val expected = setOf(
			"note: 泉ポート(泉ごとの IdGenerator ポート): NoteIdGenerator(供給: NoteId)",
			"note: NoteRepositoryState: State のふるまいは Kotlin に写さない(Lean 側の意味論装置)",
			"note: NoteRow: 本番語彙が entity-like へ到達するため Arb は生成しない(View→ドメイン語彙の壁)",
			"note: Retrieve テスト: ReadModel 1 種 — golden+射影定理で 7 ケース",
			"note: 契約定理テスト: CloseNoteUseCase — 定理 4 本から 14 ケース(遷移形 — Repository 直参照)",
			"note: NotesUseCase.execute: 引数を合成できないため basic-init をスキップ",
			"note: NotesUseCase.execute: 引数を合成できないため basic-flow #0 をスキップ",
			"note: NotesUseCase.execute: 引数を合成できないため basic-flow #1 をスキップ",
			"note: 契約テスト: NotesUseCase — golden+定理で 12 ケース(参照系)",
			"note: 契約定理テスト: PostNoteUseCase — 定理 3 本から 10 ケース(遷移形 — Repository 直参照)",
			"note: 契約定理テスト: Note(Entity)— 定理 5 本から 20 ケース",
			"note: 契約定理テスト: Title(Entity)— 定理 1 本から 4 ケース",
		)
		val notes = generate(out)
		assertEquals(expected, notes.toSet())
		assertEquals(expected.size, notes.size, "同じ note が重複している: $notes")
	}
}
