package lean2kotlin

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 型・Port・障害契約・Port の操作の名前から組むテスト側の識別子(実体化フック・Port のモックの変数と期待の型・
 * 障害注入フック・Adapter の arrange フック)は ident を通す — 先頭を小文字にすると Kotlin のキーワードになる名前や
 * プライム付きの Lean の名前でも、本番側(Repository の引数)と同じくバッククォートで囲んで宣言と呼び出しを揃える。
 * 素材は Sprout と Lobby の名前を、参照を揃えたまま差し替えたもの。
 */
class KeywordNameTest {

	/** JSON の中の文字列値を names に従ってすべて差し替える(名前の参照を揃えたまま改名する)。 */
	private fun rename(j: JsonElement, names: Map<String, String>): JsonElement = when (j) {
		is JsonObject -> JsonObject(j.mapValues { (_, v) -> rename(v, names) })
		is JsonArray -> JsonArray(j.map { rename(it, names) })
		is JsonPrimitive -> if (j.isString && j.content in names) JsonPrimitive(names.getValue(j.content)) else j
	}

	/** 改名した IR から生成したテストの全ファイルを連ねた本文。 */
	private fun emitRenamed(resource: String, names: Map<String, String>, out: Path): String {
		val ir = Ir.parse(rename(Json.parseToJsonElement(testResources.resolve(resource).readText()), names).toString())
		EmitTests(ir, Kotlinize(ir), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) {}.emitAll()
		return Files.walk(out).use { s -> s.filter { it.toString().endsWith(".kt") }.sorted().toList() }
			.joinToString("\n") { it.readText() }
	}

	@Test
	fun `先頭を小文字にするとキーワードになる集約の実体化フックは、宣言・播種・レシーバでバッククォートで囲む`(@TempDir out: Path) {
		val text = emitRenamed("sprout/sprout-ir.json", mapOf("Note" to "Package", "NoteRepositoryState" to "PackageRepositoryState"), out)
		assertTrue("\tprotected abstract fun `package`(fixture: PackageFixture): Package\n" in text, text)
		assertTrue("\t\tpackageRepository.add(`package`(PackageFixture(" in text, text)
		assertTrue("\t\t\t`package`(PackageFixture(id = " in text, text)
		assertFalse(Regex("(?<![`\\w.])package\\((fixture|PackageFixture)").containsMatchIn(text), text)
	}

	@Test
	fun `キーワードになる VO と Port、プライム付きの障害契約の名前もバッククォートで囲む`(@TempDir out: Path) {
		val text = emitRenamed("lobby/lobby-ir.json",
			mapOf("VisitorName" to "Interface", "OrganizationDirectory" to "Object", "savingFailed" to "savingFailed'"), out)
		// 実体化フックの宣言とコマンドの入力・定理のレシーバ
		assertTrue("\tprotected abstract fun `interface`(fixture: InterfaceFixture): Interface\n" in text, text)
		assertTrue("`interface`(InterfaceFixture(text = " in text, text)
		assertFalse(Regex("(?<![`\\w.])interface\\((fixture|InterfaceFixture)").containsMatchIn(text), text)
		// Port のモックの変数: 実装フックの仮引数・ケースの配線・消費の検査
		assertTrue(", `object`: Object" in text, text)
		assertTrue("\t\tval `object` = ObjectMock(" in text, text)
		assertTrue("\t\t`object`.assertComplete()" in text, text)
		assertFalse(Regex("(?<![`\\w])object( = |\\.assert|: Object)").containsMatchIn(text), text)
		// 障害注入フック
		assertTrue("\tprotected abstract fun `faultedSavingFailed'`(" in text, text)
		assertTrue("\t\tval useCase = `faultedSavingFailed'`(" in text, text)
	}

	@Test
	fun `プライム付きの Port の操作の arrange フックとモックの期待の型はバッククォートで囲む`(@TempDir out: Path) {
		val lobby = lobbyIr()
		val tests = EmitTests(lobby, Kotlinize(lobby), Output(out, "t", "\t"), Output(out.resolve("adapter"), "t", "\t"), emptyList()) {}
		val port = lobby.ports.single { it.name == "OrganizationDirectory" }
		val text = tests.portAdapterTestBody(port.copy(operations = port.operations.map { it.copy(method = it.method + "'") }))
		assertTrue("\tprotected abstract fun `arrangeFindMember'Found`(): OrganizationDirectoryFindMemberRequest\n" in text, text)
		assertTrue("\t\tval request = `arrangeFindMember'Found`()\n" in text, text)
		// モックの期待の型: 宣言・型検査・遷移契約と障害契約のケースの構築
		val all = emitRenamed("lobby/lobby-ir.json", mapOf("findMember" to "findMember'"), out.resolve("renamed"))
		assertTrue("\tdata class `FindMember'`(" in all, all)
		assertTrue("if (next !is `FindMember'`)" in all, all)
		assertTrue("OrganizationDirectoryMock.`FindMember'`(request = " in all, all)
		assertFalse(Regex("(?<!`)FindMember'\\(|is FindMember'").containsMatchIn(all), all)
	}
}
