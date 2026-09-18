package lean2kotlin

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 骨格の IR に対する写像。 */
class KotlinizeTest {

	private val ir = sproutIr()
	private val k = Kotlinize(ir)

	private fun td(lean: String) = ir.typeDef(lean)
	private fun json(s: String) = Json.parseToJsonElement(s)

	private val noteId = "Sprout.Runtime.NoteId"
	private val userId = "Sprout.Runtime.UserId"
	private val note = "Sprout.Domain.Note"
	private val title = "Sprout.Title"
	private val noteView = "Sprout.Application.NoteView"
	private val domainError = "Sprout.DomainError"

	@Test
	fun `ident はキーワードと非識別子をバッククォートで囲む`() {
		assertEquals("note", ident("note"))
		assertEquals("`class`", ident("class"))
		assertEquals("`find?`", ident("find?"))
		assertEquals("`1st`", ident("1st"))
	}

	@Test
	fun `stringLit はドル記号と制御文字をエスケープする`() {
		assertEquals("\"a\\\$b\"", stringLit("a\$b"))
		assertEquals("\"q\\\"\\\\\"", stringLit("q\"\\"))
		assertEquals("\"\\n\\r\\t\"", stringLit("\n\r\t"))
		assertEquals("\"\\u0001\"", stringLit("\u0001"))
		assertEquals("\"買い出し\"", stringLit("買い出し"))
	}

	@Test
	fun `typeRef は IR の型を Kotlin の型に写す`() {
		assertEquals("Long", k.typeRef(IrType.Nat))
		assertEquals("String", k.typeRef(IrType.Str))
		assertEquals("Boolean", k.typeRef(IrType.Bool))
		assertEquals("Unit", k.typeRef(IrType.Unit))
		assertEquals("java.time.LocalDate", k.typeRef(IrType.Date))
		assertEquals("java.time.LocalDateTime", k.typeRef(IrType.DateTime))
		assertEquals("java.time.ZonedDateTime", k.typeRef(IrType.Zoned))
		assertEquals("java.util.UUID", k.typeRef(IrType.Uuid))
		assertEquals("List<Long>", k.typeRef(IrType.ListOf(IrType.Nat)))
		assertEquals("String?", k.typeRef(IrType.OptionOf(IrType.Str)))
		assertEquals("Pair<Long, String>", k.typeRef(IrType.PairOf(IrType.Nat, IrType.Str)))
		assertEquals("(NoteId) -> Long", k.typeRef(IrType.Arrow(IrType.Ref(noteId), IrType.Nat)))
		assertEquals("NoteId", k.typeRef(IrType.Ref(noteId)))
		assertEquals("Long", k.typeRef(IrType.WithDefault(IrType.Nat, kotlinx.serialization.json.JsonPrimitive(0))))
		assertEquals("DomainResult<DomainError, Unit>", k.typeRef(IrType.Result(IrType.Ref(domainError), IrType.Unit)))
	}

	@Test
	fun `1 フィールドの ValueObject は value class になる`() {
		assertTrue(k.isValueClass(td(noteId)))
		assertTrue(k.isValueClass(td(userId)))
		assertFalse(k.isValueClass(td(noteView)))
		assertFalse(k.isValueClass(td(domainError)))
	}

	@Test
	fun `literal は JSON を型に沿って Kotlin 式に写す`() {
		assertEquals("42L", k.literal(IrType.Nat, json("42")))
		assertEquals("\"a\"", k.literal(IrType.Str, json("\"a\"")))
		assertEquals("true", k.literal(IrType.Bool, json("true")))
		assertEquals("java.time.LocalDate.parse(\"2026-01-01\")", k.literal(IrType.Date, json("\"2026-01-01\"")))
		assertEquals("java.util.UUID.fromString(\"00000000-0000-0000-0000-000000000001\")",
			k.literal(IrType.Uuid, json("\"00000000-0000-0000-0000-000000000001\"")))
		assertEquals("null", k.literal(IrType.OptionOf(IrType.Str), JsonNull))
		assertEquals("\"x\"", k.literal(IrType.OptionOf(IrType.Str), json("\"x\"")))
		assertEquals("Pair(1L, \"a\")", k.literal(IrType.PairOf(IrType.Nat, IrType.Str), json("[1,\"a\"]")))
		assertEquals("listOf<NoteId>(NoteId(id = 0L), NoteId(id = 1L))",
			k.literal(IrType.ListOf(IrType.Ref(noteId)), json("[{\"id\":0},{\"id\":1}]")))
	}

	@Test
	fun `refLiteral は Id を value class と enum と structure の構築式に写す`() {
		assertEquals("NoteId(id = 0L)", k.refLiteral(td(noteId), json("{\"id\":0}")))
		assertEquals("DomainError.NotAuthor", k.refLiteral(td(domainError), json("\"notAuthor\"")))
		assertEquals(
			"NoteView(id = NoteId(id = 0L), author = UserId(id = 1L), title = \"買い出し\", closed = false)",
			k.refLiteral(td(noteView),
				json("""{"id":{"id":0},"author":{"id":1},"title":"買い出し","closed":false}""")))
	}

	@Test
	fun `entity-like のリテラルは fixture 語彙で構築する`() {
		assertEquals(
			"NoteFixture(id = NoteId(id = 0L), author = UserId(id = 1L), title = TitleFixture(text = \"買い出し\"), closed = false)",
			k.refLiteral(td(note),
				json("""{"id":{"id":0},"author":{"id":1},"title":{"text":"買い出し"},"closed":false}""")))
		assertEquals("listOf<NoteFixture>()", k.literal(IrType.ListOf(IrType.Ref(note)), json("[]")))
	}

	@Test
	fun `packagePathOf は Lean のディレクトリ構成を小文字のパッケージに写す`() {
		assertEquals("domain.valueobject", k.packagePathOf(td(noteId)))
		assertEquals("runtime", k.packagePathOf(td(userId)))
		assertEquals("domain.entity", k.packagePathOf(td(note)))
		assertEquals("domain.valueobject", k.packagePathOf(td(title)))
		assertEquals("domain", k.packagePathOf(td(domainError)))
		assertEquals("application", k.packagePathOf(td("Sprout.Application.NoteRow")))
		assertEquals("application.usecase.notesusecase", k.packagePathOf(td("Sprout.Application.NotesUseCase.ReadModel")))
		assertEquals("domain.repository", k.repositoryPackage)
		assertEquals("application.usecase.notesusecase", k.useCasePackage("NotesUseCase"))
	}

	@Test
	fun `isEntityLike は集約ルートとインスタンスふるまいを持つ VO に成り立つ`() {
		assertTrue(k.isEntityLike(td(note)))
		assertTrue(k.isEntityLike(td(title)))
		assertFalse(k.isEntityLike(td(noteId)))
		assertFalse(k.isEntityLike(td(userId)))
		assertFalse(k.isEntityLike(td(noteView)))
	}

	@Test
	fun `reachesEntityLike は Title を運ぶ Row に成り立ち View には成り立たない`() {
		assertTrue(k.reachesEntityLike(IrType.Ref("Sprout.Application.NoteRow")))
		assertTrue(k.reachesEntityLike(IrType.ListOf(IrType.Ref(note))))
		assertFalse(k.reachesEntityLike(IrType.Ref(noteView)))
		assertTrue(k.fixtureBridged.isEmpty())
	}

	@Test
	fun `fountainPorts は NoteIdGeneratorState から NoteId を供給する NoteIdGenerator を導く`() {
		val ports = k.fountainPorts()
		assertEquals(1, ports.size)
		assertEquals("NoteIdGenerator", ports.single().port)
		assertEquals("NoteIdGeneratorState", ports.single().stateTd.kotlin)
		assertEquals("NoteId", ports.single().idTd.kotlin)
	}

	@Test
	fun `repoOps は Note に findById と add と update を許す`() {
		assertEquals(Kotlinize.RepoOps(find = true, add = true, update = true), k.repoOps(td(note)))
	}

	@Test
	fun `ふるまいは主体を取るものと主体を作るものに仕分けられる`() {
		assertEquals(listOf("isOpen", "close"), k.instanceMethodsOf(td(note)).map { it.name })
		assertEquals(listOf("post"), k.factoryMethodsOf(td(note)).map { it.name })
		assertEquals(listOf("valid"), k.instanceMethodsOf(td(title)).map { it.name })
		assertEquals("id", k.idFieldName(td(note)))
	}

	@Test
	fun `arbOf は同一性を持つ個体の列で id を重複させない`() {
		assertEquals("Arb.long(0L..4096L)", k.arbOf(IrType.Nat))
		assertEquals("Arb.long(0L..4096L).orNull(0.2)", k.arbOf(IrType.OptionOf(IrType.Nat)))
		assertEquals("arbNoteId()", k.arbOf(IrType.Ref(noteId)))
		assertEquals("Arb.list(arbNote(), 0..5).map { xs -> xs.distinctBy { x -> x.id } }",
			k.arbOf(IrType.ListOf(IrType.Ref(note))))
		assertEquals("Arb.list(arbNoteView(), 0..5)", k.arbOf(IrType.ListOf(IrType.Ref(noteView))))
	}

	@Test
	fun `rootCollectionOf は Note の観測モデルと集約の列のフィールドを引く`() {
		val rc = k.rootCollectionOf(td(note))
		assertEquals("Sprout.Application.NoteRepositoryState", rc?.state?.lean)
		assertEquals("notes", rc?.coll?.name)
		assertEquals(null, k.rootCollectionOf(td(title)))
	}

	@Test
	fun `constraintKeysOf は観測モデルの制約を集約のフィールドへ解決する`() {
		val rc = k.rootCollectionOf(td(note))!!
		val keys = k.constraintKeysOf(rc.state, rc.coll)
		assertEquals(listOf("uniqueIds", "uniqueTitles"), keys.map { it.constraint.name })
		assertEquals(listOf("id", "title"), keys.map { it.field.name })
		assertTrue(k.constraintKeysOf(td(note), (td(note).shape as IrShape.Structure).fields.first()).isEmpty())
	}

	@Test
	fun `arbOfField は同一性の制約を二重に掛けず、listArb は宣言された制約で間引く`() {
		val rc = k.rootCollectionOf(td(note))!!
		assertEquals("Arb.list(arbNote(), 0..5).map { xs -> xs.distinctBy { x -> x.id }.distinctBy { x -> x.title } }",
			k.arbOfField(rc.state, rc.coll))
		val listT = IrType.ListOf(IrType.Ref(note))
		val closedKey = Kotlinize.ConstraintKey(
			IrConstraint("unique", "uniqueClosed", "notes", "closed"),
			(td(note).shape as IrShape.Structure).fields.single { it.name == "closed" })
		assertEquals(
			"Arb.list(arbNote(), size).map { xs -> xs.distinctBy { x -> x.id }.distinctBy { x -> x.closed } }",
			k.listArb(listT, listOf(closedKey), "size"))
	}

	@Test
	fun `constrainExpr は uniqueSome を値のある要素だけの初出に写す`() {
		val nameKey = Kotlinize.ConstraintKey(
			IrConstraint("uniqueSome", "uniqueNames", "rooms", "name"),
			IrField("name", IrType.OptionOf(IrType.Ref(title))))
		assertEquals(
			"xs.let { ys -> val seen = HashSet<TitleFixture>(); ys.filter { x -> x.name == null || seen.add(x.name) } }",
			k.constrainExpr("xs", listOf(nameKey)))
	}

	@Test
	fun `constrainExpr は all と atMost の述語を要素のフィールド型のリテラルで写す`() {
		val closed = (td(note).shape as IrShape.Structure).fields.single { it.name == "closed" }
		val titleField = (td(note).shape as IrShape.Structure).fields.single { it.name == "title" }
		val allOpen = Kotlinize.ConstraintKey(
			IrConstraint("all", "allOpen", "notes", "closed", op = "eq", value = json("false")), closed)
		val atMostOneUntitled = Kotlinize.ConstraintKey(
			IrConstraint("atMost", "atMostOneUntitled", "notes", "title", op = "eq", value = json("{\"text\":\"\"}"), max = 1), titleField)
		val allTitled = Kotlinize.ConstraintKey(
			IrConstraint("all", "allTitled", "notes", "title", op = "ne", value = json("{\"text\":\"\"}")), titleField)
		// = c は値を写す(引き直しに頼らない)、≠ c は間引く(ほぼ全部が満たす)
		assertEquals("xs.map { x -> x.copy(closed = false) }", k.constrainExpr("xs", listOf(allOpen)))
		assertEquals("xs.filter { x -> x.title != TitleFixture(text = \"\") }", k.constrainExpr("xs", listOf(allTitled)))
		assertEquals(
			"xs.let { ys -> var k = 0L; ys.filter { x -> !(x.title == TitleFixture(text = \"\")) || k++ < 1L } }",
			k.constrainExpr("xs", listOf(atMostOneUntitled)))
		assertEquals("allOpen: 全件 closed = false", k.constraintDoc(allOpen))
		assertEquals("atMostOneUntitled: title = {\"text\":\"\"} は高々 1 件", k.constraintDoc(atMostOneUntitled))
	}

	@Test
	fun `collecting は参照した型と Arb と fixture を集める`() {
		val (_, c) = k.collecting {
			k.typeRef(IrType.Ref(noteId))
			k.arbOf(IrType.Ref(noteView))
			k.fixtureName(td(note))
		}
		assertEquals(setOf(noteId), c.refs)
		assertEquals(setOf("NoteView"), c.arbs)
		assertEquals(setOf(note), c.fixtures)
	}
}
