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
