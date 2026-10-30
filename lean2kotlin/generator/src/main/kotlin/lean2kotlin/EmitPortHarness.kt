package lean2kotlin

// ───────────────────────── 外部能力の Port のモック(契約テストの注入物)

internal val portHarnessFailureBody = """
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
internal fun EmitTests.portMockBody(p: IrPort): String {
	val mock = k.portMockName(p)
	val sb = StringBuilder()
	sb.append("/**\n")
	sb.append(" * Lean: Port `${p.module}` の契約テスト用モック。\n")
	sb.append(" * 期待するやり取り(Lean が評価した要求と定理の観測)を順に積み、実装が同じ要求で呼べばその観測を返す。\n")
	sb.append(" * 違う要求・積んでいない呼び出し・別の操作は記録して PortHarnessFailure を投げる(業務の拒否とは別)。\n")
	sb.append(" * 被検査コードが例外を捕捉しても記録は残り、assertComplete が失敗にする。\n")
	sb.append(" * 障害契約テストは消費位置を検査する: 外部を呼ぶ前の中断は assertUntouched、応答を得た後の中断は assertComplete。\n")
	sb.append(" */\n")
	sb.append("class $mock(expected: List<Expectation>) : ${p.name} {\n")
	sb.append("\t/** 期待するやり取り(操作ごとに 1 種)。 */\n")
	sb.append("\tsealed interface Expectation\n")
	for (op in p.operations) {
		sb.append("\tdata class ${capitalizeFirst(op.method)}(val request: ${k.name(op.request)}, val outcome: ${k.name(op.outcome)}) : Expectation\n")
	}
	sb.append("\n\tprivate val queue = ArrayDeque(expected)\n")
	sb.append("\tprivate val expectedCount = expected.size\n")
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
	sb.append("\t}\n\n")
	sb.append("\t/** 失敗が無く、まだ何も呼ばれていないこと(外部を呼ぶ前の中断の検査)。 */\n")
	sb.append("\tfun assertUntouched() {\n")
	sb.append("\t\tassertNoFailure()\n")
	sb.append("\t\tif (queue.size != expectedCount) throw AssertionError(\"${p.name}: 外部を呼ぶ前に中断するはずの位置で呼ばれている(消費 \${expectedCount - queue.size} 件)\")\n")
	sb.append("\t}\n")
	sb.append("}")
	return sb.toString()
}

/** ケースの Port への期待をモックの構築式に写す(要求が無い = 積まない = 呼ばれない)。 */
internal fun EmitTests.portMockExpr(p: IrPort, ports: List<IrCasePort>): String {
	val exps = ports.filter { it.port == p.name && it.request != null }.map { cp ->
		val op = p.operations.find { it.method == cp.operation }
			?: error("Port ${p.name} に操作 ${cp.operation} がありません")
		"${k.portMockName(p)}.${capitalizeFirst(op.method)}(request = ${inputLiteral(IrType.Ref(op.request), cp.request!!)}, " +
			"outcome = ${inputLiteral(IrType.Ref(op.outcome), cp.outcome ?: error("Port ${p.name}.${op.method}: 観測が無い"))})"
	}
	return "${k.portMockName(p)}(${if (exps.isEmpty()) "emptyList()" else "listOf(${exps.joinToString(", ")})"})"
}

internal fun EmitTests.portVar(p: IrPort): String = ident(decapitalizeFirst(p.name))

/**
 * Port の Adapter の適合テスト(adapterTest): 観測(Outcome)の各構成子を Adapter が一度は産めることを
 * 検査する骨格。stub をその観測を返す状態にする配線は具象(arrange フック)の仕事で、
 * 全応答への写像の正しさはここでは主張しない。観測が構成子を持たない structure なら「どの構成子か」の主張が無いので、
 * arrange フックに期待する観測も返させて等値を検査する。通常の build には入らない(adapterContractTest タスク)。
 */
internal fun EmitTests.portAdapterTestBody(p: IrPort): String {
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
	fun hookOf(pr: Probe) = ident("arrange${capitalizeFirst(pr.op.method)}${pr.ctor?.let { capitalizeFirst(it) } ?: ""}")
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
