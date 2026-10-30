package lean2kotlin

import kotlinx.serialization.json.*

// ───────────────────────── 更新系の契約テスト(状態遷移契約・障害契約)

/**
 * 更新系の契約テスト(状態遷移契約・障害契約)が共有する実装フックの配線 — 観測用 Repository・実体化フック・
 * Port のモック・泉の採番ポート・固定の主体と時計。配線の導出は emitFile の外で行い(参照を記録する
 * Kotlinize を呼ばない)、本文を書く関数は emitFile の内側で呼ぶ。主体と時計は methods の引数から集める
 * (同名の引数は最初の 1 つ)。
 */
internal class StatefulHarness(
	private val tests: EmitTests, s: IrService, es: EffectSet, methods: List<IrMethod>,
) {
	private val ir = tests.ir
	private val k = tests.k
	private val out = tests.out
	val sortedParts = es.parts.sortedBy { it.root.kotlin }
	val genParts = es.genParts
	// コマンド(interface)の実体化フック
	private val cmdMats = linkedMapOf<String, IrTypeDef>().apply {
		for (m in methods) for (p in m.params.filterNot { k.isUseCasePlumbing(it.type) }) {
			for (e in tests.entityRefsOf(p.type)) put(e.lean, e)
		}
	}
	// 時計ポート: Clock は署名から落ちる — 契約テストは**固定 today** を
	// 実装フックへ渡す(Sequential<X>IdGenerator と同格の決定的配線)。
	// (フック引数名, Clock のフィールド)の平坦化 — 値は各ケースの args が運ぶ
	data class ClockField(val paramName: String, val field: IrField)
	val clockFields = methods
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
	val actorParams = methods
		.flatMap { it.params }
		.filter { p -> (p.type as? IrType.Ref)?.let { ir.typeDef(it.lean).role } == "actorPort" }
		.distinctBy { it.name }
	// 外部能力の Port: 実装は Port 経由で観測を調達する — 契約テストは生成モックを注入し、
	// Lean が評価した要求で 1 回呼ばれること(validate の拒否なら呼ばれないこと)を検査する
	val portDeps = k.portsOf(s)
	val extraImports = sortedParts.map {
		"${out.basePackage}.${k.repositoryPackage}.${it.root.kotlin}Repository"
	} + genParts.map { "${out.basePackage}.${k.fountainPortPackage}.${it.port.port}" } +
		portDeps.flatMap { p -> listOf("${out.basePackage}.${k.portPackage(p)}.${p.name}", "${out.basePackage}.${k.portPackage(p)}.${k.portMockName(p)}") }

	fun repoVar(root: IrTypeDef) = decapitalizeFirst(root.kotlin) + "Repository"
	fun genVar(gp: GenPart) = decapitalizeFirst(gp.port.port)

	/** 観測用 Repository のフックと、実体化フック(集約ルート、続いてコマンドが運ぶ Entity / VO)の宣言。 */
	fun declareHooks(sb: StringBuilder) {
		for (part in sortedParts) {
			sb.append("\tprotected abstract fun ${repoVar(part.root)}(): ${part.root.kotlin}Repository\n")
		}
		tests.appendMaterializerHooks(sb, linkedMapOf<String, IrTypeDef>().apply {
			sortedParts.forEach { put(it.root.lean, it.root) }
			putAll(cmdMats)
		})
	}

	/** 実装フックの仮引数(Repository・Port・泉・主体・時計の順 — arrange が返す実引数と同じ順)。 */
	fun hookParams(): String =
		sortedParts.joinToString(", ") { "${repoVar(it.root)}: ${it.root.kotlin}Repository" } +
			portDeps.joinToString("") { ", ${tests.portVar(it)}: ${it.name}" } +
			genParts.joinToString("") { ", ${genVar(it)}: ${it.port.port}" } +
			actorParams.joinToString("") { ", ${ident(it.name)}: ${k.typeRef(it.type)}" } +
			clockFields.joinToString("") { ", ${ident(it.field.name)}: ${k.typeRef(it.field.type)}" }

	/** 1 ケースの配線(Repository の作成と播種・Port のモック・泉)を書き、実装フックへ渡す実引数を返す。
	    label は主体・時計の値を構成できないときの error に入る。 */
	fun arrange(
		sb: StringBuilder, args: Map<String, JsonElement>, ports: List<IrCasePort>, beforeO: JsonObject, label: String,
	): String {
		for (part in sortedParts) {
			sb.append("\t\tval ${repoVar(part.root)} = ${repoVar(part.root)}()\n")
		}
		// 作用前の播種(add — 保存順)
		for (part in sortedParts) {
			val arr = tests.collOf(beforeO, part) ?: continue
			tests.requireAddForSeeding(part, arr)
			val mat = k.materializerName(part.root)
			for (el in arr) {
				sb.append("\t\t${repoVar(part.root)}.add($mat(${k.refLiteral(part.root, el)}))\n")
			}
		}
		// Port のモック: 期待は当該ケース(要求が無ければ空 = 呼ばれない)
		var portArg = ""
		for (p in portDeps) {
			sb.append("\t\tval ${tests.portVar(p)} = ${tests.portMockExpr(p, ports)}\n")
			portArg += ", ${tests.portVar(p)}"
		}
		// 泉ごとの決定的な供給 — 種は before の各泉の残高
		var idGenArg = ""
		for (gp in genParts) {
			val next = tests.genNextOf(beforeO, gp) ?: 0L
			sb.append("\t\tval ${genVar(gp)} = Sequential${gp.port.port}(${tests.genNextLiteral(gp, next)})\n")
			idGenArg += ", ${genVar(gp)}"
		}
		// 固定主体の配線: 値は当該ケースの actor 引数(オラクルと同じ主体 —
		// 定理の仮定が選んだ主体で認可分岐がそのまま検証される)
		val actorArgs = actorParams.joinToString("") { ap ->
			", " + (args[ap.name]?.let { tests.inputLiteral(ap.type, it) }
				?: tests.defaultLiteral(ap.type)
				?: error("$label: 主体 ${ap.name} の値を構成できません"))
		}
		// 固定時計の配線: 値は当該ケースの clock 引数(Lean 内評価と同じ日)
		val clockArgs = clockFields.joinToString("") { cf ->
			val j = (args[cf.paramName] as? JsonObject)?.get(cf.field.name)
			", " + (j?.let { k.literal(cf.field.type, it) }
				?: tests.defaultLiteral(cf.field.type)
				?: error("$label: 時計 ${cf.field.name} の値を構成できません"))
		}
		return sortedParts.joinToString(", ") { repoVar(it.root) } + "$portArg$idGenArg$actorArgs$clockArgs"
	}

	/** 作用後の Repository の観測(集約単位 — findAll の並び込み完全一致)。 */
	fun assertCollections(sb: StringBuilder, afterO: JsonObject) {
		for (part in sortedParts) {
			val arr = tests.collOf(afterO, part) ?: continue
			val items = arr.joinToString(", ") { k.refLiteral(part.root, it) }
			sb.append("\t\tassertEquals(listOf<${k.fixtureName(part.root)}>($items),\n")
			sb.append("\t\t\t${repoVar(part.root)}.findAll().map { it.toFixture() })\n")
		}
	}
}

/**
 * 更新系: 状態遷移契約のテスト — **本物の Repository を参照**し、集約単位で検査する。
 * 作用前は許可された書き込み操作(add)で播種し、作用後は
 * Repository の観測(findAll — 並びは保存順)で突き合わせる。
 * 採番は泉ごとの IdGenerator ポート契約(注入。消費順・消費数は
 * 状態の各泉の next が運ぶ)。
 */
internal fun EmitTests.emitTransitionTheoremTest(
	ucName: String, s: IrService, contracts: List<IrContract>,
) {
	val stateLean = contracts.flatMap { it.cases }.firstNotNullOfOrNull { it.stateType }
		?: return
	val es = decomposeState(stateLean) ?: return
	// 主体・時計の引数は契約が検査するメソッド(validate / execute)すべてから集める
	val h = StatefulHarness(this, s, es, contracts.mapNotNull { c -> s.methods.find { it.name == c.method } })
	emitFile(k.useCasePackage(s.module), "${ucName}ContractTest",
		framework = junitImports + h.extraImports,
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
		h.declareHooks(sb)
		val clockDoc = if (h.clockFields.isNotEmpty())
			"。時計は固定の ${h.clockFields.joinToString("・") { it.field.name }} を配線する(Clock ポート)" else ""
		val actorDoc = if (h.actorParams.isNotEmpty())
			"。主体は固定の ${h.actorParams.joinToString("・") { it.name }} を配線する(主体ポート。主体依存のふるまい = 認可分岐はこの注入で検証される)" else ""
		val portDoc = if (h.portDeps.isNotEmpty())
			"。外部能力の Port は生成モック(${h.portDeps.joinToString("・") { k.portMockName(it) }})を配線する(要求の値と呼び出し回数はモックが検査する)" else ""
		sb.append("\t/** 実装を、観測用リポジトリ${if (h.genParts.isNotEmpty()) "と泉ごとの採番ポート" else ""}を配線して返す$actorDoc$clockDoc$portDoc。 */\n")
		sb.append("\tprotected abstract fun useCase(${h.hookParams()}): ${s.name}\n")
		emitSequentialClasses(sb, h.genParts)
		var emitted = 0
		for (c in contracts) {
			val m = s.methods.find { it.name == c.method }
			if (m == null) {
				log("  note: ${c.theorem}: メソッド ${c.method} が interface にありません")
				continue
			}
			val kept = m.params.filterNot { k.isUseCasePlumbing(it.type) }
			val errT = (m.ret as? IrType.Result)?.err
			c.cases.forEachIndexed { i, case ->
				if (case.kind != "transition" || case.stateType != stateLean ||
					case.before == null || case.after == null) {
					log("  note: ${c.theorem}(${i + 1}): 遷移形でないためスキップ")
					return@forEachIndexed
				}
				val beforeO = case.before as JsonObject
				val afterO = case.after as JsonObject
				val callArgs = caseCallArgs(kept, case.args, c.theorem) ?: return@forEachIndexed
				val doc = kdocLine(c.doc)
				sb.append("\n$doc\t@Test\n")
				sb.append("\tfun `${theoremTestName(c.method, c.theorem, i)}`() {\n")
				val hookArgs = h.arrange(sb, case.args, case.ports, beforeO, c.theorem)
				sb.append("\t\tval useCase = useCase($hookArgs)\n")
				// Port があるときは結果や例外を一度捕まえ、モックの失敗・完了検査を先に評価する —
				// 要求不一致で実装が途中で止まった赤を、状態差分の赤で隠さない
				val bare = "useCase.${ident(m.name)}(${callArgs.joinToString(", ")})"
				val call = if (h.portDeps.isEmpty()) bare
					else "runCatching { $bare }.also { ${h.portDeps.joinToString("; ") { "${portVar(it)}.assertComplete()" }} }.getOrThrow()"
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
				h.assertCollections(sb, afterO)
				// 泉の消費数の観測(泉ごとに独立。消費数はカウンタ具体化の下で
				// 残高の加算に落ちる — 事後残高の一致で表明)
				for (gp in h.genParts) {
					val nextAfter = genNextOf(afterO, gp) ?: continue
					sb.append("\t\tassertEquals(${genNextLiteral(gp, nextAfter)}, " +
						"${h.genVar(gp)}.next)\n")
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
internal fun EmitTests.emitFaultContractTests() {
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
		val kept = m.params.filterNot { k.isUseCasePlumbing(it.type) }
		val h = StatefulHarness(this, s, es, listOf(m))
		emitFile(k.useCasePackage(s.module), "${ucName}FaultContractTest",
			framework = junitImports + h.extraImports) {
			val sb = StringBuilder()
			sb.append("/**\n")
			sb.append(" * Lean: @[faultContract] 定義から生成された $ucName の**障害注入契約テスト**。\n")
			sb.append(" * 環境の技術的障害(DB 例外など — モデルの語彙外の事象)で実行が中断されたとき、\n")
			sb.append(" * 観測される状態が Lean の宣言(定義の値)と一致することを検査する。\n")
			sb.append(" * 各ケースの入力は execute が**成功するはずの入力** — 具象側は「その実行の途中で\n")
			sb.append(" * 技術的障害が起きる」仕掛けを施した実装を障害契約ごとのフック faulted<定義名> で返す\n")
			sb.append(" * (注入手段は具象の自由 — 例: 採番衝突による PRIMARY KEY 違反)。\n")
			sb.append(" * 表明: execute は業務の失敗語彙の外の例外で中断し(サイト側の不調は\n")
			sb.append(" * 名指ししない — DomainResult に写さない)、Port の消費は宣言の位置(観測を引数に取らない定義 =\n")
			sb.append(" * 外部を呼ぶ前、取る定義 = 応答を得た後)、Repository の観測は宣言された状態。\n")
			sb.append(" */\n")
			sb.append("abstract class ${ucName}FaultContractTest {\n")
			h.declareHooks(sb)
			val hookParams = h.hookParams()
			fun hookOf(fc: IrFaultContract) = ident("faulted${capitalizeFirst(fc.def)}")
			sb.append("\t/* 「実行の途中で技術的障害が起きる」仕掛けを施した実装を、障害契約(定義)ごとに返す。注入手段は\n")
			sb.append("\t   具象の自由(渡された泉・Port を差し替え・ラップしてよい)— ただし観測対象の Repository は渡されたものを配線し、\n")
			sb.append("\t   Port の呼び出しは渡されたモックへ届けること(消費位置を検査する)。 */\n")
			for (fc in fcs) {
				val where = when {
					h.portDeps.isEmpty() -> ""
					fc.portCalls == 0 -> " — 外部を呼ぶ前に中断する(Port は呼ばれない)"
					else -> " — 外部の応答を得た後に中断する(Port は 1 回呼ばれる)"
				}
				sb.append("\t/** ${docLine(fc.doc) ?: fc.def}$where */\n")
				sb.append("\tprotected abstract fun ${hookOf(fc)}($hookParams): ${s.name}\n")
			}
			emitSequentialClasses(sb, h.genParts)
			var emitted = 0
			for (fc in fcs) {
				fc.cases.forEachIndexed { i, case ->
					val beforeO = case.before as? JsonObject ?: return@forEachIndexed
					val afterO = case.after as? JsonObject ?: return@forEachIndexed
					val label = "障害契約 ${fc.def}"
					val callArgs = caseCallArgs(kept, case.args, label) ?: return@forEachIndexed
					val doc = kdocLine(fc.doc)
					sb.append("\n$doc\t@Test\n")
					sb.append("\tfun `${m.name} の途中の技術的障害の観測は ${fc.def} の宣言と一致する(${i + 1})`() {\n")
					val hookArgs = h.arrange(sb, case.args, case.ports, beforeO, label)
					sb.append("\t\tval useCase = ${hookOf(fc)}($hookArgs)\n")
					sb.append("\t\tvar thrown: Throwable? = null\n")
					sb.append("\t\ttry {\n")
					sb.append("\t\t\tuseCase.${ident(m.name)}(${callArgs.joinToString(", ")})\n")
					sb.append("\t\t} catch (t: Throwable) {\n")
					sb.append("\t\t\tthrown = t\n")
					sb.append("\t\t}\n")
					// Port の消費位置は宣言(portCalls)が決める
					for (p in h.portDeps) sb.append("\t\t${portVar(p)}.${if (fc.portCalls == 0) "assertUntouched" else "assertComplete"}()\n")
					sb.append("\t\tif (thrown == null) throw AssertionError(\n")
					sb.append("\t\t\t\"技術的障害が注入されていない(execute が正常終了した)\")\n")
					// 障害後の観測 = 宣言された状態(Repository 単位の完全一致)
					h.assertCollections(sb, afterO)
					// 泉の消費: 宣言が消費を言う泉(before ≠ after)だけ表明する —
					// 障害を起こすために泉を差し替えた具象を縛らない(注入手段の自由)
					for (gp in h.genParts) {
						val nb = genNextOf(beforeO, gp)
						val na = genNextOf(afterO, gp) ?: continue
						if (nb == na) continue
						sb.append("\t\tassertEquals(${genNextLiteral(gp, na)}, " +
							"${h.genVar(gp)}.next)\n")
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
