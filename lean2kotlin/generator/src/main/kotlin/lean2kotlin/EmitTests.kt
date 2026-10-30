package lean2kotlin

import kotlinx.serialization.json.JsonElement

/**
 * test ソースの生成。すべて「interface に対する契約テスト」— 抽象クラスで、
 * 実装の供給(useCase() / repository() / 実体化フック)だけをサブクラス(AI が書く)に要求する。
 * 期待値は IR に焼き込まれた Lean 評価結果(@[contract] / @[faultContract])と golden。
 * 配置は対象と同じパッケージ。fixture と Arb はルートに置く。note は log に流す。
 * 群ごとの生成は同じパッケージの別ファイルに EmitTests の拡張関数として置き、状態と共有の部品はこのクラスが持つ。
 */
class EmitTests(
	internal val ir: Ir,
	internal val k: Kotlinize,
	internal val out: Output,
	/** Port の Adapter の適合テストの置き場(build の門に入らない source set adapterTest)。 */
	private val adapterOut: Output,
	internal val goldenSnapshots: List<GoldenSnapshot>,
	internal val log: (String) -> Unit,
) {

	internal val junitImports = listOf(
		"org.junit.jupiter.api.Test",
		"org.junit.jupiter.api.Assertions.assertEquals")
	internal val pbtImports = listOf(
		"kotlinx.coroutines.runBlocking",
		"io.kotest.property.PropTestConfig",
		"io.kotest.property.checkAll")

	/** 生成テストが 1 件でも出た契約(`target/useCase/theorem`、障害契約は `fault/useCase/def`)。
	    宣言した契約が検査に至ったかを Runner が突き合わせる。 */
	val emittedContracts = linkedSetOf<String>()

	fun contractKey(c: IrContract): String = "${c.target}/${c.useCase}/${c.theorem}"
	fun faultKey(fc: IrFaultContract): String = "fault/${fc.useCase}/${fc.def}"

	/** ケースの実引数を params の順に `名前 = リテラル` で並べる。ケースに無い引数は
	    最初の 1 つを note して null(そのケースは出さない)。 */
	internal fun caseCallArgs(
		params: List<IrField>, args: Map<String, JsonElement>, label: String,
		render: (IrType, JsonElement) -> String = { t, j -> inputLiteral(t, j) },
	): List<String>? = params.map { p ->
		val j = args[p.name] ?: run {
			log("  note: $label: 引数 ${p.name} がケースにありません")
			return null
		}
		"${ident(p.name)} = ${render(p.type, j)}"
	}

	/** 実体化フック(fixture → 実装)の宣言。noun は KDoc の「実装の…を返す」に入る語(英字の語は前後の空白ごと渡す)。 */
	internal fun appendMaterializerHooks(sb: StringBuilder, mats: Map<String, IrTypeDef>, noun: String = "値") {
		for ((_, e) in mats) {
			sb.append("\t/** fixture の実体化(観測が一致する実装の${noun}を返す)。 */\n")
			sb.append("\tprotected abstract fun ${decapitalizeFirst(e.kotlin)}(" +
				"fixture: ${k.fixtureName(e)}): ${k.name(e.lean)}\n")
		}
	}

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
		val goldenPlan = planGoldenTargets(ir, goldenSnapshots)
		emitDdlContractTest(ir.contracts.filter { it.target == "projection" })
		emitTheoremContractTests(goldenPlan)
		emitFaultContractTests()
	}

	/** 合成できないと note した Row(Kotlin 名 と 状態キー)— 同じ組は 1 回だけ出す。 */
	internal val notedRows = mutableSetOf<Pair<String, String>>()

	/**
	 * @[contract] 契約定理から演繹された UseCase パラメトリックテスト。
	 * 定理 1 本 = テストファミリ 1 本。入力は抽出時に定理の量化変数からサンプル
	 * (前提が選択器)、期待値は Lean 内評価のオラクルの焼き込み。
	 * - 更新系(kind=transition): 状態遷移契約 — fromState で Effect Set を播種し、
	 *   execute 後に結果と toState(全 Repository / ポートの観測)を突き合わせる。
	 *   採番の種も before 状態(ids.next)が運ぶ — 実装は IdGenerator をそこから始める
	 * - 参照系(kind=value): ReadModel を fixture に execute の返り値を突き合わせる
	 */
	private fun emitTheoremContractTests(goldenPlan: Map<String, GoldenTarget>) {
		val byTarget = ir.contracts.groupBy { it.target }
		val behaviorCs = byTarget["behaviors"] ?: emptyList()
		val ruleCs = byTarget["rules"] ?: emptyList()
		val ucCs = byTarget["usecase"] ?: emptyList()
		// 定理契約と一緒に参照系として出した UseCase(遷移の UseCase は計画から外さない)
		val handled = mutableSetOf<String>()
		for ((ucName, contracts) in ucCs.groupBy { it.useCase }.toSortedMap()) {
			val s = ir.useCases.find { it.name == ucName }
			if (s == null) {
				log("  note: 契約定理テスト: UseCase $ucName が interface 面にありません")
				continue
			}
			val kinds = contracts.flatMap { it.cases }.map { it.kind }.toSet()
			if ("transition" in kinds) emitTransitionTheoremTest(ucName, s, contracts)
			else {
				handled += ucName
				emitReadUseCaseContractTest(s, contracts, goldenPlan[ucName])
			}
		}
		// 定理契約のない参照系は golden 回帰だけの ContractTest になる
		for ((ucName, plan) in goldenPlan.filterKeys { it !in handled }) {
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
			if (k.isInputRole(td.role)) continue
			if (k.isEntityLike(td)) emitEntityTheoremTest(td, contracts)
			else emitBehaviorsTheoremTest(subject, contracts)
		}
		for ((svc, contracts) in ruleCs.groupBy { it.useCase }.toSortedMap()) {
			val s = ir.useCaseRules.find { it.name == svc }
			if (s == null) {
				log("  note: 契約定理テスト: UseCase の判断 $svc が interface 面にありません")
				continue
			}
			emitRulesTheoremTest(s, contracts)
		}
	}

	private val files = GeneratedFiles(ir, k, out.basePackage)

	/** 参照を収集し、役割別パッケージへのインポートを計算して書き出す(target は既定でテスト側)。 */
	internal fun emitFile(
		subpkg: String?, name: String,
		framework: List<String> = emptyList(),
		usesDomainResult: Boolean = false,
		target: Output = out,
		build: () -> String,
	) = files.emit(target, subpkg, name, framework, usesDomainResult, build)

}
