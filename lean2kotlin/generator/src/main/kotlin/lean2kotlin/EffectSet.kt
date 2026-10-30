package lean2kotlin

import kotlinx.serialization.json.*

// ───────────────────────── Effect Set の分解(遷移契約・障害契約で共有)

/** 集約ルートの部分(複合状態のときの状態フィールド名と、コレクション名)。 */
internal data class RootPart(val root: IrTypeDef, val stateField: String?, val collField: String)

/** 泉の部分(状態フィールド名と対応する IdGenerator ポート)。 */
internal data class GenPart(val field: String, val port: Kotlinize.FountainPort)

internal data class EffectSet(val parts: List<RootPart>, val genParts: List<GenPart>)

internal fun EmitTests.rootOfStateType(st: IrTypeDef): IrTypeDef? {
	val short = st.kotlin.removeSuffix("RepositoryState")
	return ir.types.find { it.role == "aggregateRoot" && it.kotlin == short }
}

/** 観測モデルの、集約の列を運ぶフィールド名(1 本の List — 形は rootCollectionOf が検査する)。 */
internal fun EmitTests.collFieldOf(st: IrTypeDef, root: IrTypeDef): String =
	k.rootCollectionOf(root)?.coll?.name
		?: error("${st.lean}: ${root.lean} の列を運ぶ List のフィールドがありません")

/** Effect Set(State)を集約ルート部分と泉部分に分解する。State のフィールドは観測モデル
    (`<Root>RepositoryState`)か泉の状態 — 集約ルートを Option / List / 単体で直接運ぶ形は読めない。 */
internal fun EmitTests.decomposeState(stateLean: String): EffectSet? {
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
internal fun EmitTests.requireAddForSeeding(part: RootPart, arr: JsonArray) {
	require(arr.isEmpty() || k.repoOps(part.root).add) {
		"${part.root.lean}: 契約の State が個体を播種するが Repository に add が無い(観測モデルの add かファクトリが要る)"
	}
}

/** 状態 JSON から集約ルート部分のコレクションを取り出す。 */
internal fun EmitTests.collOf(st: JsonObject, part: RootPart): JsonArray? {
	val o = if (part.stateField == null) st
		else st[part.stateField] as? JsonObject ?: return null
	return o[part.collField] as? JsonArray
}

internal fun EmitTests.genIsUuid(gp: GenPart): Boolean =
	(gp.port.idTd.shape as IrShape.Structure).fields.single().type == IrType.Uuid

/** 泉ごとの決定的な供給(Sequential)クラス群(種は状態の next が運ぶ)。 */
internal fun EmitTests.emitSequentialClasses(sb: StringBuilder, genParts: List<GenPart>) {
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
internal fun EmitTests.genNextOf(st: JsonObject, gp: GenPart): Long? =
	((st[gp.field] as? JsonObject)?.get("next") as? JsonPrimitive)?.longOrNull

/** 泉の残高のリテラル(UUID 泉は 128bit 値へ写す)。 */
internal fun EmitTests.genNextLiteral(gp: GenPart, next: Long): String =
	if (genIsUuid(gp)) "java.util.UUID(0L, ${next}L)" else "${next}L"
