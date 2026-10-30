package lean2kotlin

import kotlinx.serialization.json.*

// ───────────────────────── 入力・既定値のリテラルと観測正規化(fixture・Port のモック・各契約テストで共有)

/** フィールド値の観測正規化(実装型 → fixture)のサフィックス。
    State は fixture の入れ物(フィールドが fixture 型)なので対象外。
    橋渡し型(entity-like を運ぶ sealed / VO 構造)も toFixture で正規化する。 */
internal fun EmitTests.fixtureNorm(t: IrType): String = when (t) {
	is IrType.Ref ->
		if (k.isFixtureVocab(ir.typeDef(t.lean))) ".toFixture()" else ""
	is IrType.ListOf ->
		if (fixtureNorm(t.of).isNotEmpty()) ".map { it${fixtureNorm(t.of)} }" else ""
	is IrType.OptionOf ->
		if (fixtureNorm(t.of).isNotEmpty()) "?${fixtureNorm(t.of)}" else ""
	is IrType.WithDefault -> fixtureNorm(t.of)
	// 断るふるまいの結果: 受け入れた値だけを観測に写す(拒否はそのまま比べる)
	is IrType.Result ->
		if (fixtureNorm(t.ok).isNotEmpty())
			".let { r -> if (r is DomainResult.Ok) DomainResult.Ok(r.value${fixtureNorm(t.ok)}) else r }"
		else ""
	else -> ""
}

/** 入力位置の実引数リテラル: Entity / VO は実体化フック経由(fixture → 実装)、
    Command・入力語彙(data class)は ctor 直書きで再帰(VO の葉だけフック)。 */
internal fun EmitTests.inputLiteral(t: IrType, j: JsonElement): String = when (t) {
	is IrType.Ref -> {
		val td = ir.typeDef(t.lean)
		if (k.isEntityLike(td)) "${k.materializerName(td)}(${k.refLiteral(td, j)})"
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
internal fun EmitTests.inputRefLiteral(td: IrTypeDef, j: JsonElement): String = when (val shape = td.shape) {
	is IrShape.Structure ->
		// UUID ワイヤの Id: JSON は canonical UUID 文字列そのもの
		if (td.wire == "uuid" && shape.fields.size == 1) k.refLiteral(td, j)
		else if (shape.fields.isEmpty()) k.name(td.lean)
		else {
			val o = j.jsonObject
			val args = shape.fields.joinToString(", ") { f ->
				"${ident(f.name)} = ${inputLiteral(f.type, k.fieldJson(td, o, f))}"
			}
			"${k.name(td.lean)}($args)"
		}
	is IrShape.Sealed -> {
		// 入力位置は**本番語彙**で構築する(橋渡し型でも fixture に写さない —
		// entity-like の葉だけ実体化フック経由。refLiteral は fixture 語彙なので使わない)
		val (ctor, bo) = k.sealedCtorOf(td, shape, j)
		if (bo == null) "${k.name(td.lean)}.${k.ctorClassName(ctor.name)}"
		else {
			val args = ctor.fields.joinToString(", ") { f ->
				"${ident(f.name)} = ${inputLiteral(f.type, k.fieldJson(td, bo, f))}"
			}
			"${k.name(td.lean)}.${k.ctorClassName(ctor.name)}($args)"
		}
	}
	else -> k.refLiteral(td, j)
}

/** 既定値のリテラル(静的語彙のレシーバ用の最小 fixture)。 */
internal fun EmitTests.defaultLiteral(t: IrType): String? = when (t) {
	IrType.Nat -> "0L"
	IrType.Str -> "\"\""
	IrType.Bool -> "false"
	IrType.Uuid -> "java.util.UUID(0L, 0L)"
	IrType.Rat -> "Rational.ZERO"
	IrType.Date -> "java.time.LocalDate.ofEpochDay(0L)"
	IrType.DateTime -> "java.time.LocalDateTime.ofEpochSecond(0L, 0, java.time.ZoneOffset.UTC)"
	is IrType.ListOf -> "emptyList()"
	is IrType.OptionOf -> "null"
	is IrType.WithDefault -> defaultLiteral(t.of)
	is IrType.Ref -> {
		val td = ir.typeDef(t.lean)
		val shape = td.shape
		when {
			shape is IrShape.Enum -> "${k.name(t.lean)}.${k.ctorClassName(shape.ctors.first())}"
			shape is IrShape.Structure -> {
				val ctor = if (k.isFixtureVocab(td)) k.fixtureName(td) else k.name(t.lean)
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
internal fun EmitTests.entityRefsOf(t: IrType): List<IrTypeDef> {
	val found = linkedMapOf<String, IrTypeDef>()
	val seen = mutableSetOf<String>()
	fun visit(lean: String) {
		if (!seen.add(lean)) return
		val td = ir.typeDef(lean)
		if (k.isEntityLike(td)) {
			found[lean] = td
			return
		}
		td.fieldTypes().forEach { it.leafRefs().forEach(::visit) }
	}
	t.leafRefs().forEach(::visit)
	return found.values.toList()
}
