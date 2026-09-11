package lean2kotlin

import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GoldenTest {

	private val sproutGolden = testResources.resolve("sprout/golden")

	private fun copy(dir: Path, vararg names: String) {
		for (n in names) Files.copy(sproutGolden.resolve(n), dir.resolve(n))
	}

	@Test
	fun `init と flow の 2 本組から初期状態と trace の各エントリのスナップショットを読む`(@TempDir dir: Path) {
		copy(dir, "basic-init.json", "basic-flow.json")
		val g = Golden.load(dir)
		assertEquals(listOf("basic-init", "basic-flow #0", "basic-flow #1"), g.snapshots.map { it.source })
		assertTrue(g.snapshots.all { it.state.containsKey("notes") && it.views.containsKey("notes") })
		assertTrue(g.notes.isEmpty())
	}

	@Test
	fun `request json は note を出さずに読み飛ばす`(@TempDir dir: Path) {
		copy(dir, "basic-init.json", "basic-flow.json", "basic.request.json")
		val g = Golden.load(dir)
		assertEquals(3, g.snapshots.size)
		assertTrue(g.notes.isEmpty())
	}

	@Test
	fun `init だけなら初期状態 1 件だけを読む`(@TempDir dir: Path) {
		copy(dir, "basic-init.json")
		val g = Golden.load(dir)
		assertEquals(listOf("basic-init"), g.snapshots.map { it.source })
		assertTrue(g.notes.isEmpty())
	}

	@Test
	fun `flow だけなら無視して note に出す`(@TempDir dir: Path) {
		copy(dir, "basic-flow.json")
		val g = Golden.load(dir)
		assertEquals(emptyList(), g.snapshots.map { it.source })
		assertEquals(listOf("golden basic-flow: 初期状態(basic-init.json)がないため無視"), g.notes)
	}

	@Test
	fun `壊れた JSON と init でも flow でもないファイルは note を出して無視する`(@TempDir dir: Path) {
		copy(dir, "basic-init.json")
		dir.resolve("broken-flow.json").writeText("{")
		dir.resolve("other.json").writeText("""{"ok":{}}""")
		val g = Golden.load(dir)
		assertEquals(listOf("basic-init"), g.snapshots.map { it.source })
		assertEquals(2, g.notes.size)
		assertTrue(g.notes.any { it.startsWith("golden broken-flow.json: JSON として読めないため無視") }, g.notes.toString())
		assertTrue("golden other.json: init/flow のどちらでもないため無視" in g.notes, g.notes.toString())
	}
}
