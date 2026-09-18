package lean2kotlin

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlin.io.path.readText

class IrParseTest {

	private fun json(s: String) = Json.parseToJsonElement(s)

	@Test
	fun `version と rootNamespace と types だけの JSON が通る`() {
		val ir = Ir.parse("""{"version":1,"rootNamespace":"T","types":[]}""")
		assertEquals("T", ir.rootNamespace)
		assertTrue(ir.types.isEmpty())
		assertTrue(ir.useCases.isEmpty())
		assertTrue(ir.queryServices.isEmpty())
		assertTrue(ir.domainServices.isEmpty())
		assertTrue(ir.contracts.isEmpty())
		assertTrue(ir.faultContracts.isEmpty())
		assertTrue(ir.behaviors.isEmpty())
	}

	@Test
	fun `version が 1 でなければ失敗する`() {
		assertFailsWith<IllegalArgumentException> {
			Ir.parse("""{"version":2,"rootNamespace":"T","types":[]}""")
		}
	}

	@Test
	fun `IrType の各 k を対応する型に読む`() {
		val expected = mapOf(
			"""{"k":"nat"}""" to IrType.Nat,
			"""{"k":"string"}""" to IrType.Str,
			"""{"k":"bool"}""" to IrType.Bool,
			"""{"k":"unit"}""" to IrType.Unit,
			"""{"k":"date"}""" to IrType.Date,
			"""{"k":"datetime"}""" to IrType.DateTime,
			"""{"k":"zoned"}""" to IrType.Zoned,
			"""{"k":"list","of":{"k":"nat"}}""" to IrType.ListOf(IrType.Nat),
			"""{"k":"option","of":{"k":"string"}}""" to IrType.OptionOf(IrType.Str),
			"""{"k":"pair","fst":{"k":"nat"},"snd":{"k":"bool"}}""" to IrType.PairOf(IrType.Nat, IrType.Bool),
			"""{"k":"arrow","from":{"k":"ref","name":"T.Id"},"to":{"k":"nat"}}""" to
				IrType.Arrow(IrType.Ref("T.Id"), IrType.Nat),
			"""{"k":"ref","name":"T.Note"}""" to IrType.Ref("T.Note"),
			"""{"k":"withDefault","of":{"k":"nat"},"default":3}""" to
				IrType.WithDefault(IrType.Nat, JsonPrimitive(3)),
			"""{"k":"result","err":{"k":"ref","name":"T.E"},"ok":{"k":"unit"}}""" to
				IrType.Result(IrType.Ref("T.E"), IrType.Unit),
		)
		for ((src, t) in expected) assertEquals(t, IrType.parse(json(src)), src)
	}

	@Test
	fun `未知の k は失敗する`() {
		assertFailsWith<IllegalStateException> { IrType.parse(json("""{"k":"float"}""")) }
	}

	@Test
	fun `wire が uuid の 1 フィールド Id は中身を Uuid に読み替える`() {
		val td = IrTypeDef.parse(json("""
			{"lean":"T.NoteId","kotlin":"NoteId","role":"valueObject","isId":true,"wire":"uuid",
			 "shape":{"kind":"structure","fields":[{"name":"id","type":{"k":"string"}}]}}
		""".trimIndent()))
		assertEquals(IrShape.Structure(listOf(IrField("id", IrType.Uuid))), td.shape)
		assertEquals("uuid", td.wire)
	}

	@Test
	fun `constraints は all と atMost の述語と上限を読む`() {
		val td = IrTypeDef.parse(json("""
			{"lean":"T.GameRepositoryState","kotlin":"GameRepositoryState","role":"repositoryState",
			 "shape":{"kind":"structure","fields":[{"name":"games","type":{"k":"list","of":{"k":"ref","name":"T.Game"}}}]},
			 "constraints":[{"kind":"all","name":"allArchived","collection":"games","field":"archived","op":"eq","value":true},
			                {"kind":"atMost","name":"atMostOneActive","collection":"games","field":"phase","op":"ne","value":"finished","max":1}]}
		""".trimIndent()))
		assertEquals(
			listOf(
				IrConstraint("all", "allArchived", "games", "archived", op = "eq", value = JsonPrimitive(true)),
				IrConstraint("atMost", "atMostOneActive", "games", "phase", op = "ne", value = JsonPrimitive("finished"), max = 1)),
			td.constraints)
	}

	@Test
	fun `constraints は unique と uniqueSome を読み、無ければ空`() {
		val td = IrTypeDef.parse(json("""
			{"lean":"T.RoomRepositoryState","kotlin":"RoomRepositoryState","role":"repositoryState",
			 "shape":{"kind":"structure","fields":[{"name":"rooms","type":{"k":"list","of":{"k":"ref","name":"T.Room"}}}]},
			 "constraints":[{"kind":"unique","name":"uniqueIds","collection":"rooms","field":"id"},
			                {"kind":"uniqueSome","name":"uniqueNames","collection":"rooms","field":"name"}]}
		""".trimIndent()))
		assertEquals(
			listOf(IrConstraint("unique", "uniqueIds", "rooms", "id"), IrConstraint("uniqueSome", "uniqueNames", "rooms", "name")),
			td.constraints)
		assertTrue(IrTypeDef.parse(json("""
			{"lean":"T.Q","kotlin":"Q","role":"viewDto","shape":{"kind":"structure","fields":[]}}
		""".trimIndent())).constraints.isEmpty())
	}

	@Test
	fun `骨格の IR は NoteRepositoryState に uniqueIds と uniqueTitles の制約を持つ`() {
		val ir = sproutIr()
		assertEquals(
			listOf(IrConstraint("unique", "uniqueIds", "notes", "id"), IrConstraint("unique", "uniqueTitles", "notes", "title")),
			ir.typeDef("Sprout.Application.NoteRepositoryState").constraints)
		assertTrue(ir.types.filter { it.lean != "Sprout.Application.NoteRepositoryState" }.all { it.constraints.isEmpty() })
	}

	@Test
	fun `骨格の IR は types 17 と useCases 3 と queryServices 1 と contracts 17 と behaviors 3 を持つ`() {
		val ir = sproutIr()
		assertEquals("Sprout", ir.rootNamespace)
		assertEquals(17, ir.types.size)
		assertEquals(
			mapOf(
				"actorPort" to 1, "command" to 2, "repositoryState" to 3, "readModelRow" to 1,
				"viewDto" to 3, "readModel" to 1, "error" to 2, "aggregateRoot" to 1, "valueObject" to 3),
			ir.types.groupingBy { it.role }.eachCount())
		assertEquals(3, ir.useCases.size)
		assertEquals(1, ir.queryServices.size)
		assertEquals(17, ir.contracts.size)
		assertEquals(3, ir.behaviors.size)
		assertTrue(ir.ports.isEmpty())
		assertTrue(ir.dropped.isEmpty())
		assertEquals(listOf("projection"), ir.contracts.filter { it.theorem == "noteRows_ids" }.map { it.target })
		assertTrue(ir.domainServices.isEmpty())
		assertTrue(ir.faultContracts.isEmpty())
	}

	@Test
	fun `domainServices はサービスごとに name と module と methods を読む`() {
		val ir = Ir.parse(testResources.resolve("domain-services/ir.json").readText())
		assertEquals(listOf("DomainService", "PricingService", "TaxService"), ir.domainServices.map { it.name })
		assertEquals(listOf("DomainService", "Pricing", "Tax"), ir.domainServices.map { it.module })
		assertEquals(listOf("cheaper", "decidePricing", "tax"), ir.domainServices.flatMap { s -> s.methods.map { it.name } })
	}

	@Test
	fun `Lobby の IR は Port と UseCase の対応と契約ケースの要求・観測を持つ`() {
		val ir = lobbyIr()
		assertEquals("Lobby", ir.rootNamespace)
		val port = ir.port("OrganizationDirectory")
		assertEquals("Lobby.Application.Port.OrganizationDirectory", port.module)
		assertEquals(listOf("findMember"), port.operations.map { it.method })
		assertEquals("Lobby.Application.Port.OrganizationDirectory.FindMember.Request", port.operations.single().request)
		assertEquals(
			mapOf("portRequest" to 3, "portOutcome" to 3, "portDto" to 1),
			ir.types.filter { it.role.startsWith("port") }.groupingBy { it.role }.eachCount())
		// 決済ゲートウェイは 2 操作を持ち、配送と照会が別の操作に対応する
		assertEquals(listOf("authorize", "inquire"), ir.port("PaymentGateway").operations.map { it.method })
		assertEquals(listOf(IrUseCasePort("PaymentGateway", "authorize")), ir.useCases.single { it.name == "DispatchPaymentUseCase" }.ports)
		assertEquals(listOf(IrUseCasePort("PaymentGateway", "inquire")), ir.useCases.single { it.name == "InquirePaymentUseCase" }.ports)
		// 入力の種別: 利用者の Command と内部入力の Observation
		assertEquals(mapOf("BookVisitUseCase" to "command", "ConfirmPaymentUseCase" to "observation", "DispatchPaymentUseCase" to "observation",
			"InquirePaymentUseCase" to "observation", "LeaveUseCase" to "command", "StartPaymentUseCase" to "command"),
			ir.useCases.associate { it.name to it.kind })
		assertEquals("Lobby.Application.DispatchPaymentUseCase.Observation", ir.useCases.single { it.name == "DispatchPaymentUseCase" }.input)
		assertEquals(3, ir.types.count { it.role == "observation" })
		assertEquals("OrganizationDirectoryFindMemberRequest", ir.typeDef(port.operations.single().request).kotlin)
		val book = ir.useCases.single { it.name == "BookVisitUseCase" }
		assertEquals(listOf(IrUseCasePort("OrganizationDirectory", "findMember")), book.ports)
		assertTrue(ir.useCases.single { it.name == "LeaveUseCase" }.ports.isEmpty())
		val rejected = ir.contracts.single { it.theorem == "execute_empty_visitor" }.cases.first().ports.single()
		assertEquals(null, rejected.request)
		val missing = ir.contracts.single { it.theorem == "execute_host_missing" }.cases.first().ports.single()
		assertEquals(json("""{"employee":{"id":4}}"""), missing.request)
		assertEquals(JsonPrimitive("missing"), missing.outcome)
		assertEquals(listOf("DomainService", "PricingService", "TaxService"), ir.domainServices.map { it.name })
		val fault = ir.faultContracts.single { it.useCase == "BookVisitUseCase" }
		assertEquals("savingFailed", fault.def)
		assertEquals(1, fault.portCalls)
		assertTrue(fault.cases.all { c -> c.ports.single().request != null && c.before == c.after }, fault.cases.toString())
		// 消費位置は観測を引数に取るかどうか: 送る前の中断は 0、応答を得た後の中断は 1。Port を使わない UseCase は 0
		assertEquals(mapOf("appliedNotCommitted" to 1, "markedNotSent" to 0, "sentNoAnswer" to 1),
			ir.faultContracts.filter { it.useCase == "DispatchPaymentUseCase" }.associate { it.def to it.portCalls })
		assertEquals(0, ir.faultContracts.single { it.useCase == "StartPaymentUseCase" }.portCalls)
		// 送る前の中断でも「呼ばれるはずだった要求」はケースに載る(呼ばれないことをモックが検査する)
		assertTrue(ir.faultContracts.single { it.def == "markedNotSent" }.cases.all { it.ports.single().request != null })
		assertEquals("atMost", ir.typeDef("Lobby.Application.VisitRepositoryState").constraints.single { it.name == "atMostOneExpected" }.kind)
		assertTrue(ir.dropped.isEmpty())
	}

	@Test
	fun `diagnostics の dropped と ports は無ければ空`() {
		val ir = Ir.parse("""{"version":1,"rootNamespace":"T","types":[],"diagnostics":{"dropped":[{"kind":"contract","name":"T.x","reason":"r"}]}}""")
		assertEquals(listOf(IrDropped("contract", "T.x", "r")), ir.dropped)
		assertTrue(ir.ports.isEmpty())
	}
}
