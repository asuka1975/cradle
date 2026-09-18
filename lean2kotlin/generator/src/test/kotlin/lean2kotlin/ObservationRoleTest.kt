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
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 内部入力(役割 observation)の生成: 相関 Id だけを運ぶ Observation でも本番署名に残り、
 * 名義の無い契約テストのフックになり、Repository の findById の根拠になり、ふるまい・Arb は出ない。
 */
class ObservationRoleTest {

	private fun ir(): Ir {
		val base = Json.parseToJsonElement(testResources.resolve("unique-name/ir.json").readText()).jsonObject
		val observation = Json.parseToJsonElement("""{"lean":"Mini.Application.CloseRoomUseCase.Observation","kotlin":"CloseRoomObservation","role":"observation","module":"Mini.Application.UseCase.CloseRoomUseCase.Observation",
			"shape":{"kind":"structure","fields":[{"name":"room","type":{"k":"ref","name":"Mini.Runtime.RoomId"}}]}}""")
		val state = Json.parseToJsonElement("""{"lean":"Mini.Application.CloseRoomUseCase.State","kotlin":"CloseRoomState","role":"repositoryState","module":"Mini.Application.UseCase.CloseRoomUseCase.UseCase",
			"shape":{"kind":"structure","fields":[{"name":"rooms","type":{"k":"ref","name":"Mini.Application.RoomRepositoryState"}}]}}""")
		val useCase = Json.parseToJsonElement("""{"name":"CloseRoomUseCase","module":"CloseRoomUseCase","kind":"observation","input":"Mini.Application.CloseRoomUseCase.Observation","methods":[
			{"name":"execute","doc":"","params":[{"name":"o","type":{"k":"ref","name":"Mini.Application.CloseRoomUseCase.Observation"}},{"name":"before","type":{"k":"ref","name":"Mini.Application.CloseRoomUseCase.State"}}],"ret":{"k":"result","err":{"k":"ref","name":"Mini.DomainError"},"ok":{"k":"unit"}}}]}""")
		val contract = Json.parseToJsonElement("""{"target":"usecase","useCase":"CloseRoomUseCase","method":"execute","theorem":"execute_unknown","doc":"部屋が無ければ断る。","cases":[
			{"kind":"transition","stateType":"Mini.Application.CloseRoomUseCase.State","args":{"o":{"room":{"id":91}}},"before":{"rooms":{"rooms":[]}},"after":{"rooms":{"rooms":[]}},"error":"nameTaken"}]}""")
		val behaviors = JsonArray(base.getValue("behaviors").jsonArray + Json.parseToJsonElement("""{"subject":"Mini.Application.CloseRoomUseCase.Observation","module":"Mini.Application.UseCase.CloseRoomUseCase.Observation","methods":[
			{"name":"valid","doc":"","params":[{"name":"o","type":{"k":"ref","name":"Mini.Application.CloseRoomUseCase.Observation"}}],"ret":{"k":"bool"}}]}"""))
		return Ir.parse(JsonObject(base + mapOf(
			"types" to JsonArray(base.getValue("types").jsonArray + observation + state),
			"useCases" to JsonArray(listOf(useCase)), "contracts" to JsonArray(listOf(contract)), "behaviors" to behaviors)).toString())
	}

	@Test
	fun `useCases の kind と input を読む`() {
		val s = ir().useCases.single()
		assertEquals("observation", s.kind)
		assertEquals("Mini.Application.CloseRoomUseCase.Observation", s.input)
		assertEquals("command", Ir.parse(testResources.resolve("unique-name/ir.json").readText()).let { IrService.parse(Json.parseToJsonElement("""{"name":"X","module":"X","methods":[]}""")) }.kind)
	}

	@Test
	fun `相関 Id だけの Observation は本番署名に残り、契約テストのフックに名義は無く、findById の根拠になる`(@TempDir out: Path) {
		val ir = ir()
		val k = Kotlinize(ir)
		assertTrue(k.repoOps(ir.typeDef("Mini.Domain.Room")).find)
		Lean2KotlinGeneration.generate(ir, GoldenLoad(emptyList(), emptyList()), "t",
			out.resolve("main"), out.resolve("test"), out.resolve("adapter-test"), "\t") {}
		val iface = out.resolve("main/application/usecase/closeroomusecase/CloseRoomUseCase.kt").readText()
		assertTrue("fun execute(o: CloseRoomObservation): DomainResult<DomainError, Unit>" in iface, iface)
		val test = out.resolve("test/application/usecase/closeroomusecase/CloseRoomUseCaseContractTest.kt").readText()
		assertTrue("protected abstract fun useCase(roomRepository: RoomRepository): CloseRoomUseCase" in test, test)
		assertTrue("useCase.execute(o = CloseRoomObservation(room = RoomId(id = 91L)))" in test, test)
		// 入力語彙のふるまいは本番に出ず、Arb も出ない
		assertTrue(!out.resolve("main/application/usecase/closeroomusecase/CloseRoomObservationBehaviors.kt").toFile().exists())
		assertTrue("arbCloseRoomObservation" !in out.resolve("test/GeneratedArbs.kt").readText())
	}
}
