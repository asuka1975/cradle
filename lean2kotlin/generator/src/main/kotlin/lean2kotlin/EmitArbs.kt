package lean2kotlin

// ───────────────────────── Arb(Kotest ジェネレータ)

internal fun EmitTests.arbsBody(): String {
	val body = StringBuilder()
	body.append("// 生成テスト(PBT・リポジトリ契約)が使う Kotest ジェネレータ。\n\n")
	body.append("@Suppress(\"unused\")\nprivate val suppressUnused = Unit\n\n")
	for (td in ir.types) {
		if (k.isInputRole(td.role)) continue   // 入力語彙(data class)— 値は定理由来のケースが運ぶ、乱択不要
		when (td.role) {
			"repositoryState", "readModel" -> {}   // fixture は焼き込み — Arb 不要
			"clockPort" -> {}   // 時計ポート — Kotlin 型を生成しないため Arb もない
			"actorPort" -> {}   // 主体ポート — 値は定理由来のケースが運ぶ(固定 actor の注入)、乱択不要
			else -> {
				// 本番語彙のまま生成される型(View / エラー等)が entity-like へ到達する
				// 場合、その Arb は語彙が混ざって構築できない(View→ドメイン語彙の壁)—
				// 生成しない。fixture 語彙の Arb は entity-like / 橋渡し型側が持つ
				if (!k.isFixtureVocab(td) && k.reachesEntityLike(IrType.Ref(td.lean))) {
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
internal fun EmitTests.nestedIdShifts(td: IrTypeDef, index: String): List<String> =
	((td.shape as? IrShape.Structure)?.fields ?: emptyList()).mapNotNull { f ->
		val el = ((f.type as? IrType.ListOf)?.of as? IrType.Ref)
			?.let { ir.typeDef(it.lean) } ?: return@mapNotNull null
		val elIdLean = (el.id as? IrType.Ref)?.lean ?: return@mapNotNull null
		val elIdField = k.idFieldOf(el) ?: return@mapNotNull null
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
internal fun EmitTests.repositoryArb(td: IrTypeDef): String {
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
internal fun EmitTests.structureArb(td: IrTypeDef?, target: String, fields: List<IrField>, construct: (List<String>) -> String): String =
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

internal fun EmitTests.fieldArb(td: IrTypeDef?, f: IrField): String =
	if (td != null) k.arbOfField(td, f) else k.arbOf(f.type)

internal fun EmitTests.constructCall(typeName: String, fields: List<IrField>, params: List<String>): String =
	if (fields.isEmpty()) typeName
	else "$typeName(${fields.mapIndexed { i, f -> "${ident(f.name)} = ${params[i]}" }.joinToString(", ")})"

internal fun EmitTests.dataArb(td: IrTypeDef): String {
	val kn = k.name(td.lean)
	val fn = k.arbFunName(kn)
	if (td.invariants.isNotEmpty()) return sampledArb(td, fn)
	return when (val shape = td.shape) {
		is IrShape.Structure -> {
			// entity-like / 橋渡し型の Arb は fixture 語彙を生成する(閉包)
			val typeName = if (k.isFixtureVocab(td)) k.fixtureName(td) else kn
			val expr = structureArb(td, td.lean, shape.fields) { ps ->
				constructCall(typeName, shape.fields, ps)
			}
			"internal fun $fn(): Arb<$typeName> =\n\t$expr"
		}
		is IrShape.Enum -> "internal fun $fn(): Arb<$kn> = Arb.enum<$kn>()"
		is IrShape.Sealed -> {
			// 橋渡し sealed(entity-like を運ぶ)は平行 fixture 側の構成子で生成する
			val base = if (k.isFixtureBridged(td.lean)) k.fixtureName(td) else kn
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

/** 制約(Prop フィールド)を持つ型の Arb: Kotlin は制約を評価できないので、Lean が制約を decide して
    通したサンプルの中から引く。値の種類は少ないが、制約を破る個体は出ない。 */
internal fun EmitTests.sampledArb(td: IrTypeDef, fn: String): String {
	require(td.samples.isNotEmpty()) {
		"${td.lean}: 制約(${td.invariants.joinToString(", ") { it.name }})を満たすサンプルを Lean が組めないため Arb を作れません"
	}
	val retT = if (k.isFixtureVocab(td)) k.fixtureName(td) else k.name(td.lean)
	val doc = "/** `${td.lean}` の制約(${td.invariants.joinToString("・") { it.name }})を Lean が decide して通したサンプル。 */\n"
	return "${doc}internal fun $fn(): Arb<$retT> =\n\tArb.element(${td.samples.joinToString(", ") { k.refLiteral(td, it) }})"
}
