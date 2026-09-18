package lean2kotlin

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * 「宣言したのに検査に至らない」を生成の失敗にする: 抽出器の診断(dropped)、生成テストが 0 件の契約、
 * 閉じていない Port の型。note(生成が続いた情報)とは分ける。
 */
class DiagnosticsTest {

	private fun run(irText: String, out: Path): Pair<Throwable, List<String>> {
		val notes = mutableListOf<String>()
		val e = assertFailsWith<IllegalStateException> {
			Lean2KotlinGeneration.generate(Ir.parse(irText), GoldenLoad(emptyList(), emptyList()), "t",
				out.resolve("main"), out.resolve("test"), out.resolve("adapter-test"), "\t") { notes += it.trim() }
		}
		return e to notes
	}

	@Test
	fun `抽出器が落とした契約は生成を失敗にする`(@TempDir out: Path) {
		val (e, notes) = run("""{"version":1,"rootNamespace":"T","types":[],
			"diagnostics":{"dropped":[{"kind":"contract","name":"T.Application.X.act_appends","reason":"主対象に触れない"}]}}""", out)
		assertTrue("contract T.Application.X.act_appends: 主対象に触れない" in e.message!!, e.message)
		assertTrue(notes.any { it.startsWith("error: contract T.Application.X.act_appends") }, notes.toString())
		// 抽出器の診断は生成の前に出る — 生成の途中で止まっても読める
		assertTrue(notes.indexOfFirst { it.startsWith("error: ") } < notes.indexOfFirst { it.startsWith("生成完了") }, notes.toString())
	}

	@Test
	fun `生成テストが 0 件の契約(観測モデルのふるまいの定理)は生成を失敗にする`(@TempDir out: Path) {
		val ir = testResources.resolve("unique-name/ir.json").readText().trimEnd().removeSuffix("}") +
			""","contracts":[{"target":"behaviors","useCase":"Mini.Application.RoomRepositoryState","method":"ids","theorem":"act_ids","doc":"","cases":[{"kind":"pure","args":{},"ok":[]}]}]}"""
		val (e, _) = run(ir, out)
		assertTrue("契約定理 Mini.Application.RoomRepositoryState.act_ids(behaviors): 生成テストが 0 件" in e.message!!, e.message)
	}

	@Test
	fun `Port の要求が interface 化された語彙を運ぶと生成を失敗にする`(@TempDir out: Path) {
		val base = Json.parseToJsonElement(testResources.resolve("unique-name/ir.json").readText()).jsonObject
		val request = Json.parseToJsonElement("""{"lean":"Mini.Application.Port.Ledger.Record.Request","kotlin":"LedgerRecordRequest","role":"portRequest","module":"Mini.Application.Port.Ledger.Record",
			"shape":{"kind":"structure","fields":[{"name":"room","type":{"k":"ref","name":"Mini.Domain.Room"}}]}}""")
		val outcome = Json.parseToJsonElement("""{"lean":"Mini.Application.Port.Ledger.Record.Outcome","kotlin":"LedgerRecordOutcome","role":"portOutcome","module":"Mini.Application.Port.Ledger.Record",
			"shape":{"kind":"enum","ctors":["done"]}}""")
		val ports = Json.parseToJsonElement("""[{"name":"Ledger","layer":"application","module":"Mini.Application.Port.Ledger","operations":[{"name":"Record","method":"record",
			"request":"Mini.Application.Port.Ledger.Record.Request","outcome":"Mini.Application.Port.Ledger.Record.Outcome","doc":""}]}]""")
		val ir = JsonObject(base + mapOf("types" to JsonArray(base.getValue("types").jsonArray + request + outcome), "ports" to ports))
		val (e, _) = run(ir.toString(), out)
		assertTrue("Port Ledger.record: Mini.Application.Port.Ledger.Record.Request が interface 化された語彙" in e.message!!, e.message)
	}

	@Test
	fun `泉の状態に対応する Id 型が無いと生成を失敗にする`(@TempDir out: Path) {
		val base = Json.parseToJsonElement(testResources.resolve("unique-name/ir.json").readText()).jsonObject
		val gen = Json.parseToJsonElement("""{"lean":"Mini.Application.FooIdGeneratorState","kotlin":"FooIdGeneratorState","role":"repositoryState","module":"Mini.Application.RepositoryState",
			"shape":{"kind":"structure","fields":[{"name":"next","type":{"k":"nat"}}]}}""")
		val ir = JsonObject(base + mapOf("types" to JsonArray(base.getValue("types").jsonArray + gen)))
		val (e, _) = run(ir.toString(), out)
		assertTrue("泉の状態 Mini.Application.FooIdGeneratorState に対応する Id 型 FooId がありません" in e.message!!, e.message)
	}

	@Test
	fun `内部入力が名義を運ぶと生成を失敗にする`(@TempDir out: Path) {
		val base = Json.parseToJsonElement(testResources.resolve("unique-name/ir.json").readText()).jsonObject
		val actor = Json.parseToJsonElement("""{"lean":"Mini.Application.ActorContext","kotlin":"ActorContext","role":"actorPort","module":"Mini.Application.ActorContext",
			"shape":{"kind":"structure","fields":[{"name":"user","type":{"k":"ref","name":"Mini.Runtime.MemberId"}}]}}""")
		val observation = Json.parseToJsonElement("""{"lean":"Mini.Application.CloseRoomUseCase.Observation","kotlin":"CloseRoomObservation","role":"observation","module":"Mini.Application.UseCase.CloseRoomUseCase.Observation",
			"shape":{"kind":"structure","fields":[{"name":"by","type":{"k":"ref","name":"Mini.Application.ActorContext"}}]}}""")
		val ir = JsonObject(base + mapOf("types" to JsonArray(base.getValue("types").jsonArray + actor + observation)))
		val (e, _) = run(ir.toString(), out)
		assertTrue("内部入力 Mini.Application.CloseRoomUseCase.Observation が名義(@[actorContext])を運んでいる" in e.message!!, e.message)
	}

	@Test
	fun `Port の観測が構成子の引数や入れ子の中で関数型を運ぶと生成を失敗にする`(@TempDir out: Path) {
		val base = Json.parseToJsonElement(testResources.resolve("unique-name/ir.json").readText()).jsonObject
		val request = Json.parseToJsonElement("""{"lean":"Mini.Application.Port.Ledger.Record.Request","kotlin":"LedgerRecordRequest","role":"portRequest","module":"Mini.Application.Port.Ledger.Record",
			"shape":{"kind":"structure","fields":[{"name":"amount","type":{"k":"nat"}}]}}""")
		// inductive の構成子の引数が関数(`| callback (f : Nat → Nat)`)
		val outcome = Json.parseToJsonElement("""{"lean":"Mini.Application.Port.Ledger.Record.Outcome","kotlin":"LedgerRecordOutcome","role":"portOutcome","module":"Mini.Application.Port.Ledger.Record",
			"shape":{"kind":"sealed","ctors":[{"name":"done","fields":[]},{"name":"callback","fields":[{"name":"f","type":{"k":"arrow","from":{"k":"nat"},"to":{"k":"nat"}}}]}]}}""")
		val ports = Json.parseToJsonElement("""[{"name":"Ledger","layer":"application","module":"Mini.Application.Port.Ledger","operations":[{"name":"Record","method":"record",
			"request":"Mini.Application.Port.Ledger.Record.Request","outcome":"Mini.Application.Port.Ledger.Record.Outcome","doc":""}]}]""")
		val ir = JsonObject(base + mapOf("types" to JsonArray(base.getValue("types").jsonArray + request + outcome), "ports" to ports))
		val (e, _) = run(ir.toString(), out)
		assertTrue("Port Ledger.record: Mini.Application.Port.Ledger.Record.Outcome が関数型を運ぶ" in e.message!!, e.message)
		// structure の要求が Option の中に関数を持つ(`f : Option (Nat → Nat)`)
		val nested = Json.parseToJsonElement("""{"lean":"Mini.Application.Port.Ledger.Record.Request","kotlin":"LedgerRecordRequest","role":"portRequest","module":"Mini.Application.Port.Ledger.Record",
			"shape":{"kind":"structure","fields":[{"name":"f","type":{"k":"option","of":{"k":"arrow","from":{"k":"nat"},"to":{"k":"nat"}}}}]}}""")
		val plain = Json.parseToJsonElement("""{"lean":"Mini.Application.Port.Ledger.Record.Outcome","kotlin":"LedgerRecordOutcome","role":"portOutcome","module":"Mini.Application.Port.Ledger.Record",
			"shape":{"kind":"enum","ctors":["done"]}}""")
		val ir2 = JsonObject(base + mapOf("types" to JsonArray(base.getValue("types").jsonArray + nested + plain), "ports" to ports))
		val (e2, _) = run(ir2.toString(), out.resolve("nested"))
		assertTrue("Port Ledger.record: Mini.Application.Port.Ledger.Record.Request が関数型を運ぶ" in e2.message!!, e2.message)
	}
}
