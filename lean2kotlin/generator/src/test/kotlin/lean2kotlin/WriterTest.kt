package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WriterTest {

	@Test
	fun `cleanGenerated は GENERATED ヘッダ付きの kt だけ消し手書きは残す`(@TempDir dir: Path) {
		val out = Output(dir, "p", "\t")
		out.file("a.b", "Gen", body = "class Gen")
		dir.resolve("a/b/Hand.kt").writeText("class Hand\n")
		dir.resolve("c").createDirectories()
		dir.resolve("c/Stale.kt").writeText("$GENERATED_HEADER\npackage p.c\n")
		dir.resolve("c/notes.txt").writeText("$GENERATED_HEADER\n")

		out.cleanGenerated()

		assertFalse(Files.exists(dir.resolve("a/b/Gen.kt")))
		assertFalse(Files.exists(dir.resolve("c/Stale.kt")))
		assertTrue(Files.exists(dir.resolve("a/b/Hand.kt")))
		assertTrue(Files.exists(dir.resolve("c/notes.txt")))
	}

	@Test
	fun `cleanGenerated は空になったディレクトリを片付ける`(@TempDir dir: Path) {
		val out = Output(dir, "p", "\t")
		out.file("a.b", "Gen", body = "class Gen")
		out.cleanGenerated()
		assertFalse(Files.exists(dir.resolve("a")))
		assertTrue(Files.isDirectory(dir))
	}

	@Test
	fun `file はヘッダとパッケージと整列したインポートを書き、タブを設定のインデントに置き換える`(@TempDir dir: Path) {
		val out = Output(dir, "p", "    ")
		out.file("a", "Gen", imports = listOf("z.Z", "a.A", "z.Z"), body = "class Gen {\n\tval x = 1\n}\n\n")
		assertEquals(
			"""
			|$GENERATED_HEADER
			|// 再生成で全上書きされます。実装はこのファイルではなく別ファイルに書いてください。
			|
			|package p.a
			|
			|import a.A
			|import z.Z
			|
			|class Gen {
			|    val x = 1
			|}
			|""".trimMargin(),
			dir.resolve("a/Gen.kt").readText())
		assertEquals(listOf(dir.resolve("a/Gen.kt")), out.report())
	}
}
