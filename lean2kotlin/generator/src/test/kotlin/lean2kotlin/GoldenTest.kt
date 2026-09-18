package lean2kotlin

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class GoldenTest {

	private val sproutGolden = testResources.resolve("sprout/golden")
	private val lobbyGolden = testResources.resolve("lobby/golden")

	private fun copy(dir: Path, vararg names: String) {
		for (n in names) Files.copy(sproutGolden.resolve(n), dir.resolve(n))
	}

	private fun copyLobby(dir: Path, vararg names: String) {
		for (n in names) Files.copy(lobbyGolden.resolve(n), dir.resolve(n))
	}

	// ---- 従来の形(init / flow 応答と cmd init の脇書き) ----

	@Test
	fun `init と flow の 2 本組から初期状態と trace の各エントリのスナップショットを読む`(@TempDir dir: Path) {
		copy(dir, "basic-init.json", "basic-flow.json")
		val g = Golden.load(dir)
		assertEquals(listOf("basic-init", "basic-flow #0", "basic-flow #1"), g.snapshots.map { it.source })
		assertTrue(g.snapshots.all { it.state.containsKey("notes") && it.views.containsKey("notes") })
		assertTrue(g.notes.isEmpty())
		assertTrue(g.errors.isEmpty())
	}

	@Test
	fun `従来の request json は note を出さず、スナップショットも変えない`(@TempDir dir: Path) {
		copy(dir, "basic-init.json", "basic-flow.json", "basic.request.json")
		val g = Golden.load(dir)
		assertEquals(3, g.snapshots.size)
		assertTrue(g.notes.isEmpty())
		assertTrue(g.errors.isEmpty())
		// 従来の golden は result / env / interactions を持たない
		assertTrue(g.snapshots.all { it.result == null && it.env == null && it.interactions.isEmpty() })
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

	// ---- 外部能力を使う形(cmd external の版 1 — 脇書きが版・環境・入力列を持つ) ----

	@Test
	fun `Lobby の外部能力 golden 6 本は脇書きを読み、refused と fault のエントリもスナップショットにする`() {
		val g = Golden.load(lobbyGolden)
		assertEquals(emptyList(), g.errors)
		assertEquals(emptyList(), g.notes)
		// init 6 + trace(visit 3 / payment 4 / payment-lost 5 / payment-fault 5 / payment-answer-lost 3 / payment-partial 2)
		assertEquals(28, g.snapshots.size)
		assertEquals(6, g.snapshots.count { it.source.endsWith("-init") })
		assertEquals(4, g.snapshots.count { it.result == "refused" })
		assertEquals(2, g.snapshots.count { it.result == "fault" })
		assertEquals(setOf("payment-fault-flow #1", "payment-answer-lost-flow #1"),
			g.snapshots.filter { it.result == "fault" }.map { it.source }.toSet())
		assertEquals(setOf("visit-flow #1", "payment-flow #3", "payment-lost-flow #2", "payment-fault-flow #2"),
			g.snapshots.filter { it.result == "refused" }.map { it.source }.toSet())
		// 名前は従来どおり <prefix>-init / <prefix>-flow #<i>。init の列が先、flow の列が後(どちらもファイル名順)
		assertEquals(listOf("visit-init", "visit-flow #0", "visit-flow #1", "visit-flow #2"),
			g.snapshots.filter { it.source.startsWith("visit") }.map { it.source })
		assertEquals(listOf("payment-answer-lost-init", "payment-fault-init", "payment-init", "payment-lost-init", "payment-partial-init", "visit-init"),
			g.snapshots.take(6).map { it.source })
		// 全スナップショットが state と views を持つ(refused / fault も)
		assertTrue(g.snapshots.all { it.state.isNotEmpty() && it.views.isNotEmpty() })
		// 初期状態のスナップショットは環境を運び、結果と往復は持たない
		val init = g.snapshots.first { it.source == "visit-init" }
		assertNull(init.result)
		assertEquals(1, (init.env as JsonObject).getValue("script").jsonArray.size)
		assertTrue(init.interactions.isEmpty())
		// trace の各エントリは result / env / interactions を運ぶ
		val booked = g.snapshots.first { it.source == "visit-flow #0" }
		assertEquals("applied", booked.result)
		assertNotNull(booked.env)
		assertEquals(1, booked.interactions.size)
		assertNull(booked.faultContract)
		// fault のエントリは指名した障害契約(name と portCalls)を運ぶ
		val fault = g.snapshots.first { it.source == "payment-answer-lost-flow #1" }
		assertEquals("fault", fault.result)
		assertEquals(1, fault.interactions.size)
		assertEquals(GoldenFaultContract("DispatchPaymentUseCase.sentNoAnswer", 1), fault.faultContract)
		assertEquals(GoldenFaultContract("DispatchPaymentUseCase.markedNotSent", 0),
			g.snapshots.first { it.source == "payment-fault-flow #1" }.faultContract)
		// 途中で止めた golden(脇書きの stopAt — ここでは解釈しない)も trace の分だけ読む
		assertEquals(listOf("applied", "applied"), g.snapshots.filter { it.source.startsWith("payment-partial-flow") }.map { it.result })
	}

	@Test
	fun `骨格の外部能力 golden(Port の無いモデル — script が空)も読める`(@TempDir dir: Path) {
		copy(dir, "external-init.json", "external-flow.json", "external.request.json")
		val g = Golden.load(dir)
		assertEquals(emptyList(), g.errors)
		assertTrue(g.notes.isEmpty())
		assertEquals(listOf("external-init", "external-flow #0", "external-flow #1", "external-flow #2"), g.snapshots.map { it.source })
		assertEquals(listOf(null, "applied", "refused", "applied"), g.snapshots.map { it.result })
		assertTrue(g.snapshots.all { it.interactions.isEmpty() })
		assertTrue((g.snapshots.first().env as JsonObject).getValue("script").jsonArray.isEmpty())
	}

	@Test
	fun `骨格の golden ディレクトリ全体(従来の形と外部能力の形の同居)は init の列、flow の列の順に読む`() {
		val g = Golden.load(sproutGolden)
		assertEquals(emptyList(), g.errors)
		assertTrue(g.notes.isEmpty())
		assertEquals(listOf("basic-init", "external-init", "basic-flow #0", "basic-flow #1", "external-flow #0", "external-flow #1", "external-flow #2"),
			g.snapshots.map { it.source })
	}

	// ---- 脇書きの版(経路に依らず、version があれば 1 だけを読む) ----

	@Test
	fun `脇書きの version が 1 でない外部能力 golden は error にして読まない`(@TempDir dir: Path) {
		copyLobby(dir, "visit-init.json", "visit-flow.json")
		dir.resolve("visit.request.json").writeText(
			lobbyGolden.resolve("visit.request.json").readText().replaceFirst("\"version\": 1", "\"version\": 2"))
		val g = Golden.load(dir)
		assertEquals(emptyList(), g.snapshots)
		assertTrue(g.notes.isEmpty())
		assertEquals(listOf("golden visit の脇書き visit.request.json の version 2 は読めない（読める版は 1）"), g.errors)
	}

	@Test
	fun `脇書きの version が 1 でなければ従来の形の golden でも error にする`(@TempDir dir: Path) {
		copy(dir, "basic-init.json", "basic-flow.json")
		dir.resolve("basic.request.json").writeText(
			sproutGolden.resolve("basic.request.json").readText().replaceFirst("{", "{\n  \"version\": 2,"))
		val g = Golden.load(dir)
		assertEquals(emptyList(), g.snapshots)
		assertTrue(g.notes.isEmpty())
		assertEquals(listOf("golden basic の脇書き basic.request.json の version 2 は読めない（読める版は 1）"), g.errors)
	}

	@Test
	fun `version の無い旧形式の脇書きは従来の形の golden に黙って許す`(@TempDir dir: Path) {
		copy(dir, "basic-init.json", "basic-flow.json", "basic.request.json")
		assertTrue("\"version\"" !in sproutGolden.resolve("basic.request.json").readText())
		val g = Golden.load(dir)
		assertEquals(listOf("basic-init", "basic-flow #0", "basic-flow #1"), g.snapshots.map { it.source })
		assertTrue(g.notes.isEmpty())
		assertTrue(g.errors.isEmpty())
	}

	@Test
	fun `version 1 で cmd init の脇書きは従来の形の印として読み、何も変えない`(@TempDir dir: Path) {
		copy(dir, "basic-init.json", "basic-flow.json")
		dir.resolve("basic.request.json").writeText(
			sproutGolden.resolve("basic.request.json").readText().replaceFirst("{", "{\n  \"version\": 1,"))
		val g = Golden.load(dir)
		assertEquals(listOf("basic-init", "basic-flow #0", "basic-flow #1"), g.snapshots.map { it.source })
		assertTrue(g.notes.isEmpty())
		assertTrue(g.errors.isEmpty())
		assertTrue(g.snapshots.all { it.result == null && it.env == null && it.interactions.isEmpty() })
	}

	@Test
	fun `version の無い旧形式の脇書きが cmd external を持つなら外部能力 golden の脇書き無しと同じ error にする`(@TempDir dir: Path) {
		copyLobby(dir, "visit-init.json", "visit-flow.json")
		dir.resolve("visit.request.json").writeText(
			lobbyGolden.resolve("visit.request.json").readText().replaceFirst(Regex("\"version\": 1,\\s*"), ""))
		// トップの version だけを消した(init / flow の中の version はリクエストの一部で、脇書きの版ではない)
		assertNull(Json.parseToJsonElement(dir.resolve("visit.request.json").readText()).jsonObject["version"])
		val g = Golden.load(dir)
		assertEquals(emptyList(), g.snapshots)
		assertEquals(listOf("外部能力を使う golden visit は visit.request.json（版・環境・入力列）が無いと再生できない"), g.errors)
	}

	// ---- 外部能力の golden に要るもの(脇書き・ok の応答・障害契約の指名) ----

	@Test
	fun `外部能力 golden に脇書きが無ければ error にして読まない`(@TempDir dir: Path) {
		copyLobby(dir, "visit-init.json", "visit-flow.json")
		val g = Golden.load(dir)
		assertEquals(emptyList(), g.snapshots)
		assertTrue(g.notes.isEmpty())
		assertEquals(listOf("外部能力を使う golden visit は visit.request.json（版・環境・入力列）が無いと再生できない"), g.errors)
	}

	@Test
	fun `脇書きがあれば外部能力かはその cmd で決まる(cmd init なら応答の形に依らず従来の形として読む)`(@TempDir dir: Path) {
		copyLobby(dir, "visit-init.json", "visit-flow.json")
		Files.copy(sproutGolden.resolve("basic.request.json"), dir.resolve("visit.request.json"))
		val g = Golden.load(dir)
		assertEquals(emptyList(), g.errors)
		assertTrue(g.notes.isEmpty())
		assertEquals(listOf("visit-init", "visit-flow #0", "visit-flow #1", "visit-flow #2"), g.snapshots.map { it.source })
	}

	@Test
	fun `外部能力 golden の flow 応答がトップに ok を持たなければ error にして読まない`(@TempDir dir: Path) {
		copyLobby(dir, "visit-init.json", "visit.request.json")
		dir.resolve("visit-flow.json").writeText("""{"harnessError": {"kind": "scriptExhausted", "cursor": 1}}""")
		val g = Golden.load(dir)
		assertEquals(emptyList(), g.snapshots)
		assertTrue(g.notes.isEmpty())
		assertEquals(listOf("外部能力を使う golden visit の visit-flow.json は ok の応答でない（harnessError）— 再生できない"), g.errors)
	}

	@Test
	fun `外部能力 golden の init 応答がトップに ok を持たなければ error にして読まない`(@TempDir dir: Path) {
		copyLobby(dir, "visit-flow.json", "visit.request.json")
		dir.resolve("visit-init.json").writeText("""{"error": "unknownScenario"}""")
		val g = Golden.load(dir)
		assertEquals(emptyList(), g.snapshots)
		assertTrue(g.notes.isEmpty())
		assertEquals(listOf("外部能力を使う golden visit の visit-init.json は ok の応答でない（error）— 再生できない"), g.errors)
	}

	@Test
	fun `従来の形の golden の ok でない応答は従来どおり note で無視する`(@TempDir dir: Path) {
		copy(dir, "basic-init.json")
		dir.resolve("basic-flow.json").writeText("""{"error": "unknownScenario"}""")
		val g = Golden.load(dir)
		assertEquals(listOf("basic-init"), g.snapshots.map { it.source })
		assertEquals(listOf("golden basic-flow.json: init/flow のどちらでもないため無視"), g.notes)
		assertTrue(g.errors.isEmpty())
	}

	@Test
	fun `fault のエントリが障害契約を指名していなければ error にする`(@TempDir dir: Path) {
		copyLobby(dir, "payment-fault-init.json", "payment-fault.request.json")
		dir.resolve("payment-fault-flow.json").writeText(
			lobbyGolden.resolve("payment-fault-flow.json").readText().replaceFirst("\"faultContract\"", "\"faultContractX\""))
		val g = Golden.load(dir)
		assertEquals(listOf("外部能力を使う golden payment-fault-flow #1 は fault のエントリなのに障害契約の指名 faultContract（name と portCalls）を持たない — 再生できない"), g.errors)
		// そのエントリだけを飛ばし、他は読む
		assertEquals(listOf("payment-fault-init", "payment-fault-flow #0", "payment-fault-flow #2", "payment-fault-flow #3", "payment-fault-flow #4"),
			g.snapshots.map { it.source })
	}

	// ---- 障害契約の突き合わせ(golden の faultContract と IR の障害契約) ----

	@Test
	fun `Lobby の fault のエントリ 2 つは IR の障害契約(名前と portCalls)と一致する`() {
		val g = Golden.load(lobbyGolden)
		assertEquals(2, g.snapshots.count { it.faultContract != null })
		assertEquals(emptyList(), Golden.checkFaults(g, lobbyIr()))
	}

	@Test
	fun `golden の portCalls が IR の障害契約と違えば error にする`(@TempDir dir: Path) {
		copyLobby(dir, "payment-answer-lost-init.json", "payment-answer-lost.request.json")
		dir.resolve("payment-answer-lost-flow.json").writeText(
			Regex("(\"name\": \"DispatchPaymentUseCase.sentNoAnswer\",\\s*\"portCalls\": )1")
				.replace(lobbyGolden.resolve("payment-answer-lost-flow.json").readText()) { it.groupValues[1] + "0" })
		val g = Golden.load(dir)
		assertEquals(emptyList(), g.errors)
		assertEquals(GoldenFaultContract("DispatchPaymentUseCase.sentNoAnswer", 0), g.snapshots.single { it.faultContract != null }.faultContract)
		assertEquals(listOf("golden payment-answer-lost-flow #1: 障害契約 DispatchPaymentUseCase.sentNoAnswer の portCalls が合わない — golden は 0、IR（Lean の署名）は 1"),
			Golden.checkFaults(g, lobbyIr()))
	}

	@Test
	fun `golden が指名した障害契約が IR に無ければ error にする`(@TempDir dir: Path) {
		copyLobby(dir, "payment-fault-init.json", "payment-fault.request.json")
		dir.resolve("payment-fault-flow.json").writeText(
			lobbyGolden.resolve("payment-fault-flow.json").readText().replaceFirst("DispatchPaymentUseCase.markedNotSent", "DispatchPaymentUseCase.neverSent"))
		val g = Golden.load(dir)
		assertEquals(emptyList(), g.errors)
		val errors = Golden.checkFaults(g, lobbyIr())
		assertEquals(1, errors.size, errors.toString())
		assertTrue(errors[0].startsWith("golden payment-fault-flow #1: 障害契約 DispatchPaymentUseCase.neverSent（portCalls 0）が IR の障害契約に無い（IR: "), errors[0])
		assertTrue("DispatchPaymentUseCase.markedNotSent" in errors[0], errors[0])
	}

	@Test
	fun `障害契約の突き合わせの error は生成の失敗に集まる`(@TempDir out: Path) {
		val notes = mutableListOf<String>()
		val snapshot = Golden.load(lobbyGolden).snapshots.first { it.source == "payment-fault-flow #1" }
			.copy(faultContract = GoldenFaultContract("DispatchPaymentUseCase.markedNotSent", 1))
		val e = assertFailsWith<IllegalStateException> {
			Lean2KotlinGeneration.generate(lobbyIr(), GoldenLoad(listOf(snapshot), emptyList()), "dev.cradle.lobby",
				out.resolve("main"), out.resolve("test"), out.resolve("adapter-test"), "\t") { notes += it.trim() }
		}
		val message = "golden payment-fault-flow #1: 障害契約 DispatchPaymentUseCase.markedNotSent の portCalls が合わない — golden は 1、IR（Lean の署名）は 0"
		assertTrue(message in e.message!!, e.message)
		assertTrue("error: $message" in notes, notes.toString())
	}

	@Test
	fun `再生できない golden は他の golden の読み取りを止めない`(@TempDir dir: Path) {
		copy(dir, "basic-init.json", "basic-flow.json")
		copyLobby(dir, "visit-init.json", "visit-flow.json")
		val g = Golden.load(dir)
		assertEquals(listOf("basic-init", "basic-flow #0", "basic-flow #1"), g.snapshots.map { it.source })
		assertEquals(1, g.errors.size)
	}

	@Test
	fun `golden の error は生成の失敗に集まる(生成は続き、最後に止まる)`(@TempDir out: Path) {
		val notes = mutableListOf<String>()
		val message = "外部能力を使う golden visit は visit.request.json（版・環境・入力列）が無いと再生できない"
		val e = assertFailsWith<IllegalStateException> {
			Lean2KotlinGeneration.generate(Ir.parse("""{"version":1,"rootNamespace":"T","types":[]}"""),
				GoldenLoad(emptyList(), listOf("a note"), listOf(message)), "t",
				out.resolve("main"), out.resolve("test"), out.resolve("adapter-test"), "\t") { notes += it.trim() }
		}
		assertTrue(message in e.message!!, e.message)
		assertTrue("error: $message" in notes, notes.toString())
		assertTrue("note: a note" in notes, notes.toString())
		assertTrue(notes.indexOf("error: $message") < notes.indexOfFirst { it.startsWith("生成完了") }, notes.toString())
	}
}
