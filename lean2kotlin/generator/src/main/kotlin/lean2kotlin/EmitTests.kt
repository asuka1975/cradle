package lean2kotlin

import kotlinx.serialization.json.*

/**
 * test ソースの生成。すべて「interface に対する契約テスト」— 抽象クラスで、
 * 実装の供給(useCase() / repository() / 実体化フック)だけをサブクラス(AI が書く)に要求する。
 * 期待値は IR に焼き込まれた Lean 評価結果(@[contract] / @[faultContract])と golden。
 * 配置は対象と同じパッケージ。fixture と Arb はルートに置く。note は log に流す。
 */
class EmitTests(
	private val ir: Ir,
	private val k: Kotlinize,
	private val out: Output,
	/** Port の Adapter の適合テストの置き場(build の門に入らない source set adapterTest)。 */
	private val adapterOut: Output,
	private val goldenSnapshots: List<GoldenSnapshot>,
	private val log: (String) -> Unit,
) {

	private val junitImports = listOf(
		"org.junit.jupiter.api.Test",
		"org.junit.jupiter.api.Assertions.assertEquals")
	private val pbtImports = listOf(
		"kotlinx.coroutines.runBlocking",
		"io.kotest.property.PropTestConfig",
		"io.kotest.property.checkAll")

	/** 生成テストが 1 件でも出た契約(`target/useCase/theorem`、障害契約は `fault/useCase/def`)。
	    宣言した契約が検査に至ったかを Runner が突き合わせる。 */
	val emittedContracts = linkedSetOf<String>()

	fun contractKey(c: IrContract): String = "${c.target}/${c.useCase}/${c.theorem}"
	fun faultKey(fc: IrFaultContract): String = "fault/${fc.useCase}/${fc.def}"

	fun emitAll() {
		if (ir.types.any { k.isEntityLike(it) }) {
			emitFile(null, "GeneratedFixtures") { fixturesBody() }
		}
		if (ir.ports.isNotEmpty()) {
			emitFile(null, "PortHarnessFailure") { portHarnessFailureBody }
			for (p in ir.ports) emitFile(k.portPackage(p), k.portMockName(p),
				framework = listOf("${out.basePackage}.PortHarnessFailure")) { portMockBody(p) }
			for (p in ir.ports) emitFile(k.portPackage(p), "${p.name}AdapterContractTest",
				framework = junitImports + "org.junit.jupiter.api.Assertions.assertTrue", target = adapterOut) { portAdapterTestBody(p) }
		}
		emitFile(null, "GeneratedArbs",
			framework = listOf("io.kotest.property.Arb", "io.kotest.property.arbitrary.*")) { arbsBody() }
		for (td in ir.types.filter { it.role == "aggregateRoot" }) emitRepositoryContractTest(td)
		// golden 回帰の対象(参照系)を集める — emit は定理由来のケースと同じ
		// <UseCase>ContractTest に束ねる(emitTheoremContractTests が担う)
		val goldenPlan = linkedMapOf<String, Pair<IrMethod, String?>>()
		if (goldenSnapshots.isNotEmpty()) {
			for (s in ir.useCases) {
				for (m in s.methods.filter { it.name == "execute" }) {
					val okT = (m.ret as? IrType.Result)?.ok ?: m.ret
					val v0 = goldenSnapshots.first().views
					// 対象 1(束): 成功側が「画面束ね」DTO(フィールドが golden views のキーと一致)。
					// 束が Runtime 在住のプロジェクトでは現れない(Runtime は抽出の対象外)
					val retTd = (okT as? IrType.Ref)?.let { ir.typeDef(it.lean) }
					val fields = (retTd?.shape as? IrShape.Structure)?.fields
					if (retTd?.role == "viewDto" && !fields.isNullOrEmpty() &&
						fields.all { v0.containsKey(it.name) }) {
						goldenPlan[s.name] = m to null
						continue
					}
					// 対象 2(画面): golden views のキー = UseCase 名(UseCase 接尾辞を
					// 剥いで先頭小文字)で、成功側が View DTO を運ぶ
					val key = s.module.removeSuffix("UseCase").replaceFirstChar { it.lowercase() }
					if (v0.containsKey(key) && okT.leafRefs().any {
							ir.typeDef(it).role == "viewDto" })
						goldenPlan[s.name] = m to key
				}
			}
		}
		emitDdlContractTest(ir.contracts.filter { it.target == "projection" })
		emitTheoremContractTests(goldenPlan)
		emitFaultContractTests()
	}

	// ───────────────────────── fixture(Entity interface の data class 実装)

	/** フィールド値の観測正規化(実装型 → fixture)のサフィックス。
	    State は fixture の入れ物(フィールドが fixture 型)なので対象外。
	    橋渡し型(entity-like を運ぶ sealed / VO 構造)も toFixture で正規化する。 */
	private fun fixtureNorm(t: IrType): String = when (t) {
		is IrType.Ref ->
			if (k.isEntityLike(ir.typeDef(t.lean)) || k.isFixtureBridged(t.lean)) ".toFixture()" else ""
		is IrType.ListOf ->
			if (fixtureNorm(t.of).isNotEmpty()) ".map { it${fixtureNorm(t.of)} }" else ""
		is IrType.OptionOf ->
			if (fixtureNorm(t.of).isNotEmpty()) "?${fixtureNorm(t.of)}" else ""
		is IrType.WithDefault -> fixtureNorm(t.of)
		else -> ""
	}

	/** 入力位置の実引数リテラル: Entity / VO は実体化フック経由(fixture → 実装)、
	    Command・入力語彙(data class)は ctor 直書きで再帰(VO の葉だけフック)。 */
	private fun inputLiteral(t: IrType, j: JsonElement): String = when (t) {
		is IrType.Ref -> {
			val td = ir.typeDef(t.lean)
			if (k.isEntityLike(td)) "${decapitalizeFirst(td.kotlin)}(${k.refLiteral(td, j)})"
			else inputRefLiteral(td, j)
		}
		is IrType.ListOf ->
			"listOf<${k.typeRef(t.of)}>(${j.jsonArray.joinToString(", ") { inputLiteral(t.of, it) }})"
		is IrType.OptionOf -> if (j is JsonNull) "null" else inputLiteral(t.of, j)
		is IrType.WithDefault -> inputLiteral(t.of, j)
		else -> k.literal(t, j)
	}

	/** 入力位置の参照リテラル: data class(Command 等)はフィールドを inputLiteral で
	    再帰構築(内側の Entity / VO は実体化フックに写る)。それ以外は fixture 語彙。 */
	private fun inputRefLiteral(td: IrTypeDef, j: JsonElement): String = when (val shape = td.shape) {
		is IrShape.Structure ->
			// UUID ワイヤの Id: JSON は canonical UUID 文字列そのもの
			if (td.wire == "uuid" && shape.fields.size == 1) k.refLiteral(td, j)
			else if (shape.fields.isEmpty()) k.name(td.lean)
			else {
				val o = j.jsonObject
				val args = shape.fields.joinToString(", ") { f ->
					"${ident(f.name)} = ${inputLiteral(f.type, o.getValue(f.name))}"
				}
				"${k.name(td.lean)}($args)"
			}
		is IrShape.Sealed -> {
			// 入力位置は**本番語彙**で構築する(橋渡し型でも fixture に写さない —
			// entity-like の葉だけ実体化フック経由。refLiteral は fixture 語彙なので使わない)
			if (j is JsonPrimitive) {
				val ctor = shape.ctors.find { it.name == j.content }
					?: error("${td.lean}: 不明なコンストラクタ ${j.content}")
				"${k.name(td.lean)}.${k.ctorClassName(ctor.name)}"
			} else {
				val o = j.jsonObject
				val (name, body) = o.entries.single()
				val ctor = shape.ctors.find { it.name == name }
					?: error("${td.lean}: 不明なコンストラクタ $name")
				if (ctor.fields.isEmpty()) "${k.name(td.lean)}.${k.ctorClassName(name)}"
				else {
					val bo = body.jsonObject
					val args = ctor.fields.joinToString(", ") { f ->
						"${ident(f.name)} = ${inputLiteral(f.type, bo.getValue(f.name))}"
					}
					"${k.name(td.lean)}.${k.ctorClassName(name)}($args)"
				}
			}
		}
		else -> k.refLiteral(td, j)
	}

	/** 既定値のリテラル(静的語彙のレシーバ用の最小 fixture)。 */
	private fun defaultLiteral(t: IrType): String? = when (t) {
		IrType.Nat -> "0L"
		IrType.Str -> "\"\""
		IrType.Bool -> "false"
		IrType.Uuid -> "java.util.UUID(0L, 0L)"
		IrType.Date -> "java.time.LocalDate.ofEpochDay(0L)"
		IrType.DateTime -> "java.time.LocalDateTime.ofEpochSecond(0L, 0, java.time.ZoneOffset.UTC)"
		is IrType.ListOf -> "emptyList()"
		is IrType.OptionOf -> "null"
		is IrType.WithDefault -> defaultLiteral(t.of)
		is IrType.Ref -> {
			val td = ir.typeDef(t.lean)
			val shape = td.shape
			when {
				shape is IrShape.Enum -> "${k.name(t.lean)}.${shape.ctors.first().replaceFirstChar { it.uppercase() }}"
				shape is IrShape.Structure -> {
					val ctor = if (k.isEntityLike(td) || k.isFixtureBridged(t.lean)) k.fixtureName(td)
						else k.name(t.lean)
					// 0 フィールドは data object(呼び出し形にしない)
					if (shape.fields.isEmpty()) ctor
					else {
						val args = shape.fields.map { f ->
							val v = defaultLiteral(f.type) ?: return null
							"${ident(f.name)} = $v"
						}
						"$ctor(${args.joinToString(", ")})"
					}
				}
				else -> null
			}
		}
		else -> null
	}

	/** 型に現れる Entity / VO(実体化フックが必要な型)を集める。Command 等の
	    data class の内側(フィールド・sealed の構成子)も再帰して拾う。 */
	private fun entityRefsOf(t: IrType): List<IrTypeDef> {
		val found = linkedMapOf<String, IrTypeDef>()
		val seen = mutableSetOf<String>()
		fun visit(lean: String) {
			if (!seen.add(lean)) return
			val td = ir.typeDef(lean)
			if (k.isEntityLike(td)) {
				found[lean] = td
				return
			}
			when (val s = td.shape) {
				is IrShape.Structure ->
					s.fields.forEach { f -> f.type.leafRefs().forEach(::visit) }
				is IrShape.Sealed ->
					s.ctors.forEach { c -> c.fields.forEach { f -> f.type.leafRefs().forEach(::visit) } }
				else -> {}
			}
		}
		t.leafRefs().forEach(::visit)
		return found.values.toList()
	}

	/**
	 * Entity / 集約ルートの fixture: 本番は getter interface(表現は実装の決定)のため、
	 * テストの値構築は data class 実装(<X>Fixture)で行い、実装の返す値は
	 * toFixture(getter 経由の観測)で正規化してから比較する。
	 */
	private fun fixturesBody(): String {
		val sb = StringBuilder()
		sb.append("// Entity / 集約ルートの fixture と観測正規化(toFixture)。\n")
		sb.append("// 本番の Entity は interface(getter)— 等価性はクラスではなく観測で比較する。\n")
		sb.append("// 橋渡し型(entity-like を運ぶ sealed / VO 構造)は平行 fixture を持つ —\n")
		sb.append("// fixture 語彙の閉包(観測レコードは本番 interface を運ばない)。\n\n")
		val entities = ir.types.filter { k.isEntityLike(it) }
		val bridged = ir.types.filter { k.isFixtureBridged(it.lean) }
		for (td in entities) {
			val shape = td.shape as? IrShape.Structure ?: continue
			if (shape.fields.isEmpty()) {
				// data class は引数 0 を許さない — 0 フィールドの観測は data object
				sb.append("data object ${td.kotlin}Fixture\n\n")
				continue
			}
			val params = shape.fields.joinToString(", ") { f ->
				val base = (f.type as? IrType.WithDefault)?.of ?: f.type
				val dflt = (f.type as? IrType.WithDefault)?.let { " = ${k.defaultExpr(it)}" } ?: ""
				"val ${ident(f.name)}: ${k.typeRefFixture(base)}$dflt"
			}
			sb.append("data class ${td.kotlin}Fixture($params)\n\n")
		}
		for (td in bridged) {
			when (val shape = td.shape) {
				is IrShape.Structure -> {
					if (shape.fields.isEmpty()) {
						sb.append("data object ${td.kotlin}Fixture\n\n")
					} else {
						val params = shape.fields.joinToString(", ") { f ->
							"val ${ident(f.name)}: ${k.typeRefFixture(f.type)}"
						}
						sb.append("data class ${td.kotlin}Fixture($params)\n\n")
					}
				}
				is IrShape.Sealed -> {
					sb.append("sealed interface ${td.kotlin}Fixture {\n")
					for (c in shape.ctors) {
						if (c.fields.isEmpty()) {
							sb.append("\tdata object ${k.ctorClassName(c.name)} : ${td.kotlin}Fixture\n")
						} else {
							val params = c.fields.joinToString(", ") { f ->
								"val ${ident(f.name)}: ${k.typeRefFixture(f.type)}"
							}
							sb.append("\tdata class ${k.ctorClassName(c.name)}($params) : ${td.kotlin}Fixture\n")
						}
					}
					sb.append("}\n\n")
				}
				else -> {}
			}
		}
		for (td in entities) {
			val shape = td.shape as? IrShape.Structure ?: continue
			if (shape.fields.isEmpty()) {
				sb.append("fun ${k.name(td.lean)}.toFixture(): ${td.kotlin}Fixture = ${td.kotlin}Fixture\n\n")
				continue
			}
			val args = shape.fields.joinToString(", ") { f ->
				"${ident(f.name)} = ${ident(f.name)}${fixtureNorm(f.type)}"
			}
			sb.append("fun ${k.name(td.lean)}.toFixture(): ${td.kotlin}Fixture = ${td.kotlin}Fixture($args)\n\n")
		}
		for (td in bridged) {
			when (val shape = td.shape) {
				is IrShape.Structure -> {
					if (shape.fields.isEmpty()) {
						sb.append("fun ${k.name(td.lean)}.toFixture(): ${td.kotlin}Fixture = ${td.kotlin}Fixture\n\n")
					} else {
						val args = shape.fields.joinToString(", ") { f ->
							"${ident(f.name)} = ${ident(f.name)}${fixtureNorm(f.type)}"
						}
						sb.append("fun ${k.name(td.lean)}.toFixture(): ${td.kotlin}Fixture = ${td.kotlin}Fixture($args)\n\n")
					}
				}
				is IrShape.Sealed -> {
					sb.append("fun ${k.name(td.lean)}.toFixture(): ${td.kotlin}Fixture = when (this) {\n")
					for (c in shape.ctors) {
						val cn = k.ctorClassName(c.name)
						if (c.fields.isEmpty()) {
							sb.append("\tis ${td.kotlin}.$cn -> ${td.kotlin}Fixture.$cn\n")
						} else {
							val args = c.fields.joinToString(", ") { f ->
								"${ident(f.name)} = ${ident(f.name)}${fixtureNorm(f.type)}"
							}
							sb.append("\tis ${td.kotlin}.$cn -> ${td.kotlin}Fixture.$cn($args)\n")
						}
					}
					sb.append("}\n\n")
				}
				else -> {}
			}
		}
		return sb.toString().trimEnd()
	}

	// ───────────────────────── 外部能力の Port のモック(契約テストの注入物)

	private val portHarnessFailureBody = """
/**
 * Port モックのハーネス失敗(要求不一致・積んでいない呼び出し)。業務の失敗語彙(DomainResult)では
 * ない — 被検査コードが捕捉しても記録は残り、assertComplete が失敗にする。
 */
class PortHarnessFailure(message: String) : AssertionError(message)
""".trimIndent()

	/**
	 * Port のモック: 期待するやり取り(要求と観測)を順に積み、実装が同じ要求で呼べばその観測を返す。
	 * 違う要求・積んでいない呼び出し・別の操作はハーネス失敗として記録して投げる。
	 * 呼ばれなかった要求は完了検査(assertComplete)が失敗にする。
	 */
	private fun portMockBody(p: IrPort): String {
		val mock = k.portMockName(p)
		val sb = StringBuilder()
		sb.append("/**\n")
		sb.append(" * Lean: Port `${p.module}` の契約テスト用モック。\n")
		sb.append(" * 期待するやり取り(Lean が評価した要求と定理の観測)を順に積み、実装が同じ要求で呼べばその観測を返す。\n")
		sb.append(" * 違う要求・積んでいない呼び出し・別の操作は記録して PortHarnessFailure を投げる(業務の拒否とは別)。\n")
		sb.append(" * 被検査コードが例外を捕捉しても記録は残り、assertComplete が失敗にする。\n")
		sb.append(" */\n")
		sb.append("class $mock(expected: List<Expectation>) : ${p.name} {\n")
		sb.append("\t/** 期待するやり取り(操作ごとに 1 種)。 */\n")
		sb.append("\tsealed interface Expectation\n")
		for (op in p.operations) {
			sb.append("\tdata class ${capitalizeFirst(op.method)}(val request: ${k.name(op.request)}, val outcome: ${k.name(op.outcome)}) : Expectation\n")
		}
		sb.append("\n\tprivate val queue = ArrayDeque(expected)\n")
		sb.append("\tprivate val failures = mutableListOf<String>()\n\n")
		sb.append("\tprivate fun fail(message: String): Nothing {\n")
		sb.append("\t\tfailures += message\n")
		sb.append("\t\tthrow PortHarnessFailure(\"${p.name}: \$message\")\n")
		sb.append("\t}\n")
		for (op in p.operations) {
			val exp = capitalizeFirst(op.method)
			sb.append("\n\toverride fun ${ident(op.method)}(request: ${k.name(op.request)}): ${k.name(op.outcome)} {\n")
			sb.append("\t\tval next = queue.removeFirstOrNull() ?: fail(\"${op.method}: 積んでいない呼び出し(\$request)\")\n")
			sb.append("\t\tif (next !is $exp) fail(\"${op.method}: 期待していた操作は \$next\")\n")
			sb.append("\t\tif (next.request != request) fail(\"${op.method}: 要求が違う — 期待 \${next.request} / 実際 \$request\")\n")
			sb.append("\t\treturn next.outcome\n")
			sb.append("\t}\n")
		}
		sb.append("\n\t/** 記録された失敗(要求不一致・積んでいない呼び出し)が無いこと。 */\n")
		sb.append("\tfun assertNoFailure() {\n")
		sb.append("\t\tif (failures.isNotEmpty()) throw AssertionError(\"${p.name}: \" + failures.joinToString(\"\\n\"))\n")
		sb.append("\t}\n\n")
		sb.append("\t/** 失敗が無く、積んだやり取りが全部消費されたこと(呼ばれなかった要求も失敗)。 */\n")
		sb.append("\tfun assertComplete() {\n")
		sb.append("\t\tassertNoFailure()\n")
		sb.append("\t\tif (queue.isNotEmpty()) throw AssertionError(\"${p.name}: 呼ばれなかったやり取りが残っている: \$queue\")\n")
		sb.append("\t}\n")
		sb.append("}")
		return sb.toString()
	}

	/** ケースの Port への期待をモックの構築式に写す(要求が無い = 積まない = 呼ばれない)。 */
	private fun portMockExpr(p: IrPort, ports: List<IrCasePort>): String {
		val exps = ports.filter { it.port == p.name && it.request != null }.map { cp ->
			val op = p.operations.find { it.method == cp.operation }
				?: error("Port ${p.name} に操作 ${cp.operation} がありません")
			"${k.portMockName(p)}.${capitalizeFirst(op.method)}(request = ${inputLiteral(IrType.Ref(op.request), cp.request!!)}, " +
				"outcome = ${inputLiteral(IrType.Ref(op.outcome), cp.outcome ?: error("Port ${p.name}.${op.method}: 観測が無い"))})"
		}
		return "${k.portMockName(p)}(${if (exps.isEmpty()) "emptyList()" else "listOf(${exps.joinToString(", ")})"})"
	}

	private fun portVar(p: IrPort): String = decapitalizeFirst(p.name)

	/**
	 * Port の Adapter の適合テスト(adapterTest): 観測(Outcome)の各構成子を Adapter が一度は産めることを
	 * 検査する骨格。stub をその観測を返す状態にする配線は具象(arrange フック)の仕事で、
	 * 全応答への写像の正しさはここでは主張しない。観測が構成子を持たない structure なら「どの構成子か」の主張が無いので、
	 * arrange フックに期待する観測も返させて等値を検査する。通常の build には入らない(adapterContractTest タスク)。
	 */
	private fun portAdapterTestBody(p: IrPort): String {
		val sb = StringBuilder()
		sb.append("/**\n")
		sb.append(" * Lean: Port `${p.module}` の Adapter(外部の呼び方の実装)の適合テスト。\n")
		sb.append(" * 観測(Outcome)の各構成子を Adapter が一度は産めることを検査する — 全応答への写像の正しさは主張しない\n")
		sb.append(" * (写像の中身は手書きの Adapter 検査の持ち物)。stub / sandbox 相手に配線した Adapter を adapter() で返し、\n")
		sb.append(" * 各 arrange フックで stub をその観測を返す状態にしてから要求を返す。通常の build には入らない(adapterContractTest タスク)。\n")
		sb.append(" */\n")
		sb.append("abstract class ${p.name}AdapterContractTest {\n")
		sb.append("\t/** 検査対象の Adapter(stub / sandbox 相手に配線したもの)。 */\n")
		sb.append("\tprotected abstract fun adapter(): ${p.name}\n")
		// ctor が null の probe は構造体の観測 — フックは要求と期待する観測の組を返す
		data class Probe(val op: IrPortOp, val ctor: String?, val check: (String) -> String)
		val probes = p.operations.flatMap { op ->
			val outK = k.name(op.outcome)
			when (val shape = ir.typeDef(op.outcome).shape) {
				is IrShape.Sealed -> shape.ctors.map { c -> Probe(op, c.name) { got -> "assertTrue($got is $outK.${k.ctorClassName(c.name)}, \"\$$got\")" } }
				is IrShape.Enum -> shape.ctors.map { c -> Probe(op, c) { got -> "assertEquals($outK.${k.ctorClassName(c)}, $got)" } }
				is IrShape.Structure -> listOf(Probe(op, null) { got -> "assertEquals(expected, $got)" })
			}
		}
		fun hookOf(pr: Probe) = "arrange${capitalizeFirst(pr.op.method)}${pr.ctor?.let { capitalizeFirst(it) } ?: ""}"
		for (pr in probes) {
			if (pr.ctor == null) {
				sb.append("\t/** 要求と、それに期待する観測。stub をその状態にしてから返す。 */\n")
				sb.append("\tprotected abstract fun ${hookOf(pr)}(): Pair<${k.name(pr.op.request)}, ${k.name(pr.op.outcome)}>\n")
			} else {
				sb.append("\t/** 観測 ${pr.ctor} を返させる要求。stub をその状態にしてから返す。 */\n")
				sb.append("\tprotected abstract fun ${hookOf(pr)}(): ${k.name(pr.op.request)}\n")
			}
		}
		for (pr in probes) {
			sb.append("\n\t@Test\n")
			sb.append("\tfun `${pr.op.method} は${pr.ctor?.let { " $it を" } ?: "期待した観測を"}産める`() {\n")
			// arrange を先に評価してから Adapter を取る — 構築時に stub の状態を取り込む Adapter でも arrange が先に効く
			if (pr.ctor == null) sb.append("\t\tval (request, expected) = ${hookOf(pr)}()\n")
			else sb.append("\t\tval request = ${hookOf(pr)}()\n")
			sb.append("\t\tval outcome = adapter().${ident(pr.op.method)}(request)\n")
			sb.append("\t\t${pr.check("outcome")}\n")
			sb.append("\t}\n")
		}
		sb.append("}")
		return sb.toString()
	}

	// ───────────────────────── 読み取り(views)の golden 回帰テスト

	/** 合成できないと note した Row(Kotlin 名 と 状態キー)— 同じ組は 1 回だけ出す。 */
	private val notedRows = mutableSetOf<Pair<String, String>>()

	/**
	 * Row の JSON 要素に無いフィールドを、入れ子の Row(Ref / ListOf / OptionOf の中)まで
	 * 辿って経路(外側Row.field.内側Row.field)で集める。Row 以外の Ref(VO / enum / sealed)
	 * は辿らない — そこの欠けは literal の require が拾う本当のエラー。
	 */
	private fun collectMissingRowFields(td: IrTypeDef, o: JsonObject, path: String, out: MutableSet<String>) {
		val shape = td.shape as? IrShape.Structure ?: return
		for (f in shape.fields) {
			val v = o[f.name]
			if (v == null) out += "$path.${f.name}"
			else collectMissingIn(f.type, v, "$path.${f.name}", out)
		}
	}

	private fun collectMissingIn(t: IrType, j: JsonElement, path: String, out: MutableSet<String>) {
		when (t) {
			is IrType.Ref -> {
				val td = ir.typeDef(t.lean)
				if (td.role == "readModelRow" && j is JsonObject)
					collectMissingRowFields(td, j, "$path.${td.kotlin}", out)
			}
			is IrType.ListOf -> (j as? JsonArray)?.forEach { collectMissingIn(t.of, it, path, out) }
			is IrType.OptionOf -> if (j !is JsonNull) collectMissingIn(t.of, j, path, out)
			is IrType.WithDefault -> collectMissingIn(t.of, j, path, out)
			else -> {}
		}
	}

	/** メソッド引数の型からハーネス実引数を合成する(合成できない型なら null)。 */
	private fun synthesizeArg(t: IrType, state: JsonObject): String? = when (t) {
		is IrType.ListOf -> {
			val ref = t.of as? IrType.Ref ?: return null
			val td = ir.typeDef(ref.lean)
			if (td.role != "readModelRow") return null
			// Row 型 → 状態コレクション(<Xxx>Row → xxxs)から射影。要素の余剰フィールドは
			// 無視し、Row にあって要素に無いフィールド(計算する読み取りモデル)は入れ子の
			// Row まで検査して飛ばす
			val key = decapitalizeFirst(td.kotlin.removeSuffix("Row")) + "s"
			val arr = state[key]?.jsonArray ?: return null
			if (td.shape !is IrShape.Structure) return null
			val elems = arr.map { it as? JsonObject ?: return null }
			val missing = linkedSetOf<String>()
			for (e in elems) collectMissingRowFields(td, e, td.kotlin, missing)
			if (missing.isNotEmpty()) {
				if (notedRows.add(td.kotlin to key))
					log("  note: ${td.kotlin}: 状態 $key の要素に無いフィールド ${missing.joinToString(", ")} — " +
						"計算する読み取りモデルは golden の状態から合成できません(読み取りの回帰は Lean の golden-check と E2E が担う)")
				return null
			}
			"listOf<${td.kotlin}>(${arr.joinToString(", ") { k.refLiteral(td, it) }})"
		}
		is IrType.Ref -> {
			val td = ir.typeDef(t.lean)
			val shape = td.shape as? IrShape.Structure ?: return null
			when {
				// 全フィールドに既定値がある VO は既定コンストラクタ
				td.role == "valueObject" && shape.fields.all { it.type is IrType.WithDefault } ->
					"${k.name(t.lean)}()"
				// 観測の Set(ReadModel)— 状態から行を射影して構築する fixture
				td.role == "readModel" -> {
					val args = shape.fields.map { f ->
						val v = synthesizeArg(f.type, state) ?: return null
						"${ident(f.name)} = $v"
					}
					"${k.name(t.lean)}(${args.joinToString(", ")})"
				}
				// クエリ DTO: フィールドを規則合成して構築(空なら data object)
				td.role == "viewDto" -> {
					if (shape.fields.isEmpty()) k.name(t.lean)
					else {
						val args = shape.fields.map { f ->
							val v = synthesizeArg(f.type, state) ?: return null
							"${ident(f.name)} = $v"
						}
						"${k.name(t.lean)}(${args.joinToString(", ")})"
					}
				}
				else -> null
			}
		}
		is IrType.WithDefault -> synthesizeArg(t.of, state)
		IrType.Nat -> "42L"   // seed — golden は CLI 既定シード 42 で採取される(プロトコル規約)
		is IrType.Arrow -> {
			// (Id) -> Nat: 仮置き表現の数値鍵(golden は Runtime 表現で採取)
			val from = t.from as? IrType.Ref ?: return null
			val td = ir.typeDef(from.lean)
			val f = (td.shape as? IrShape.Structure)?.fields?.singleOrNull() ?: return null
			if (td.isId && t.to == IrType.Nat) "{ x -> x.${ident(f.name)} }" else null
		}
		else -> null
	}

	/**
	 * モデル配管(観測の Set・乱択の鍵・precise な入力)の判定 — 本番署名から落ち、
	 * 契約テストではファクトリ引数(実装への配線)になる。UseCase の契約テスト
	 * 専用なので、EmitMain の固定形(fixedForm)と同じ判定に揃える。
	 */
	private fun isPlumbing(t: IrType): Boolean = when (t) {
		is IrType.Ref -> ir.typeDef(t.lean).role in
			setOf("readModel", "repositoryState", "clockPort", "actorPort", "portOutcome")
		is IrType.Arrow -> (t.from as? IrType.Ref)?.let { ir.typeDef(it.lean).isId } == true &&
			t.to == IrType.Nat
		else -> false
	} || t.leafRefs().let { refs ->
		refs.isNotEmpty() && refs.all {
			val td = ir.typeDef(it)
			td.isId || td.role in setOf("aggregateRoot", "entity", "readModelRow")
		}
	}

	/** 宣言 doc の先頭行(KDoc の 1 行要約に使う)。 */
	private fun docLine(doc: String): String? =
		doc.lineSequence().firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }

	/**
	 * @[contract] 契約定理から演繹された UseCase パラメトリックテスト。
	 * 定理 1 本 = テストファミリ 1 本。入力は抽出時に定理の量化変数からサンプル
	 * (前提が選択器)、期待値は Lean 内評価のオラクルの焼き込み。
	 * - 更新系(kind=transition): 状態遷移契約 — fromState で Effect Set を播種し、
	 *   execute 後に結果と toState(全 Repository / ポートの観測)を突き合わせる。
	 *   採番の種も before 状態(ids.next)が運ぶ — 実装は IdGenerator をそこから始める
	 * - 参照系(kind=value): ReadModel を fixture に execute の返り値を突き合わせる
	 */
	private fun emitTheoremContractTests(goldenPlan: MutableMap<String, Pair<IrMethod, String?>>) {
		val byTarget = ir.contracts.groupBy { it.target }
		val behaviorCs = byTarget["behaviors"] ?: emptyList()
		val ucCs = byTarget["usecase"] ?: emptyList()
		for ((ucName, contracts) in ucCs.groupBy { it.useCase }.toSortedMap()) {
			val s = ir.useCases.find { it.name == ucName }
			if (s == null) {
				log("  note: 契約定理テスト: UseCase $ucName が interface 面にありません")
				continue
			}
			val kinds = contracts.flatMap { it.cases }.map { it.kind }.toSet()
			if ("transition" in kinds) emitTransitionTheoremTest(ucName, s, contracts)
			else emitReadUseCaseContractTest(s, contracts, goldenPlan.remove(ucName))
		}
		// 定理契約のない参照系は golden 回帰だけの ContractTest になる
		for ((ucName, plan) in goldenPlan) {
			ir.useCases.find { it.name == ucName }
				?.let { emitReadUseCaseContractTest(it, emptyList(), plan) }
		}
		for ((subject, contracts) in behaviorCs.groupBy { it.useCase }.toSortedMap()) {
			val td = ir.typeDef(subject)
			// State(RepositoryState)のふるまい定理は Kotlin に写さない — 不変量は
			// 遷移テストのオラクル完全一致に包含される(制約は抽出側で fixture の構築に働く)
			if (td.role == "repositoryState") continue
			// 入力語彙(Command 系)の定理も単体面を持たない — UseCase の
			// validate / execute テストが保証
			if (td.role == "command") continue
			if (k.isEntityLike(td)) emitEntityTheoremTest(td, contracts)
			else emitBehaviorsTheoremTest(subject, contracts)
		}
	}

	/**
	 * Entity / 集約ルートの単体テスト: ふるまいは Entity interface のメソッド
	 * (自分自身はレシーバ)、create は <X>Factory。値の構築は実体化フック
	 * (fixture → 実装の Entity)経由、比較は観測(toFixture)。
	 */
	private fun emitEntityTheoremTest(td: IrTypeDef, contracts: List<IrContract>) {
		val b = ir.behaviors.find { it.subject == td.lean } ?: return
		fun isSubject(f: IrField) = (f.type as? IrType.Ref)?.lean == td.lean
		// 実体化フックが要る Entity 型(主体+引数に現れるもの)と Factory の要否
		val mats = linkedMapOf<String, IrTypeDef>()
		var needsFactory = false
		fun isFactoryM(m: IrMethod) =
			m.params.none(::isSubject) && m.ret.leafRefs().contains(td.lean)
		for (c in contracts) {
			val m = b.methods.find { it.name == c.method } ?: continue
			if (m.params.any(::isSubject)) mats[td.lean] = td
			else if (isFactoryM(m)) needsFactory = true
			else mats[td.lean] = td   // 静的語彙も既定 fixture のレシーバ経由で呼ぶ
			for (p in m.params.filterNot(::isSubject)) {
				for (e in entityRefsOf(p.type)) mats[e.lean] = e
			}
		}
		val factoryImport = if (needsFactory)
			listOf(out.basePackage +
				(k.packagePathOf(td)?.let { ".$it" } ?: "") + ".${td.kotlin}Factory")
			else emptyList()
		emitFile(k.packagePathOf(td), "${td.kotlin}EntityContractTest",
			framework = junitImports + factoryImport) {
			val sb = StringBuilder()
			sb.append("/**\n")
			sb.append(" * Lean: @[contract] 定理群から演繹された `${td.kotlin}` の単体テスト。\n")
			sb.append(" * ふるまいは Entity interface のメソッド — 入力は実体化フック\n")
			sb.append(" * (fixture → 実装の Entity)で作り、返り値は観測(toFixture)で比較する。\n")
			sb.append(" */\n")
			sb.append("abstract class ${td.kotlin}EntityContractTest {\n")
			for ((_, e) in mats) {
				sb.append("\t/** fixture の実体化(観測が一致する実装の Entity を返す)。 */\n")
				sb.append("\tprotected abstract fun ${decapitalizeFirst(e.kotlin)}(" +
					"fixture: ${e.kotlin}Fixture): ${k.name(e.lean)}\n")
			}
			if (needsFactory) {
				sb.append("\t/** ファクトリの実装を返す。 */\n")
				sb.append("\tprotected abstract fun factory(): ${td.kotlin}Factory\n")
			}

			var emitted = 0
			for (c in contracts) {
				val m = b.methods.find { it.name == c.method }
				if (m == null) {
					log("  note: ${c.theorem}: ふるまい ${c.method} が見つかりません")
					continue
				}
				val subjIdx = m.params.indexOfFirst(::isSubject)
				val subjParam = if (subjIdx >= 0) m.params[subjIdx] else null
				c.cases.forEachIndexed { i, case ->
					if (case.kind != "pure" || case.ok == null) return@forEachIndexed
					val callArgs = m.params.filterIndexed { idx, _ -> idx != subjIdx }.map { p ->
						val j = case.args[p.name] ?: run {
							log("  note: ${c.theorem}: 引数 ${p.name} がケースにありません")
							return@forEachIndexed
						}
						"${ident(p.name)} = ${inputLiteral(p.type, j)}"
					}
					val receiver = if (subjParam != null) {
						val j = case.args[subjParam.name] ?: run {
							log("  note: ${c.theorem}: 主体 ${subjParam.name} がケースにありません")
							return@forEachIndexed
						}
						"${decapitalizeFirst(td.kotlin)}(${k.refLiteral(td, j)})"
					} else if (isFactoryM(m)) "factory()"
					else {
						// 契約指名された静的語彙: レシーバ非依存 — 既定 fixture で実体化
						val dflt = defaultLiteral(IrType.Ref(td.lean)) ?: run {
							log("  note: ${c.theorem}: 既定 fixture を構築できません")
							return@forEachIndexed
						}
						"${decapitalizeFirst(td.kotlin)}($dflt)"
					}
					val doc = docLine(c.doc)?.let { "\t/** $it */\n" } ?: ""
					sb.append("\n$doc\t@Test\n")
					sb.append("\tfun `${c.method} は定理 ${c.theorem} を再現する(${i + 1})`() {\n")
					sb.append("\t\tassertEquals(${k.literal(m.ret, case.ok)},\n")
					sb.append("\t\t\t$receiver.${ident(c.method)}(" +
						callArgs.joinToString(", ") + ")${fixtureNorm(m.ret)})\n")
					sb.append("\t}\n")
					emittedContracts += contractKey(c)
					emitted++
				}
			}
			sb.append("}")
			log("  note: 契約定理テスト: ${td.kotlin}(Entity)— 定理 ${contracts.size} 本から $emitted ケース")
			sb.toString()
		}
	}

	/** Entity / VO / State のふるまいの単体テスト(純値形 — オラクル値との完全一致)。
	    引数は**本番語彙**で構築する(inputLiteral — entity-like の葉は実体化フック経由。
	    fixture 語彙の k.literal を本番引数に渡さない)。返り値は観測(toFixture)で比較。 */
	private fun emitBehaviorsTheoremTest(subject: String, contracts: List<IrContract>) {
		val b = ir.behaviors.find { it.subject == subject }
		if (b == null) {
			log("  note: 契約定理テスト: ふるまい $subject が interface 面にありません")
			return
		}
		val td = ir.typeDef(subject)
		val name = "${td.kotlin}Behaviors"
		// 引数に現れる entity-like(実体化フックが要る型)を集める
		val mats = linkedMapOf<String, IrTypeDef>()
		for (c in contracts) {
			val m = b.methods.find { it.name == c.method } ?: continue
			for (p in m.params) for (e in entityRefsOf(p.type)) mats[e.lean] = e
		}
		emitFile(k.packagePathOf(td), "${name}ContractTest", framework = junitImports) {
			val sb = StringBuilder()
			sb.append("/**\n")
			sb.append(" * Lean: @[contract] 定理群から演繹された `${td.kotlin}` のふるまいの単体テスト。\n")
			sb.append(" * 定理 1 本 = テストファミリ 1 本 — 効果・冪等・フレーム(非効果)・観測の\n")
			sb.append(" * 特徴付けを、定理が選んだ入力でのオラクル値(Lean 内評価)との完全一致で固定する。\n")
			sb.append(" */\n")
			sb.append("abstract class ${name}ContractTest {\n")
			sb.append("\t/** ふるまいの実装(Entity / VO の純関数)を返す。 */\n")
			sb.append("\tprotected abstract fun behaviors(): $name\n")
			for ((_, e) in mats) {
				sb.append("\t/** fixture の実体化(観測が一致する実装の値を返す)。 */\n")
				sb.append("\tprotected abstract fun ${decapitalizeFirst(e.kotlin)}(" +
					"fixture: ${k.fixtureName(e)}): ${k.name(e.lean)}\n")
			}
			var emitted = 0
			for (c in contracts) {
				val m = b.methods.find { it.name == c.method }
				if (m == null) {
					log("  note: ${c.theorem}: ふるまい ${c.method} が interface にありません")
					continue
				}
				c.cases.forEachIndexed { i, case ->
					if (case.kind != "pure" || case.ok == null) {
						log("  note: ${c.theorem}(${i + 1}): 純値形でないためスキップ")
						return@forEachIndexed
					}
					val callArgs = m.params.map { p ->
						val j = case.args[p.name] ?: run {
							log("  note: ${c.theorem}: 引数 ${p.name} がケースにありません")
							return@forEachIndexed
						}
						"${ident(p.name)} = ${inputLiteral(p.type, j)}"
					}
					val doc = docLine(c.doc)?.let { "\t/** $it */\n" } ?: ""
					sb.append("\n$doc\t@Test\n")
					sb.append("\tfun `${c.method} は定理 ${c.theorem} を再現する(${i + 1})`() {\n")
					sb.append("\t\tassertEquals(${k.literal(m.ret, case.ok)},\n")
					sb.append("\t\t\tbehaviors().${ident(c.method)}(" +
						callArgs.joinToString(", ") + ")${fixtureNorm(m.ret)})\n")
					sb.append("\t}\n")
					emittedContracts += contractKey(c)
					emitted++
				}
			}
			sb.append("}")
			log("  note: 契約定理テスト: ${td.kotlin}Behaviors — 定理 ${contracts.size} 本から $emitted ケース(純値形)")
			sb.toString()
		}
	}

	// ───────────────────────── Effect Set の分解(遷移契約・障害契約で共有)

	/** 集約ルートの部分(複合状態のときの状態フィールド名と、コレクション名)。 */
	private data class RootPart(val root: IrTypeDef, val stateField: String?, val collField: String)

	/** 泉の部分(状態フィールド名と対応する IdGenerator ポート)。 */
	private data class GenPart(val field: String, val port: Kotlinize.FountainPort)

	private data class EffectSet(val parts: List<RootPart>, val genParts: List<GenPart>)

	private fun rootOfStateType(st: IrTypeDef): IrTypeDef? {
		val short = st.kotlin.removeSuffix("RepositoryState")
		return ir.types.find { it.role == "aggregateRoot" && it.kotlin == short }
	}

	/** 観測モデルの、集約の列を運ぶフィールド名(1 本の List — 形は rootCollectionOf が検査する)。 */
	private fun collFieldOf(st: IrTypeDef, root: IrTypeDef): String =
		k.rootCollectionOf(root)?.coll?.name
			?: error("${st.lean}: ${root.lean} の列を運ぶ List のフィールドがありません")

	/** Effect Set(State)を集約ルート部分と泉部分に分解する。State のフィールドは観測モデル
	    (`<Root>RepositoryState`)か泉の状態 — 集約ルートを Option / List / 単体で直接運ぶ形は読めない。 */
	private fun decomposeState(stateLean: String): EffectSet? {
		val stateTd = ir.typeDef(stateLean)
		val parts = mutableListOf<RootPart>()
		val genParts = mutableListOf<GenPart>()
		if (stateTd.kotlin.endsWith("RepositoryState")) {
			val root = rootOfStateType(stateTd) ?: return null
			parts += RootPart(root, null, collFieldOf(stateTd, root))
		} else {
			for (f in (stateTd.shape as IrShape.Structure).fields) {
				val carried = (((f.type as? IrType.OptionOf)?.of ?: (f.type as? IrType.ListOf)?.of ?: f.type) as? IrType.Ref)
					?.let { ir.typeDef(it.lean) }?.takeIf { it.role == "aggregateRoot" }
				require(carried == null) {
					"${stateTd.lean}.${f.name}: 集約ルート ${carried?.lean} を Option / List / 単体で直接運ぶ形は読めない — " +
						"個体は <Root>RepositoryState の 1 本の List に全部入り、State はその観測モデルを運ぶ" +
						"(「高々 1 件」はその列に掛かる Prop フィールド。lean-conventions §4)"
				}
				val ftd = (f.type as? IrType.Ref)?.let { ir.typeDef(it.lean) } ?: continue
				val port = k.fountainPorts().find { it.stateTd.lean == ftd.lean }
				if (port != null) {
					genParts += GenPart(f.name, port)
					continue
				}
				val root = rootOfStateType(ftd) ?: continue
				parts += RootPart(root, f.name, collFieldOf(ftd, root))
			}
		}
		return if (parts.isEmpty()) null else EffectSet(parts, genParts)
	}

	/** 播種は Repository の `add` で行う — 観測モデルにもファクトリにも add の根拠が無いルートに個体を
	    播種する契約は、コンパイルできない生成物を出さず理由付きで止める。 */
	private fun requireAddForSeeding(part: RootPart, arr: JsonArray) {
		require(arr.isEmpty() || k.repoOps(part.root).add) {
			"${part.root.lean}: 契約の State が個体を播種するが Repository に add が無い(観測モデルの add かファクトリが要る)"
		}
	}

	/** 状態 JSON から集約ルート部分のコレクションを取り出す。 */
	private fun collOf(st: JsonObject, part: RootPart): JsonArray? {
		val o = if (part.stateField == null) st
			else st[part.stateField] as? JsonObject ?: return null
		return o[part.collField] as? JsonArray
	}

	private fun genIsUuid(gp: GenPart): Boolean =
		(gp.port.idTd.shape as IrShape.Structure).fields.single().type == IrType.Uuid

	/** 泉ごとの決定的な供給(Sequential)クラス群(種は状態の next が運ぶ)。 */
	private fun emitSequentialClasses(sb: StringBuilder, genParts: List<GenPart>) {
		for (gp in genParts) {
			val idK = k.name(gp.port.idTd.lean)
			if (genIsUuid(gp)) {
				sb.append("\n\t/** 決定的な供給(UUID 版 Sequential — 128bit 値を 1 ずつ進める)。種は状態(${gp.field}.next)。 */\n")
				sb.append("\tprotected class Sequential${gp.port.port}(var next: java.util.UUID) : ${gp.port.port} {\n")
				sb.append("\t\toverride fun nextId(): $idK {\n")
				sb.append("\t\t\tval v = next\n")
				sb.append("\t\t\tval lo = next.leastSignificantBits + 1\n")
				sb.append("\t\t\tnext = java.util.UUID(if (lo == 0L) next.mostSignificantBits + 1 else next.mostSignificantBits, lo)\n")
				sb.append("\t\t\treturn $idK(v)\n")
				sb.append("\t\t}\n")
				sb.append("\t}\n")
			} else {
				sb.append("\n\t/** 連番採番 — 状態(${gp.field}.next)を種とする決定的実装。 */\n")
				sb.append("\tprotected class Sequential${gp.port.port}(var next: Long) : ${gp.port.port} {\n")
				sb.append("\t\toverride fun nextId(): $idK = $idK(next++)\n")
				sb.append("\t}\n")
			}
		}
	}

	/** 状態 JSON の泉の残高(next)。 */
	private fun genNextOf(st: JsonObject, gp: GenPart): Long? =
		((st[gp.field] as? JsonObject)?.get("next") as? JsonPrimitive)?.longOrNull

	/** 泉の残高のリテラル(UUID 泉は 128bit 値へ写す)。 */
	private fun genNextLiteral(gp: GenPart, next: Long): String =
		if (genIsUuid(gp)) "java.util.UUID(0L, ${next}L)" else "${next}L"

	/**
	 * 更新系: 状態遷移契約のテスト — **本物の Repository を参照**し、集約単位で検査する。
	 * 作用前は許可された書き込み操作(add)で播種し、作用後は
	 * Repository の観測(findAll — 並びは保存順)で突き合わせる。
	 * 採番は泉ごとの IdGenerator ポート契約(注入。消費順・消費数は
	 * 状態の各泉の next が運ぶ)。
	 */
	private fun emitTransitionTheoremTest(
		ucName: String, s: IrService, contracts: List<IrContract>,
	) {
		val stateLean = contracts.flatMap { it.cases }.firstNotNullOfOrNull { it.stateType }
			?: return
		val es = decomposeState(stateLean) ?: return
		val sortedParts = es.parts.sortedBy { it.root.kotlin }
		val genParts = es.genParts
		fun repoVar(root: IrTypeDef) = decapitalizeFirst(root.kotlin) + "Repository"
		// コマンド(interface)の実体化フック
		val cmdMats = linkedMapOf<String, IrTypeDef>()
		for (c in contracts) {
			val mm = s.methods.find { it.name == c.method } ?: continue
			for (p in mm.params.filterNot { isPlumbing(it.type) }) {
				for (e in entityRefsOf(p.type)) cmdMats[e.lean] = e
			}
		}
		// 時計ポート: Clock は署名から落ちる — 契約テストは**固定 today** を
		// 実装フックへ渡す(Sequential<X>IdGenerator と同格の決定的配線)。
		// (フック引数名, Clock のフィールド)の平坦化 — 値は各ケースの args が運ぶ
		data class ClockField(val paramName: String, val field: IrField)
		val clockFields = contracts
			.mapNotNull { c -> s.methods.find { it.name == c.method } }
			.flatMap { it.params }
			.mapNotNull { p ->
				val td = (p.type as? IrType.Ref)?.let { ir.typeDef(it.lean) } ?: return@mapNotNull null
				if (td.role != "clockPort") return@mapNotNull null
				p.name to td
			}
			.distinctBy { it.first }
			.flatMap { (pn, td) ->
				(td.shape as IrShape.Structure).fields.map { ClockField(pn, it) }
			}
		// 主体ポート: actor も署名から落ちる — 契約テストは**固定の主体**を
		// 実装フックへ渡す(today と同格の決定的配線。値は各ケースの args が運ぶ)
		val actorParams = contracts
			.mapNotNull { c -> s.methods.find { it.name == c.method } }
			.flatMap { it.params }
			.filter { p -> (p.type as? IrType.Ref)?.let { ir.typeDef(it.lean).role } == "actorPort" }
			.distinctBy { it.name }
		// 外部能力の Port: 実装は Port 経由で観測を調達する — 契約テストは生成モックを注入し、
		// Lean が評価した要求で 1 回呼ばれること(validate の拒否なら呼ばれないこと)を検査する
		val portDeps = k.portsOf(s)
		val extraImports = sortedParts.map {
			"${out.basePackage}.${k.repositoryPackage}.${it.root.kotlin}Repository"
		} + genParts.map { "${out.basePackage}.application.${it.port.port}" } +
			portDeps.flatMap { p -> listOf("${out.basePackage}.${k.portPackage(p)}.${p.name}", "${out.basePackage}.${k.portPackage(p)}.${k.portMockName(p)}") }
		emitFile(k.useCasePackage(s.module), "${ucName}ContractTest",
			framework = junitImports + extraImports,
			usesDomainResult = s.methods.any { it.ret is IrType.Result }) {
			val sb = StringBuilder()
			sb.append("/**\n")
			sb.append(" * Lean: @[contract] 契約定理から演繹された ${ucName} のパラメトリックテスト。\n")
			sb.append(" * 契約は**状態遷移**を本物の Repository で検査する:\n")
			sb.append(" * 作用前を add で播種 → execute / validate → 作用後を集約単位の観測\n")
			sb.append(" * (findAll — 並びは保存順)で突き合わせる。repository() は\n")
			sb.append(" * **呼び出しごとに空のリポジトリ**を返すこと。採番は注入された\n")
			sb.append(" * IdGenerator から消費順どおりに採番すること(泉の契約)。\n")
			sb.append(" */\n")
			sb.append("abstract class ${ucName}ContractTest {\n")
			for (part in sortedParts) {
				sb.append("\tprotected abstract fun ${repoVar(part.root)}(): ${part.root.kotlin}Repository\n")
			}
			for ((_, e) in linkedMapOf<String, IrTypeDef>().apply {
				sortedParts.forEach { put(it.root.lean, it.root) }
				putAll(cmdMats)
			}) {
				sb.append("\t/** fixture の実体化(観測が一致する実装の値を返す)。 */\n")
				sb.append("\tprotected abstract fun ${decapitalizeFirst(e.kotlin)}(" +
					"fixture: ${k.fixtureName(e)}): ${k.name(e.lean)}\n")
			}
			val clockDoc = if (clockFields.isNotEmpty())
				"。時計は固定の ${clockFields.joinToString("・") { it.field.name }} を配線する(Clock ポート)" else ""
			val actorDoc = if (actorParams.isNotEmpty())
				"。主体は固定の ${actorParams.joinToString("・") { it.name }} を配線する(主体ポート。主体依存のふるまい = 認可分岐はこの注入で検証される)" else ""
			val portDoc = if (portDeps.isNotEmpty())
				"。外部能力の Port は生成モック(${portDeps.joinToString("・") { k.portMockName(it) }})を配線する(要求の値と呼び出し回数はモックが検査する)" else ""
			sb.append("\t/** 実装を、観測用リポジトリ${if (genParts.isNotEmpty()) "と泉ごとの採番ポート" else ""}を配線して返す$actorDoc$clockDoc$portDoc。 */\n")
			sb.append("\tprotected abstract fun useCase(" +
				sortedParts.joinToString(", ") { "${repoVar(it.root)}: ${it.root.kotlin}Repository" } +
				portDeps.joinToString("") { ", ${portVar(it)}: ${it.name}" } +
				genParts.joinToString("") { ", ${decapitalizeFirst(it.port.port)}: ${it.port.port}" } +
				actorParams.joinToString("") { ", ${ident(it.name)}: ${k.typeRef(it.type)}" } +
				clockFields.joinToString("") { ", ${ident(it.field.name)}: ${k.typeRef(it.field.type)}" } +
				"): ${s.name}\n")
			emitSequentialClasses(sb, genParts)
			var emitted = 0
			for (c in contracts) {
				val m = s.methods.find { it.name == c.method }
				if (m == null) {
					log("  note: ${c.theorem}: メソッド ${c.method} が interface にありません")
					continue
				}
				val kept = m.params.filterNot { isPlumbing(it.type) }
				val errT = (m.ret as? IrType.Result)?.err
				c.cases.forEachIndexed { i, case ->
					if (case.kind != "transition" || case.stateType != stateLean ||
						case.before == null || case.after == null) {
						log("  note: ${c.theorem}(${i + 1}): 遷移形でないためスキップ")
						return@forEachIndexed
					}
					val beforeO = case.before as JsonObject
					val afterO = case.after as JsonObject
					val callArgs = kept.map { p ->
						val j = case.args[p.name] ?: run {
							log("  note: ${c.theorem}: 引数 ${p.name} がケースにありません")
							return@forEachIndexed
						}
						"${ident(p.name)} = ${inputLiteral(p.type, j)}"
					}
					val doc = docLine(c.doc)?.let { "\t/** $it */\n" } ?: ""
					sb.append("\n$doc\t@Test\n")
					sb.append("\tfun `${c.method} は定理 ${c.theorem} を再現する(${i + 1})`() {\n")
					for (part in sortedParts) {
						sb.append("\t\tval ${repoVar(part.root)} = ${repoVar(part.root)}()\n")
					}
					// 作用前の播種(add — 保存順)
					for (part in sortedParts) {
						val arr = collOf(beforeO, part) ?: continue
						requireAddForSeeding(part, arr)
						val mat = decapitalizeFirst(part.root.kotlin)
						for (el in arr) {
							sb.append("\t\t${repoVar(part.root)}.add($mat(${k.refLiteral(part.root, el)}))\n")
						}
					}
					// Port のモック: 期待は当該ケース(要求が無ければ空 = 呼ばれない)
					var portArg = ""
					for (p in portDeps) {
						sb.append("\t\tval ${portVar(p)} = ${portMockExpr(p, case.ports)}\n")
						portArg += ", ${portVar(p)}"
					}
					// 泉ごとの決定的な供給 — 種は before の各泉の残高
					var idGenArg = ""
					for (gp in genParts) {
						val next = genNextOf(beforeO, gp) ?: 0L
						val varName = decapitalizeFirst(gp.port.port)
						sb.append("\t\tval $varName = Sequential${gp.port.port}(${genNextLiteral(gp, next)})\n")
						idGenArg += ", $varName"
					}
					// 固定主体の配線: 値は当該ケースの actor 引数(オラクルと同じ主体 —
					// 定理の仮定が選んだ主体で認可分岐がそのまま検証される)
					val actorArgs = actorParams.joinToString("") { ap ->
						", " + (case.args[ap.name]?.let { inputLiteral(ap.type, it) }
							?: defaultLiteral(ap.type)
							?: error("${c.theorem}: 主体 ${ap.name} の値を構成できません"))
					}
					// 固定時計の配線: 値は当該ケースの clock 引数(Lean 内評価と同じ日)
					val clockArgs = clockFields.joinToString("") { cf ->
						val j = (case.args[cf.paramName] as? JsonObject)?.get(cf.field.name)
						", " + (j?.let { k.literal(cf.field.type, it) }
							?: defaultLiteral(cf.field.type)
							?: error("${c.theorem}: 時計 ${cf.field.name} の値を構成できません"))
					}
					sb.append("\t\tval useCase = useCase(" +
						sortedParts.joinToString(", ") { repoVar(it.root) } + "$portArg$idGenArg$actorArgs$clockArgs)\n")
					// Port があるときは結果や例外を一度捕まえ、モックの失敗・完了検査を先に評価する —
					// 要求不一致で実装が途中で止まった赤を、状態差分の赤で隠さない
					val bare = "useCase.${ident(m.name)}(${callArgs.joinToString(", ")})"
					val call = if (portDeps.isEmpty()) bare
						else "runCatching { $bare }.also { ${portDeps.joinToString("; ") { "${portVar(it)}.assertComplete()" }} }.getOrThrow()"
					val okT = (m.ret as? IrType.Result)?.ok
					if (errT != null) {
						if (case.error != null) {
							sb.append("\t\tassertEquals(DomainResult.Err(${k.literal(errT, case.error)}),\n" +
								"\t\t\t$call)\n")
						} else if (case.ok != null && okT != null && okT != IrType.Unit) {
							// validate の解決の成果物(作用対象の集約ルート)—
							// 返り値も観測(toFixture)で突き合わせる
							sb.append("\t\tval result = $call\n")
							sb.append("\t\tassertEquals(DomainResult.Ok(${k.literal(okT, case.ok)}),\n")
							sb.append("\t\t\t(result as? DomainResult.Ok)?.let { " +
								"DomainResult.Ok(it.value${fixtureNorm(okT)}) } ?: result)\n")
						} else {
							sb.append("\t\tassertEquals(DomainResult.Ok(Unit),\n\t\t\t$call)\n")
						}
					} else {
						sb.append("\t\t$call\n")   // 全域(失敗しない)— 観測は状態のみ
					}
					// 作用後の観測(集約単位 — findAll の並び込み完全一致)
					for (part in sortedParts) {
						val arr = collOf(afterO, part) ?: continue
						val items = arr.joinToString(", ") { k.refLiteral(part.root, it) }
						sb.append("\t\tassertEquals(listOf<${k.fixtureName(part.root)}>($items),\n")
						sb.append("\t\t\t${repoVar(part.root)}.findAll().map { it.toFixture() })\n")
					}
					// 泉の消費数の観測(泉ごとに独立。消費数はカウンタ具体化の下で
					// 残高の加算に落ちる — 事後残高の一致で表明)
					for (gp in genParts) {
						val nextAfter = genNextOf(afterO, gp) ?: continue
						sb.append("\t\tassertEquals(${genNextLiteral(gp, nextAfter)}, " +
							"${decapitalizeFirst(gp.port.port)}.next)\n")
					}
					sb.append("\t}\n")
					emittedContracts += contractKey(c)
					emitted++
				}
			}
			sb.append("}")
			log("  note: 契約定理テスト: $ucName — 定理 ${contracts.size} 本から $emitted ケース(遷移形 — Repository 直参照)")
			sb.toString()
		}
	}

	/**
	 * @[faultContract] 障害契約テスト: 環境の技術的障害(DB 例外など —
	 * モデル外の事象)でフェーズが中断されたときの**観測の契約**。抽象側は
	 * 「実行の途中で技術的障害が起きる仕掛けを施した実装」をフックで要求し
	 * (注入手段は具象の自由 — 例: 採番衝突による PRIMARY KEY 違反)、表明は
	 * 「障害後の観測 = Lean の @[faultContract] 定義が宣言する状態」。
	 * ケースは execute が成功する入力(= 中断すべきフェーズが実際に走る入力)から採る。
	 */
	private fun emitFaultContractTests() {
		for ((ucName, fcs) in ir.faultContracts.groupBy { it.useCase }.toSortedMap()) {
			val s = ir.useCases.find { it.name == ucName }
			if (s == null) {
				log("  note: 障害契約: UseCase $ucName が interface 面にありません")
				continue
			}
			val m = s.methods.find { it.name == "execute" }
			if (m == null) {
				log("  note: 障害契約: $ucName に execute がありません")
				continue
			}
			val stateLean = fcs.flatMap { it.cases }.firstOrNull()?.stateType ?: continue
			val es = decomposeState(stateLean) ?: continue
			val sortedParts = es.parts.sortedBy { it.root.kotlin }
			val genParts = es.genParts
			fun repoVar(root: IrTypeDef) = decapitalizeFirst(root.kotlin) + "Repository"
			val kept = m.params.filterNot { isPlumbing(it.type) }
			val cmdMats = linkedMapOf<String, IrTypeDef>()
			for (p in kept) for (e in entityRefsOf(p.type)) cmdMats[e.lean] = e
			// 時計ポート(固定 today — 遷移契約テストと同じ配線)
			data class ClockField(val paramName: String, val field: IrField)
			val clockFields = m.params.mapNotNull { p ->
				val td = (p.type as? IrType.Ref)?.let { ir.typeDef(it.lean) } ?: return@mapNotNull null
				if (td.role != "clockPort") return@mapNotNull null
				p.name to td
			}.flatMap { (pn, td) ->
				(td.shape as IrShape.Structure).fields.map { ClockField(pn, it) }
			}
			// 主体ポート(固定 actor — 遷移契約テストと同じ配線)
			val actorParams = m.params.filter { p ->
				(p.type as? IrType.Ref)?.let { ir.typeDef(it.lean).role } == "actorPort"
			}
			val portDeps = k.portsOf(s)
			val extraImports = sortedParts.map {
				"${out.basePackage}.${k.repositoryPackage}.${it.root.kotlin}Repository"
			} + genParts.map { "${out.basePackage}.application.${it.port.port}" } +
				portDeps.flatMap { p -> listOf("${out.basePackage}.${k.portPackage(p)}.${p.name}", "${out.basePackage}.${k.portPackage(p)}.${k.portMockName(p)}") }
			emitFile(k.useCasePackage(s.module), "${ucName}FaultContractTest",
				framework = junitImports + extraImports) {
				val sb = StringBuilder()
				sb.append("/**\n")
				sb.append(" * Lean: @[faultContract] 定義から生成された $ucName の**障害注入契約テスト**。\n")
				sb.append(" * 環境の技術的障害(DB 例外など — モデルの語彙外の事象)で実行が中断されたとき、\n")
				sb.append(" * 観測される状態が Lean の宣言(定義の値)と一致することを検査する。\n")
				sb.append(" * 各ケースの入力は execute が**成功するはずの入力** — 具象側は「その実行の途中で\n")
				sb.append(" * 技術的障害が起きる」仕掛けを施した実装を faultedUseCase で返す\n")
				sb.append(" * (注入手段は具象の自由 — 例: 採番衝突による PRIMARY KEY 違反)。\n")
				sb.append(" * 表明: execute は業務の失敗語彙の外の例外で中断し(サイト側の不調は\n")
				sb.append(" * 名指ししない — DomainResult に写さない)、Repository の観測は宣言された状態。\n")
				sb.append(" */\n")
				sb.append("abstract class ${ucName}FaultContractTest {\n")
				for (part in sortedParts) {
					sb.append("\tprotected abstract fun ${repoVar(part.root)}(): ${part.root.kotlin}Repository\n")
				}
				for ((_, e) in linkedMapOf<String, IrTypeDef>().apply {
					sortedParts.forEach { put(it.root.lean, it.root) }
					putAll(cmdMats)
				}) {
					sb.append("\t/** fixture の実体化(観測が一致する実装の値を返す)。 */\n")
					sb.append("\tprotected abstract fun ${decapitalizeFirst(e.kotlin)}(" +
						"fixture: ${k.fixtureName(e)}): ${k.name(e.lean)}\n")
				}
				sb.append("\t/** 「実行の途中で技術的障害が起きる」仕掛けを施した実装を返す。注入手段は\n")
				sb.append("\t    具象の自由(渡された泉を差し替え・ラップしてよい)— ただし観測対象の\n")
				sb.append("\t    Repository は渡されたものを配線すること。 */\n")
				sb.append("\tprotected abstract fun faultedUseCase(" +
					sortedParts.joinToString(", ") { "${repoVar(it.root)}: ${it.root.kotlin}Repository" } +
					portDeps.joinToString("") { ", ${portVar(it)}: ${it.name}" } +
					genParts.joinToString("") { ", ${decapitalizeFirst(it.port.port)}: ${it.port.port}" } +
					actorParams.joinToString("") { ", ${ident(it.name)}: ${k.typeRef(it.type)}" } +
					clockFields.joinToString("") { ", ${ident(it.field.name)}: ${k.typeRef(it.field.type)}" } +
					"): ${s.name}\n")
				emitSequentialClasses(sb, genParts)
				var emitted = 0
				for (fc in fcs) {
					fc.cases.forEachIndexed { i, case ->
						val beforeO = case.before as? JsonObject ?: return@forEachIndexed
						val afterO = case.after as? JsonObject ?: return@forEachIndexed
						val callArgs = kept.map { p ->
							val j = case.args[p.name] ?: run {
								log("  note: 障害契約 ${fc.def}: 引数 ${p.name} がケースにありません")
								return@forEachIndexed
							}
							"${ident(p.name)} = ${inputLiteral(p.type, j)}"
						}
						val doc = docLine(fc.doc)?.let { "\t/** $it */\n" } ?: ""
						sb.append("\n$doc\t@Test\n")
						sb.append("\tfun `${m.name} の途中の技術的障害の観測は ${fc.def} の宣言と一致する(${i + 1})`() {\n")
						for (part in sortedParts) {
							sb.append("\t\tval ${repoVar(part.root)} = ${repoVar(part.root)}()\n")
						}
						for (part in sortedParts) {
							val arr = collOf(beforeO, part) ?: continue
							requireAddForSeeding(part, arr)
							val mat = decapitalizeFirst(part.root.kotlin)
							for (el in arr) {
								sb.append("\t\t${repoVar(part.root)}.add($mat(${k.refLiteral(part.root, el)}))\n")
							}
						}
						// Port のモック: 期待は当該ケース。中断がどこで起きたかは宣言の外なので、
						// 消費し切ったかは見ない(要求不一致・積んでいない呼び出しだけを失敗にする)
						var portArg = ""
						for (p in portDeps) {
							sb.append("\t\tval ${portVar(p)} = ${portMockExpr(p, case.ports)}\n")
							portArg += ", ${portVar(p)}"
						}
						var idGenArg = ""
						for (gp in genParts) {
							val next = genNextOf(beforeO, gp) ?: 0L
							val varName = decapitalizeFirst(gp.port.port)
							sb.append("\t\tval $varName = Sequential${gp.port.port}(${genNextLiteral(gp, next)})\n")
							idGenArg += ", $varName"
						}
						val actorArgs = actorParams.joinToString("") { ap ->
							", " + (case.args[ap.name]?.let { inputLiteral(ap.type, it) }
								?: defaultLiteral(ap.type)
								?: error("障害契約 ${fc.def}: 主体 ${ap.name} の値を構成できません"))
						}
						val clockArgs = clockFields.joinToString("") { cf ->
							val j = (case.args[cf.paramName] as? JsonObject)?.get(cf.field.name)
							", " + (j?.let { k.literal(cf.field.type, it) }
								?: defaultLiteral(cf.field.type)
								?: error("障害契約 ${fc.def}: 時計 ${cf.field.name} の値を構成できません"))
						}
						sb.append("\t\tval useCase = faultedUseCase(" +
							sortedParts.joinToString(", ") { repoVar(it.root) } + "$portArg$idGenArg$actorArgs$clockArgs)\n")
						sb.append("\t\tvar thrown: Throwable? = null\n")
						sb.append("\t\ttry {\n")
						sb.append("\t\t\tuseCase.${ident(m.name)}(${callArgs.joinToString(", ")})\n")
						sb.append("\t\t} catch (t: Throwable) {\n")
						sb.append("\t\t\tthrown = t\n")
						sb.append("\t\t}\n")
						for (p in portDeps) sb.append("\t\t${portVar(p)}.assertNoFailure()\n")
						sb.append("\t\tif (thrown == null) throw AssertionError(\n")
						sb.append("\t\t\t\"技術的障害が注入されていない(execute が正常終了した)\")\n")
						// 障害後の観測 = 宣言された状態(Repository 単位の完全一致)
						for (part in sortedParts) {
							val arr = collOf(afterO, part) ?: continue
							val items = arr.joinToString(", ") { k.refLiteral(part.root, it) }
							sb.append("\t\tassertEquals(listOf<${k.fixtureName(part.root)}>($items),\n")
							sb.append("\t\t\t${repoVar(part.root)}.findAll().map { it.toFixture() })\n")
						}
						// 泉の消費: 宣言が消費を言う泉(before ≠ after)だけ表明する —
						// 障害を起こすために泉を差し替えた具象を縛らない(注入手段の自由)
						for (gp in genParts) {
							val nb = genNextOf(beforeO, gp)
							val na = genNextOf(afterO, gp) ?: continue
							if (nb == na) continue
							sb.append("\t\tassertEquals(${genNextLiteral(gp, na)}, " +
								"${decapitalizeFirst(gp.port.port)}.next)\n")
						}
						sb.append("\t}\n")
						emittedContracts += faultKey(fc)
						emitted++
					}
				}
				sb.append("}")
				log("  note: 障害契約テスト: $ucName — ${fcs.size} 宣言から $emitted ケース(障害注入フックつき)")
				sb.toString()
			}
		}
	}

	/**
	 * 参照系 UseCase の契約テスト(1 UseCase 1 クラス): golden 回帰と @[contract]
	 * 定理由来のケースを同じ契約面(execute)に束ねる。観測の Set(ReadModel)は
	 * fixture として配線し、返り値をオラクル(golden / Lean 内評価)と突き合わせる。
	 * 判断・射影の定理も入力の選択器としてここへ流れ込む — 検証面は常に本番の execute。
	 */
	private fun emitReadUseCaseContractTest(
		s: IrService, contracts: List<IrContract>, golden: Pair<IrMethod, String?>?,
	) {
		val m = golden?.first ?: s.methods.find { it.name == "execute" }
			?: s.methods.firstOrNull() ?: return
		val screenKey = golden?.second
		val kept = m.params.filterNot { isPlumbing(it.type) }
		val errT = (m.ret as? IrType.Result)?.err
		val okT = (m.ret as? IrType.Result)?.ok ?: m.ret
		// View→ドメイン語彙の壁: 期待値(View)が interface 化された語彙へ
		// 到達する場合、本番値の等価比較もリテラル生成も成立しない — ケースを生成せず
		// note で明示する(是正はモデル側で View 自身の語彙を導入)
		val viewWall = okT.leafRefs().any { k.reachesEntityLike(IrType.Ref(it)) }
		// 配管(ReadModel・鍵・主体)はファクトリ引数へ — ReadModel はフィールドに展開、
		// 主体(actorPort)は丸ごと 1 引数(値は定理由来のケースの args が運ぶ)
		data class FactoryParam(
			val name: String, val type: IrType, val fromRmField: IrField?,
			val fromArgs: Boolean = false,
		)
		val factoryParams = mutableListOf<FactoryParam>()
		for (p in m.params.filter { isPlumbing(it.type) }) {
			when (val t = p.type) {
				is IrType.Ref ->
					if (ir.typeDef(t.lean).role == "actorPort") {
						factoryParams += FactoryParam(p.name, p.type, null, fromArgs = true)
					} else {
						val shape = ir.typeDef(t.lean).shape as IrShape.Structure
						for (f in shape.fields) factoryParams += FactoryParam(f.name, f.type, f)
					}
				else -> factoryParams += FactoryParam(p.name, p.type, null)
			}
		}
		emitFile(k.useCasePackage(s.module), "${s.name}ContractTest",
			framework = junitImports, usesDomainResult = errT != null) {
			val sb = StringBuilder()
			sb.append("/**\n")
			sb.append(" * Lean: `${s.module}` の参照系契約テスト — 状態から読み取り行を射影して\n")
			sb.append(" * 実装に配線し(取得と鍵は署名に現れない — 実装の配線)、${m.name} の返り値を\n")
			sb.append(" * golden と @[contract] 定理由来のオラクル(Lean 内評価)に突き合わせる。\n")
			sb.append(" * seed は CLI 既定 42、パラメータは既定値、数値鍵は仮置き表現の写し。\n")
			sb.append(" */\n")
			sb.append("abstract class ${s.name}ContractTest {\n")
			sb.append("\t/** 行と鍵を実装へ配線して返す(例: インメモリの読み取りストア)。 */\n")
			sb.append("\tprotected abstract fun useCase(" +
				factoryParams.joinToString(", ") { "${ident(it.name)}: ${k.typeRef(it.type)}" } +
				"): ${s.name}\n")
			var emitted = 0
			if (viewWall) {
				log("  note: ${s.name}: View→ドメイン語彙の壁の破れ(期待値が interface 化された語彙を運ぶ)— 参照系ケースは生成できません(モデル側の是正待ち)")
			}
			if (golden != null && !viewWall) for (snap in goldenSnapshots) {
				val viewJson = if (screenKey == null) snap.views else snap.views[screenKey]
				if (viewJson == null) {
					log("  note: ${s.name}.${m.name}: golden ${snap.source} に $screenKey がないためスキップ")
					continue
				}
				val realArgs = kept.map { p -> synthesizeArg(p.type, snap.state) }
				val wired = factoryParams.map { fp ->
					if (fp.fromRmField != null) synthesizeArg(fp.fromRmField.type, snap.state)
					else synthesizeArg(m.params.first { it.name == fp.name }.type, snap.state)
				}
				if (realArgs.any { it == null } || wired.any { it == null }) {
					log("  note: ${s.name}.${m.name}: 引数を合成できないため ${snap.source} をスキップ")
					continue
				}
				val expected = k.literal(okT, viewJson)
				val expectedWrapped = if (errT != null) "DomainResult.Ok($expected)" else expected
				sb.append("\n\t@Test\n")
				sb.append("\tfun `${m.name} は golden ${snap.source} を再現する`() {\n")
				sb.append("\t\tassertEquals($expectedWrapped,\n")
				sb.append("\t\t\tuseCase(${wired.joinToString(", ") { it!! }})" +
					".${ident(m.name)}(${realArgs.joinToString(", ") { it!! }}))\n")
				sb.append("\t}\n")
				emitted++
			}
			for (c in contracts) {
				// 参照系の検証面は本番の execute(golden 対象メソッド)— それ以外の面
				// (validate 等)に付いた契約は読み飛ばす(execute 面と仮定すると
				// 期待値の型を取り違える)
				if (c.method != m.name) {
					log("  note: ${c.theorem}: 対象 ${c.method} は参照系の検証面(${m.name})ではないため読み飛ばし")
					continue
				}
				if (viewWall) continue
				c.cases.forEachIndexed { i, case ->
					if (case.kind != "value" || case.readModel == null) {
						log("  note: ${c.theorem}(${i + 1}): 値形でないためスキップ")
						return@forEachIndexed
					}
					val rmObj = case.readModel as? JsonObject ?: return@forEachIndexed
					val wired = factoryParams.map { fp ->
						if (fp.fromArgs) {
							// 主体(actorPort): 定理が選んだ固定の主体を配線する
							val j = case.args[fp.name] ?: run {
								log("  note: ${c.theorem}: 主体 ${fp.name} がケースにありません")
								return@forEachIndexed
							}
							k.literal(fp.type, j)
						} else if (fp.fromRmField != null) {
							val j = rmObj[fp.name] ?: run {
								log("  note: ${c.theorem}: ReadModel に ${fp.name} がありません")
								return@forEachIndexed
							}
							k.literal(fp.type, j)
						} else {
							// 鍵などの矢印は仮置き表現の写し
							synthesizeArg(fp.type, JsonObject(emptyMap())) ?: run {
								log("  note: ${c.theorem}: 配線 ${fp.name} を合成できません")
								return@forEachIndexed
							}
						}
					}
					val callArgs = kept.map { p ->
						val j = case.args[p.name] ?: run {
							log("  note: ${c.theorem}: 引数 ${p.name} がケースにありません")
							return@forEachIndexed
						}
						"${ident(p.name)} = ${k.literal(p.type, j)}"
					}
					val expected = when {
						case.error != null && errT != null ->
							"DomainResult.Err(${k.literal(errT, case.error)})"
						case.ok != null -> {
							val okLit = k.literal(okT, case.ok)
							if (errT != null) "DomainResult.Ok($okLit)" else okLit
						}
						else -> return@forEachIndexed
					}
					val doc = docLine(c.doc)?.let { "\t/** $it */\n" } ?: ""
					sb.append("\n$doc\t@Test\n")
					sb.append("\tfun `${m.name} は定理 ${c.theorem} を再現する(${i + 1})`() {\n")
					sb.append("\t\tassertEquals($expected,\n")
					sb.append("\t\t\tuseCase(${wired.joinToString(", ")})" +
						".${ident(m.name)}(${callArgs.joinToString(", ")}))\n")
					sb.append("\t}\n")
					emittedContracts += contractKey(c)
					emitted++
				}
			}
			sb.append("}")
			log("  note: 契約テスト: ${s.name} — golden+定理で $emitted ケース(参照系)")
			sb.toString()
		}
	}

	/**
	 * Retrieve テスト(DDL):
	 * スキーマ+抽出(SQL 等)が、状態から**観測の Set(ReadModel)そのもの**を
	 * 復元できるか — DB スキーマ → ReadModel の変換可能性。Retrieve の単位は
	 * 各 UseCase の ReadModel(Row は素材)。
	 * 入力は状態の集約コレクション。
	 */
	private fun emitDdlContractTest(projCs: List<IrContract>) {
		// Retrieve の受け皿: フィールドがすべて Row 列の ReadModel
		fun rowLeanOf(t: IrType): String? =
			((t as? IrType.ListOf)?.of as? IrType.Ref)?.lean
				?.takeIf { ir.typeDef(it).role == "readModelRow" }
		val rms = ir.types.filter { it.role == "readModel" }.sortedBy { it.kotlin }
			.mapNotNull { rm ->
				val fields = (rm.shape as? IrShape.Structure)?.fields
				if (fields.isNullOrEmpty() || !fields.all { rowLeanOf(it.type) != null }) {
					log("  note: ${rm.kotlin}: Row 列以外のフィールドを持つため Retrieve テスト対象外")
					null
				} else rm to fields
			}
		val aggs = ir.types.filter { it.role == "aggregateRoot" }.sortedBy { it.kotlin }
		if (rms.isEmpty() || aggs.isEmpty()) return
		emitFile("application", "ReadModelDdlContractTest", framework = junitImports) {
			val sb = StringBuilder()
			// 入力は fixture(データの種)— スキーマへの載せ方は実装の自由。
			// 参照収集(import 計算)ブロックの**内側**で組むこと — 外で組むと
			// golden ケースが 0 件の構成で fixture の import が欠ける
			val aggParams = aggs.joinToString(", ") {
				"${ident(decapitalizeFirst(it.kotlin) + "s")}: List<${k.fixtureName(it)}>"
			}
			sb.append("/**\n")
			sb.append(" * Retrieve テスト(DDL):\n")
			sb.append(" * スキーマ+抽出(SQL 等)が、検証済みコマンド経路で構築された状態(golden)や\n")
			sb.append(" * 射影定理の選んだ状態から、**観測の Set(ReadModel)そのもの**を復元できるか —\n")
			sb.append(" * DB スキーマ → ReadModel の変換可能性(Persistence Refinement の実装形)。\n")
			sb.append(" * 行の並びはコレクション順(= 保存順)。**順序も永続化が保持すべき情報**。\n")
			sb.append(" * 実装は状態(集約)を自分のスキーマへ載せ、自分の抽出で ReadModel を復元して返す。\n")
			sb.append(" */\n")
			sb.append("abstract class ReadModelDdlContractTest {\n")
			for ((rm, _) in rms) {
				sb.append("\t/** 集約をスキーマへ載せ、Retrieve で ${rm.kotlin}(観測の Set)を復元して返す。 */\n")
				sb.append("\tprotected abstract fun retrieve${rm.kotlin}($aggParams): " +
					"${k.typeRef(IrType.Ref(rm.lean))}\n")
			}
			var emitted = 0
			for (snap in goldenSnapshots) {
				val aggArgs = aggs.map { td ->
					snap.state[decapitalizeFirst(td.kotlin) + "s"]?.jsonArray?.let { arr ->
						"listOf<${k.fixtureName(td)}>(${arr.joinToString(", ") { k.refLiteral(td, it) }})"
					}
				}
				if (aggArgs.any { it == null }) continue
				for ((rm, fields) in rms) {
					val fieldLits = fields.map { f ->
						synthesizeArg(f.type, snap.state)?.let { "${ident(f.name)} = $it" }
					}
					if (fieldLits.any { it == null }) continue
					sb.append("\n\t@Test\n")
					sb.append("\tfun `${rm.kotlin} は golden ${snap.source} の状態から Retrieve できる`() {\n")
					sb.append("\t\tassertEquals(${k.typeRef(IrType.Ref(rm.lean))}(" +
						"${fieldLits.joinToString(", ") { it!! }}),\n")
					sb.append("\t\t\tretrieve${rm.kotlin}(${aggArgs.joinToString(", ") { it!! }}))\n")
					sb.append("\t}\n")
					emitted++
				}
			}
			// 射影(Application/Projection)の @[contract] 定理から演繹したケース —
			// 期待値は射影の Lean 評価。受け皿は
			// 当該 Row の列を持つ最初の ReadModel(他の集約は空入力 — 空の射影は空)
			for (c in projCs) {
				val rowTd = c.rowType?.let { ir.typeDef(it) } ?: continue
				val stateTd = ir.typeDef(c.useCase)
				val stShape = stateTd.shape as? IrShape.Structure ?: continue
				val collField = stShape.fields.singleOrNull { it.type is IrType.ListOf }?.name ?: continue
				val rootTd = ir.types.find {
					it.role == "aggregateRoot" &&
						it.kotlin == stateTd.kotlin.removeSuffix("RepositoryState")
				} ?: continue
				val (rm, fields) = rms.firstOrNull { (_, fs) ->
					fs.any { rowLeanOf(it.type) == rowTd.lean }
				} ?: continue
				c.cases.forEachIndexed { i, case ->
					if (case.kind != "projection" || case.ok == null) return@forEachIndexed
					val stJson = case.args.values.singleOrNull() as? JsonObject ?: return@forEachIndexed
					val arr = stJson[collField] as? JsonArray ?: return@forEachIndexed
					val aggArgs = aggs.map { td ->
						if (td.lean == rootTd.lean)
							"listOf<${k.fixtureName(td)}>(${arr.joinToString(", ") { k.refLiteral(td, it) }})"
						else "emptyList()"
					}
					val fieldLits = fields.map { f ->
						if (rowLeanOf(f.type) == rowTd.lean)
							"${ident(f.name)} = ${k.literal(f.type, case.ok)}"
						else "${ident(f.name)} = emptyList()"
					}
					val doc = docLine(c.doc)?.let { "\t/** $it */\n" } ?: ""
					sb.append("\n$doc\t@Test\n")
					sb.append("\tfun `retrieve${rm.kotlin} は ${rowTd.kotlin} の定理 " +
						"${c.theorem} を再現する(${i + 1})`() {\n")
					sb.append("\t\tassertEquals(${k.typeRef(IrType.Ref(rm.lean))}(" +
						"${fieldLits.joinToString(", ")}),\n")
					sb.append("\t\t\tretrieve${rm.kotlin}(${aggArgs.joinToString(", ")}))\n")
					sb.append("\t}\n")
					emittedContracts += contractKey(c)
					emitted++
				}
			}
			sb.append("}")
			if (emitted == 0) log("  note: ReadModelDdlContractTest: 生成できたケースが 0 件です")
			else log("  note: Retrieve テスト: ReadModel ${rms.size} 種 — golden+射影定理で $emitted ケース")
			sb.toString()
		}
	}

	/** 参照を収集し、役割別パッケージへのインポートを計算して書き出す(target は既定でテスト側)。 */
	private fun emitFile(
		subpkg: String?, name: String,
		framework: List<String> = emptyList(),
		usesDomainResult: Boolean = false,
		target: Output = out,
		build: () -> String,
	) {
		val (body, c) = k.collecting(build)
		val imports = mutableListOf<String>()
		imports.addAll(framework)
		if (usesDomainResult && subpkg != null) imports.add("${out.basePackage}.DomainResult")
		for (lean in c.refs) {
			val td = ir.typeDef(lean)
			val target = k.packagePathOf(td)
			if (target != subpkg) {
				imports.add(out.basePackage + (target?.let { ".$it" } ?: "") + "." + td.kotlin)
			}
		}
		for (lean in c.fixtures) {
			// fixture はテストのルートパッケージ(GeneratedFixtures)在住
			if (subpkg != null) {
				imports.add(out.basePackage + "." + ir.typeDef(lean).kotlin + "Fixture")
			}
		}
		if (subpkg != null && body.contains(".toFixture(")) {
			imports.add("${out.basePackage}.toFixture")
		}
		if (subpkg != null) {
			for (kn in c.arbs) imports.add("${out.basePackage}.${k.arbFunName(kn)}")
		}
		target.file(subpkg, name, imports, body)
	}

	// ───────────────────────── Arb(Kotest ジェネレータ)

	private fun arbsBody(): String {
		val body = StringBuilder()
		body.append("// 生成テスト(PBT・リポジトリ契約)が使う Kotest ジェネレータ。\n\n")
		body.append("@Suppress(\"unused\")\nprivate val suppressUnused = Unit\n\n")
		for (td in ir.types) {
			when (td.role) {
				"repositoryState", "readModel" -> {}   // fixture は焼き込み — Arb 不要
				"command" -> {}   // 入力語彙(data class)— 値は定理由来のケースが運ぶ、乱択不要
				"clockPort" -> {}   // 時計ポート — Kotlin 型を生成しないため Arb もない
				"actorPort" -> {}   // 主体ポート — 値は定理由来のケースが運ぶ(固定 actor の注入)、乱択不要
				else -> {
					// 本番語彙のまま生成される型(View / エラー等)が entity-like へ到達する
					// 場合、その Arb は語彙が混ざって構築できない(View→ドメイン語彙の壁)—
					// 生成しない。fixture 語彙の Arb は entity-like / 橋渡し型側が持つ
					if (!k.isEntityLike(td) && !k.isFixtureBridged(td.lean) &&
						k.reachesEntityLike(IrType.Ref(td.lean))
					) {
						log("  note: ${td.kotlin}: 本番語彙が entity-like へ到達するため Arb は生成しない(View→ドメイン語彙の壁)")
					} else {
						body.append(dataArb(td)).append("\n\n")
					}
				}
			}
		}
		// 集約ルートの列(Repository の内容): 観測モデルの制約を満たす個体の列 — Repository 契約テストの播種
		for (td in ir.types.filter { it.role == "aggregateRoot" && it.id != IrType.Unit }) {
			body.append(repositoryArb(td)).append("\n\n")
		}
		return body.toString().trimEnd()
	}

	/** 入れ子の個体(List の Entity)の id を列の位置 index で変位させる copy 引数。
	    個体の id はサイト全体で一意(PK)であり、独立に引いた集約をまたいで重複しうる。 */
	private fun nestedIdShifts(td: IrTypeDef, index: String): List<String> =
		((td.shape as? IrShape.Structure)?.fields ?: emptyList()).mapNotNull { f ->
			val el = ((f.type as? IrType.ListOf)?.of as? IrType.Ref)
				?.let { ir.typeDef(it.lean) } ?: return@mapNotNull null
			val elIdLean = (el.id as? IrType.Ref)?.lean ?: return@mapNotNull null
			val elIdField = (el.shape as? IrShape.Structure)?.fields
				?.find { (it.type as? IrType.Ref)?.lean == elIdLean }
				?: return@mapNotNull null
			val elIdTd = ir.typeDef(elIdLean)
			val elInner = ident((elIdTd.shape as IrShape.Structure).fields.single().name)
			val fn = ident(f.name)
			val idn = ident(elIdField.name)
			// UUID ワイヤの Id は 128bit 値の下位へ同じオフセットを足す
			val shifted = if (elIdTd.wire == "uuid")
				"${k.name(elIdLean)}(java.util.UUID(y.$idn.$elInner.mostSignificantBits, " +
					"y.$idn.$elInner.leastSignificantBits + $index * 1000000L))"
			else "${k.name(elIdLean)}(y.$idn.$elInner + $index * 1000000L)"
			"$fn = x.$fn.map { y -> y.copy($idn = $shifted) }"
		}

	/** 集約ルートの列の Arb(`arb<Root>Repository`): 観測モデル(`<Root>RepositoryState`)の
	    一意制約と同一性で間引き、入れ子の個体の id を列の位置で変位させる。間引きで size を
	    割った列は引き直す。 */
	private fun repositoryArb(td: IrTypeDef): String {
		val rc = k.rootCollectionOf(td)
		val keys = rc?.let { k.constraintKeysOf(it.state, it.coll) } ?: emptyList()
		val listT = IrType.ListOf(IrType.Ref(td.lean))
		val fixture = k.fixtureName(td)
		val shifts = nestedIdShifts(td, "i")
		val shiftExpr = if (shifts.isEmpty()) ""
			else ".map { xs -> xs.mapIndexed { i, x -> x.copy(${shifts.joinToString(", ")}) } }"
		val doc = if (rc == null) "`${td.lean}` の個体の列(同一性は重複しない)。"
			else "`${rc.state.lean}` の制約(" +
				(keys.joinToString("・") { k.constraintDoc(it) }.ifEmpty { "無し" }) +
				")と同一性を満たす個体の列。"
		val shiftDoc = if (shifts.isEmpty()) "" else "\n    入れ子の個体の id は列の位置で変位させる(同一性はサイト全体で一意)。"
		return "/** ${doc}間引きで size を割った列は引き直す。$shiftDoc */\n" +
			"internal fun ${k.arbFunName("${td.kotlin}Repository")}(size: IntRange = 0..5): Arb<List<$fixture>> =\n" +
			"\t${k.listArb(listT, keys, "size")}$shiftExpr.filter { it.size in size }"
	}

	/** 構造体のフィールド列から Arb を組む。td があれば List のフィールドを td の一意制約で間引く。 */
	private fun structureArb(td: IrTypeDef?, target: String, fields: List<IrField>, construct: (List<String>) -> String): String =
		when (fields.size) {
			0 -> "Arb.constant(${construct(emptyList())})"
			1 -> "${fieldArb(td, fields[0])}.map { p0 -> ${construct(listOf("p0"))} }"
			else -> {
				require(fields.size <= 14) { "$target: フィールドが多すぎます(Arb.bind の上限 14)" }
				val arbs = fields.joinToString(", ") { fieldArb(td, it) }
				val params = fields.indices.joinToString(", ") { "p$it" }
				"Arb.bind($arbs) { $params -> ${construct(fields.indices.map { "p$it" })} }"
			}
		}

	private fun fieldArb(td: IrTypeDef?, f: IrField): String =
		if (td != null) k.arbOfField(td, f) else k.arbOf(f.type)

	private fun constructCall(typeName: String, fields: List<IrField>, params: List<String>): String =
		if (fields.isEmpty()) typeName
		else "$typeName(${fields.mapIndexed { i, f -> "${ident(f.name)} = ${params[i]}" }.joinToString(", ")})"

	private fun dataArb(td: IrTypeDef): String {
		val kn = k.name(td.lean)
		val fn = k.arbFunName(kn)
		return when (val shape = td.shape) {
			is IrShape.Structure -> {
				// entity-like / 橋渡し型の Arb は fixture 語彙を生成する(閉包)
				val fixture = k.isEntityLike(td) || k.isFixtureBridged(td.lean)
				val ctor = if (fixture) "${td.kotlin}Fixture" else kn
				val retT = if (fixture) "${td.kotlin}Fixture" else kn
				val expr = structureArb(td, td.lean, shape.fields) { ps ->
					constructCall(ctor, shape.fields, ps)
				}
				"internal fun $fn(): Arb<$retT> =\n\t$expr"
			}
			is IrShape.Enum -> "internal fun $fn(): Arb<$kn> = Arb.enum<$kn>()"
			is IrShape.Sealed -> {
				// 橋渡し sealed(entity-like を運ぶ)は平行 fixture 側の構成子で生成する
				val base = if (k.isFixtureBridged(td.lean)) "${td.kotlin}Fixture" else kn
				val branches = shape.ctors.mapIndexed { i, c ->
					val expr =
						if (c.fields.isEmpty()) "Arb.constant($base.${k.ctorClassName(c.name)})"
						else structureArb(null, "${td.lean}.${c.name}", c.fields) { ps ->
							constructCall("$base.${k.ctorClassName(c.name)}", c.fields, ps)
						}
					"\tval c$i: Arb<$base> = $expr"
				}
				val choice = shape.ctors.indices.joinToString(", ") { "c$it" }
				"internal fun $fn(): Arb<$base> {\n${branches.joinToString("\n")}\n\treturn Arb.choice($choice)\n}"
			}
		}
	}

	// ───────────────────────── Repository 契約テスト(規約由来 — Lean 由来ではない)

	private fun emitRepositoryContractTest(td: IrTypeDef) {
		val rootK = td.kotlin
		val framework = junitImports + pbtImports + listOf("org.junit.jupiter.api.Assertions.assertNull")
		emitFile(k.repositoryPackage, "${rootK}RepositoryContractTest", framework = framework) {
			val ops = k.repoOps(td)
			if (td.id == IrType.Unit) {
				val arbRoot = k.arbCall(td.lean)
				"""
/**
 * ${rootK}Repository の契約テスト(v1 規約: 単一保持・上書き)。
 * repository() は**呼び出しごとに空のリポジトリ**を返すこと。
 */
abstract class ${rootK}RepositoryContractTest {
	protected abstract fun repository(): ${rootK}Repository

	@Test
	fun `保存前の get は null`() {
		assertNull(repository().get())
	}

	@Test
	fun `save したものが get で返り、再 save は上書きする`() {
		runBlocking {
			checkAll(PropTestConfig(seed = 42), $arbRoot, $arbRoot) { a, b ->
				val repo = repository()
				repo.save(a)
				assertEquals(a, repo.get())
				repo.save(b)
				assertEquals(b, repo.get())
			}
		}
	}
}
""".trimIndent()
			} else {
				val idField = ident(k.idFieldName(td))
				val arbRepo = k.arbCallOf("${td.kotlin}Repository")
				// update の播種は前後に個体を持つ 1 個体(並びの保持を観測する)+ 書き換えの元になる 1 個体(列の末尾)
				val arbRepo2 = k.arbCallOf("${td.kotlin}Repository", "4..7")
				val constraintDoc = k.rootCollectionOf(td)?.let { rc ->
					" * 個体の列は `${rc.state.lean}` の制約を満たすように引く(${k.arbFunName("${td.kotlin}Repository")})。\n"
				} ?: ""
				"""
/**
 * ${rootK}Repository の契約テスト(v1 規約: save は $idField による upsert)。
$constraintDoc * repository() は**呼び出しごとに空のリポジトリ**を返すこと。
 */
abstract class ${rootK}RepositoryContractTest {
	protected abstract fun repository(): ${rootK}Repository
	/** fixture の実体化(観測が一致する実装の Entity を返す)。 */
	protected abstract fun entity(fixture: ${k.fixtureName(td)}): ${k.name(td.lean)}
${if (ops.add) """
	@Test
	fun `add したものは findAll に保存順で並ぶ${if (ops.find) "、findById で引ける" else ""}`() {
		runBlocking {
			checkAll(PropTestConfig(seed = 42), $arbRepo) { fs ->
				val repo = repository()
				for (f in fs) repo.add(entity(f))
				assertEquals(fs, repo.findAll().map { it.toFixture() })${if (ops.find) """
				for (f in fs) assertEquals(f, repo.findById(f.$idField)?.toFixture())""" else ""}
			}
		}
	}
""" else ""}${if (ops.update && ops.add) """
	@Test
	fun `update は既存個体を書き換え、並びを保つ`() {
		runBlocking {
			checkAll(PropTestConfig(seed = 42), $arbRepo2) { fs ->
				val seeded = fs.dropLast(1)
				val at = seeded.size / 2
				val updated = fs.last().copy($idField = seeded[at].$idField)
				val repo = repository()
				for (f in seeded) repo.add(entity(f))
				repo.update(entity(updated))
				assertEquals(seeded.mapIndexed { j, f -> if (j == at) updated else f }, repo.findAll().map { it.toFixture() })
			}
		}
	}
""" else ""}${if (ops.find) """
	@Test
	fun `未知の id の findById は null`() {
		runBlocking {
			checkAll(PropTestConfig(seed = 42), ${k.arbCall(td.lean)}) { af ->
				assertNull(repository().findById(entity(af).$idField))
			}
		}
	}
""" else ""}}
""".trimIndent()
			}
		}
	}

}
