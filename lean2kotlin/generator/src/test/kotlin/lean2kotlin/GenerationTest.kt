package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.io.path.relativeTo
import kotlin.streams.asSequence
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * 骨格の IR と golden を通した生成の全体を、scaffold-check の src/generated
 * (生成器の出力の実物スナップショット)と突き合わせる。
 */
class GenerationTest {

	private val snapshot: Path = Path.of("../scaffold-check/src/generated")

	private class Run(val out: Path, val notes: List<String>)

	private fun generate(out: Path): Run {
		val golden = Golden.load(testResources.resolve("sprout/golden"))
		val notes = mutableListOf<String>()
		Lean2KotlinGeneration.generate(
			sproutIr(), golden, "dev.cradle.scaffold",
			out.resolve("kotlin-main"), out.resolve("kotlin-test"), "\t") { notes += it.trim() }
		return Run(out, notes.filter { it.startsWith("note: ") })
	}

	private fun files(root: Path): List<Path> =
		Files.walk(root).use { s ->
			s.asSequence().filter { Files.isRegularFile(it) }.map { it.relativeTo(root) }.sorted().toList()
		}

	@Test
	fun `生成されるファイルの一覧は scaffold-check の src generated と一致する`(@TempDir out: Path) {
		val run = generate(out)
		assertEquals(files(snapshot).map { it.toString() }, files(run.out).map { it.toString() })
	}

	@Test
	fun `生成された各ファイルの本文は scaffold-check の同名ファイルと一致する`(@TempDir out: Path) {
		val run = generate(out)
		val diffs = files(snapshot).mapNotNull { rel ->
			val expected = snapshot.resolve(rel).readText()
			val actual = run.out.resolve(rel).readText()
			if (expected == actual) null
			else "--- scaffold-check/src/generated/$rel\n+++ generated/$rel\n" +
				unifiedDiff(expected.lines(), actual.lines())
		}
		if (diffs.isNotEmpty()) fail(diffs.joinToString("\n"))
	}

	@Test
	fun `note の集合は既知の集合と一致する`(@TempDir out: Path) {
		val expected = setOf(
			"note: 泉ポート(泉ごとの IdGenerator ポート): NoteIdGenerator(供給: NoteId)",
			"note: NoteRepositoryState: State のふるまいは Kotlin に写さない(Lean 側の意味論装置)",
			"note: NoteRow: 本番語彙が entity-like へ到達するため Arb は生成しない(View→ドメイン語彙の壁)",
			"note: Retrieve テスト: ReadModel 1 種 — golden+射影定理で 3 ケース",
			"note: 契約定理テスト: CloseNoteUseCase — 定理 4 本から 14 ケース(遷移形 — Repository 直参照)",
			"note: NotesUseCase.execute: 引数を合成できないため basic-init をスキップ",
			"note: NotesUseCase.execute: 引数を合成できないため basic-flow #0 をスキップ",
			"note: NotesUseCase.execute: 引数を合成できないため basic-flow #1 をスキップ",
			"note: 契約テスト: NotesUseCase — golden+定理で 12 ケース(参照系)",
			"note: 契約定理テスト: PostNoteUseCase — 定理 2 本から 8 ケース(遷移形 — Repository 直参照)",
			"note: 契約定理テスト: Note(Entity)— 定理 6 本から 24 ケース",
			"note: 契約定理テスト: Title(Entity)— 定理 1 本から 4 ケース",
		)
		val run = generate(out)
		assertEquals(expected, run.notes.toSet())
		assertEquals(expected.size, run.notes.size, "同じ note が重複している: ${run.notes}")
	}

	/** 行単位の最長共通部分列から unified diff(前後 3 行)を組む。 */
	private fun unifiedDiff(expected: List<String>, actual: List<String>): String {
		val n = expected.size
		val m = actual.size
		val lcs = Array(n + 1) { IntArray(m + 1) }
		for (i in n - 1 downTo 0) for (j in m - 1 downTo 0) {
			lcs[i][j] = if (expected[i] == actual[j]) lcs[i + 1][j + 1] + 1
				else maxOf(lcs[i + 1][j], lcs[i][j + 1])
		}
		val ops = mutableListOf<Pair<Char, String>>()
		var i = 0
		var j = 0
		while (i < n || j < m) {
			when {
				i < n && j < m && expected[i] == actual[j] -> { ops += ' ' to expected[i]; i++; j++ }
				i < n && (j == m || lcs[i + 1][j] >= lcs[i][j + 1]) -> { ops += '-' to expected[i]; i++ }
				else -> { ops += '+' to actual[j]; j++ }
			}
		}
		val changed = ops.indices.filter { ops[it].first != ' ' }
		val sb = StringBuilder()
		var c = 0
		while (c < changed.size) {
			val start = maxOf(0, changed[c] - 3)
			var end = changed[c]
			while (c + 1 < changed.size && changed[c + 1] - end <= 6) { c++; end = changed[c] }
			val slice = ops.subList(start, minOf(ops.size, end + 4))
			val oldStart = ops.subList(0, start).count { it.first != '+' } + 1
			val newStart = ops.subList(0, start).count { it.first != '-' } + 1
			sb.append("@@ -$oldStart,${slice.count { it.first != '+' }} +$newStart,${slice.count { it.first != '-' }} @@\n")
			for ((tag, line) in slice) sb.append(tag).append(line).append('\n')
			c++
		}
		return sb.toString()
	}
}
