package lean2kotlin

import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.io.path.relativeTo
import kotlin.streams.asSequence
import kotlin.test.assertEquals
import kotlin.test.fail

/** 生成物のスナップショット(コミット済みの src/generated)との突き合わせ: ファイルの一覧と本文。 */
fun assertSnapshotMatches(snapshot: Path, generated: Path) {
	fun files(root: Path): List<String> =
		Files.walk(root).use { s ->
			s.asSequence().filter { Files.isRegularFile(it) }.map { it.relativeTo(root).toString() }.sorted().toList()
		}
	assertEquals(files(snapshot), files(generated))
	val diffs = files(snapshot).mapNotNull { rel ->
		val expected = snapshot.resolve(rel).readText()
		val actual = generated.resolve(rel).readText()
		if (expected == actual) null
		else "--- ${snapshot.fileName}/$rel\n+++ generated/$rel\n" + unifiedDiff(expected.lines(), actual.lines())
	}
	if (diffs.isNotEmpty()) fail(diffs.joinToString("\n"))
}

/** 行単位の最長共通部分列から unified diff(前後 3 行)を組む。 */
fun unifiedDiff(expected: List<String>, actual: List<String>): String {
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
