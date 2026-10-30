package lean2kotlin

// ───────────────────────── fixture(Entity interface の data class 実装)

/**
 * Entity / 集約ルートの fixture: 本番は getter interface(表現は実装の決定)のため、
 * テストの値構築は data class 実装(<X>Fixture)で行い、実装の返す値は
 * toFixture(getter 経由の観測)で正規化してから比較する。
 */
internal fun EmitTests.fixturesBody(): String {
	val sb = StringBuilder()
	sb.append("// Entity / 集約ルートの fixture と観測正規化(toFixture)。\n")
	sb.append("// 本番の Entity は interface(getter)— 等価性はクラスではなく観測で比較する。\n")
	sb.append("// 橋渡し型(entity-like を運ぶ sealed / VO 構造)は平行 fixture を持つ —\n")
	sb.append("// fixture 語彙の閉包(観測レコードは本番 interface を運ばない)。\n\n")
	val entities = ir.types.filter { k.isEntityLike(it) }
	val bridged = ir.types.filter { k.isFixtureBridged(it.lean) }
	for (td in entities) {
		val shape = td.shape as? IrShape.Structure ?: continue
		appendStructureFixture(sb, td, shape.fields, withDefaults = true)
	}
	for (td in bridged) {
		when (val shape = td.shape) {
			is IrShape.Structure -> appendStructureFixture(sb, td, shape.fields, withDefaults = false)
			is IrShape.Sealed -> {
				val fx = k.fixtureName(td)
				sb.append("sealed interface $fx {\n")
				for (c in shape.ctors) {
					if (c.fields.isEmpty()) {
						sb.append("\tdata object ${k.ctorClassName(c.name)} : $fx\n")
					} else {
						val params = c.fields.joinToString(", ") { f ->
							"val ${ident(f.name)}: ${k.typeRefFixture(f.type)}"
						}
						sb.append("\tdata class ${k.ctorClassName(c.name)}($params) : $fx\n")
					}
				}
				sb.append("}\n\n")
			}
			else -> {}
		}
	}
	for (td in entities) {
		val shape = td.shape as? IrShape.Structure ?: continue
		appendStructureToFixture(sb, td, shape.fields)
	}
	for (td in bridged) {
		when (val shape = td.shape) {
			is IrShape.Structure -> appendStructureToFixture(sb, td, shape.fields)
			is IrShape.Sealed -> {
				val fx = k.fixtureName(td)
				sb.append("fun ${k.name(td.lean)}.toFixture(): $fx = when (this) {\n")
				for (c in shape.ctors) {
					val cn = k.ctorClassName(c.name)
					if (c.fields.isEmpty()) {
						sb.append("\tis ${td.kotlin}.$cn -> $fx.$cn\n")
					} else {
						val args = c.fields.joinToString(", ") { f ->
							"${ident(f.name)} = ${ident(f.name)}${fixtureNorm(f.type)}"
						}
						sb.append("\tis ${td.kotlin}.$cn -> $fx.$cn($args)\n")
					}
				}
				sb.append("}\n\n")
			}
			else -> {}
		}
	}
	return sb.toString().trimEnd()
}

/** 構造の fixture。withDefaults なら既定値のあるフィールドのパラメータに既定値を付ける。 */
private fun EmitTests.appendStructureFixture(sb: StringBuilder, td: IrTypeDef, fields: List<IrField>, withDefaults: Boolean) {
	val fx = k.fixtureName(td)
	if (fields.isEmpty()) {
		// data class は引数 0 を許さない — 0 フィールドの観測は data object
		sb.append("data object $fx\n\n")
		return
	}
	val params = fields.joinToString(", ") { f ->
		val dflt = (f.type as? IrType.WithDefault)?.takeIf { withDefaults }?.let { " = ${k.defaultExpr(it)}" } ?: ""
		"val ${ident(f.name)}: ${k.typeRefFixture(f.type)}$dflt"
	}
	sb.append("data class $fx($params)\n\n")
}

/** 構造の観測正規化: 各フィールドを fixtureNorm で fixture 語彙に写す。 */
private fun EmitTests.appendStructureToFixture(sb: StringBuilder, td: IrTypeDef, fields: List<IrField>) {
	val fx = k.fixtureName(td)
	val head = "fun ${k.name(td.lean)}.toFixture(): $fx = $fx"
	if (fields.isEmpty()) {
		sb.append("$head\n\n")
		return
	}
	val args = fields.joinToString(", ") { f ->
		"${ident(f.name)} = ${ident(f.name)}${fixtureNorm(f.type)}"
	}
	sb.append("$head($args)\n\n")
}
