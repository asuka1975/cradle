package lean2kotlin

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
			// 計画の基準は views を持つ最初のスナップショット(外部能力の golden では refused / fault が先に来ることがある)
			val v0 = goldenSnapshots.firstOrNull { it.views.isNotEmpty() }?.views ?: goldenSnapshots.first().views
			for (s in ir.useCases) {
				for (m in s.methods.filter { it.name == "execute" }) {
					val okT = (m.ret as? IrType.Result)?.ok ?: m.ret
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
	private fun emitTheoremContractTests(goldenPlan: MutableMap<String, Pair<IrMethod, String?>>) {
		val byTarget = ir.contracts.groupBy { it.target }
		val behaviorCs = byTarget["behaviors"] ?: emptyList()
		val ruleCs = byTarget["rules"] ?: emptyList()
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
