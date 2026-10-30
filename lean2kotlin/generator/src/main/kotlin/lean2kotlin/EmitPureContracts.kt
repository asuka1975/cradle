package lean2kotlin

import kotlinx.serialization.json.JsonElement

// ───────────────────────── 純値形の契約テスト(UseCase の判断・Entity・ふるまい)

/** UseCase の判断(`<X>Rules`)の単体テスト(純値形 — オラクル値との完全一致)。
    引数は本番語彙で構築し(entity-like の葉は実体化フック経由)、返り値は観測(toFixture)で比較する。 */
internal fun EmitTests.emitRulesTheoremTest(s: IrService, contracts: List<IrContract>) {
	val mats = linkedMapOf<String, IrTypeDef>()
	for (c in contracts) {
		val m = s.methods.find { it.name == c.method } ?: continue
		for (p in m.params) for (e in entityRefsOf(p.type)) mats[e.lean] = e
	}
	emitFile(k.useCasePackage(s.module), "${s.name}ContractTest", framework = junitImports) {
		val sb = StringBuilder()
		sb.append("/**\n")
		sb.append(" * Lean: @[contract] 定理群から演繹された `${s.module}` の判断(${s.name})の単体テスト。\n")
		sb.append(" * 定理 1 本 = テストファミリ 1 本 — 定理が選んだ入力でのオラクル値(Lean 内評価)との完全一致で固定する。\n")
		sb.append(" */\n")
		sb.append("abstract class ${s.name}ContractTest {\n")
		sb.append("\t/** 判断の実装を返す(UseCase の実装がこの interface を実装してもよい)。 */\n")
		sb.append("\tprotected abstract fun rules(): ${s.name}\n")
		appendMaterializerHooks(sb, mats)
		var emitted = 0
		for (c in contracts) {
			val m = s.methods.find { it.name == c.method }
			if (m == null) {
				log("  note: ${c.theorem}: 判断 ${c.method} が interface にありません")
				continue
			}
			c.cases.forEachIndexed { i, case ->
				if (case.kind != "pure" || case.ok == null) {
					log("  note: ${c.theorem}(${i + 1}): 純値形でないためスキップ")
					return@forEachIndexed
				}
				val callArgs = caseCallArgs(m.params, case.args, c.theorem) ?: return@forEachIndexed
				appendPureTest(sb, c, i, case.ok, m, "rules()", callArgs)
				emittedContracts += contractKey(c)
				emitted++
			}
		}
		sb.append("}")
		log("  note: 契約定理テスト: ${s.name} — 定理 ${contracts.size} 本から $emitted ケース(純値形)")
		sb.toString()
	}
}

/**
 * Entity / 集約ルートの単体テスト: ふるまいは Entity interface のメソッド
 * (自分自身はレシーバ)、create は <X>Factory。値の構築は実体化フック
 * (fixture → 実装の Entity)経由、比較は観測(toFixture)。
 */
internal fun EmitTests.emitEntityTheoremTest(td: IrTypeDef, contracts: List<IrContract>) {
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
		appendMaterializerHooks(sb, mats, noun = " Entity ")
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
				val callArgs = caseCallArgs(m.params.filterIndexed { idx, _ -> idx != subjIdx }, case.args, c.theorem)
					?: return@forEachIndexed
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
				appendPureTest(sb, c, i, case.ok, m, receiver, callArgs)
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
internal fun EmitTests.emitBehaviorsTheoremTest(subject: String, contracts: List<IrContract>) {
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
		appendMaterializerHooks(sb, mats)
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
				val callArgs = caseCallArgs(m.params, case.args, c.theorem) ?: return@forEachIndexed
				appendPureTest(sb, c, i, case.ok, m, "behaviors()", callArgs)
				emittedContracts += contractKey(c)
				emitted++
			}
		}
		sb.append("}")
		log("  note: 契約定理テスト: ${td.kotlin}Behaviors — 定理 ${contracts.size} 本から $emitted ケース(純値形)")
		sb.toString()
	}
}

/** 純値形の 1 ケース: レシーバのメソッドの返り値を観測に写し、オラクル値と比べる。 */
private fun EmitTests.appendPureTest(
	sb: StringBuilder, c: IrContract, i: Int, ok: JsonElement, m: IrMethod, receiver: String, callArgs: List<String>,
) {
	val doc = kdocLine(c.doc)
	sb.append("\n$doc\t@Test\n")
	sb.append("\tfun `${theoremTestName(c.method, c.theorem, i)}`() {\n")
	sb.append("\t\tassertEquals(${k.literal(m.ret, ok)},\n")
	sb.append("\t\t\t$receiver.${ident(c.method)}(" +
		callArgs.joinToString(", ") + ")${fixtureNorm(m.ret)})\n")
	sb.append("\t}\n")
}
