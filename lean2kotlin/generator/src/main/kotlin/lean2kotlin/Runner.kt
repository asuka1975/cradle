package lean2kotlin

import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText

/**
 * 生成の実行 API(Gradle plugin から呼ばれる)。設定は build.gradle.kts の
 * lean2kotlin { } 拡張で記述する。
 */
object Lean2KotlinGeneration {

	/** IR と golden をファイルから読んで generate を呼ぶ。 */
	fun run(
		irPath: Path,
		kotlinPackage: String,
		mainOut: Path,
		testOut: Path,
		adapterTestOut: Path,
		indent: String,
		goldenDir: Path?,
		log: (String) -> Unit,
	) {
		require(Files.exists(irPath)) {
			"IR がありません: $irPath — 先に抽出(lake env lean <Driver>.lean)を実行してください"
		}
		val ir = Ir.parse(irPath.readText())
		val golden =
			if (goldenDir != null && Files.isDirectory(goldenDir)) Golden.load(goldenDir)
			else Golden.absent(goldenDir)
		generate(ir, golden, kotlinPackage, mainOut, testOut, adapterTestOut, indent, log)
	}

	/** 読み込み済みの IR と golden から main / test / adapterTest(Port の Adapter の適合テスト)を生成する。 */
	fun generate(
		ir: Ir,
		golden: GoldenLoad,
		kotlinPackage: String,
		mainOut: Path,
		testOut: Path,
		adapterTestOut: Path,
		indent: String,
		log: (String) -> Unit,
	) {
		val k = Kotlinize(ir)
		val main = Output(mainOut, kotlinPackage, indent)
		val test = Output(testOut, kotlinPackage, indent)
		val adapterTest = Output(adapterTestOut, kotlinPackage, indent)
		// 泉: @[repositoryState] の <X>IdGeneratorState があれば泉ごとの IdGenerator ポートへ導出する
		val fountainPorts = k.fountainPorts()
		if (fountainPorts.isNotEmpty()) {
			log("note: 泉ポート(泉ごとの IdGenerator ポート): " +
				fountainPorts.joinToString(", ") { "${it.port}(供給: ${it.idTd.kotlin})" })
		}
		logWallBreaches(ir, k, log)
		// 「宣言したのに検査に至らない」は失敗 — 抽出器の診断・生成テスト 0 件の契約・閉じていない Port の型を
		// 集めて最後にまとめて止める(note は生成が続いた情報で、失敗とは分ける)。
		// 見つけた時点で error 行を出す — 生成の途中で例外が出ても、分かっていた分は読める
		val errors = mutableListOf<String>()
		val report = { e: String -> errors += e; log("error: $e") }
		val failure = { IllegalStateException("lean2kotlin: 宣言した契約・Port が検査に至らない診断 ${errors.size} 件で生成を失敗にしました:\n" + errors.joinToString("\n")) }
		for (d in ir.dropped) report("${d.kind} ${d.name}: ${d.reason}")
		// 再生できない golden(外部能力の golden の脇書き欠落・版違い・ok でない応答、fault のエントリが指名した障害契約と IR の食い違い)も
		// 抽出器の診断と同じ集め方 — 生成は続き、最後に止まる
		for (e in golden.errors + Golden.checkFaults(golden, ir)) report(e)
		val beforePorts = errors.size
		reportModelErrors(ir, k, report)
		// 閉じていない Port の型は要求の比較・Arb・リテラルの生成が成立しない — 生成に進まず、ここまでの診断で止める
		if (errors.size > beforePorts) throw failure()
		main.cleanGenerated()
		test.cleanGenerated()
		adapterTest.cleanGenerated()
		EmitMain(ir, k, main, test, log).emitAll()
		val tests = EmitTests(ir, k, test, adapterTest, golden.snapshots, log)
		tests.emitAll()
		for (n in golden.notes) log("note: $n")
		reportUncovered(ir, tests, report)
		log("生成完了: main ${main.report().size} ファイル -> $mainOut / test ${test.report().size} ファイル -> $testOut" +
			(if (adapterTest.report().isEmpty()) "" else " / adapterTest ${adapterTest.report().size} ファイル -> $adapterTestOut"))
		if (errors.isNotEmpty()) throw failure()
	}

	/** View の壁の破れを note に出す(生成は止めない)。Row の壁を先に、壁ごとに IR の型の順。 */
	private fun logWallBreaches(ir: Ir, k: Kotlinize, log: (String) -> Unit) {
		// View→Row の壁: Row はインフラの関心事(スキーマ・抽出に影響される)であり、
		// View(UseCase の出力語彙)のメンバーであってはならない。形が同じでも
		// 偶然の一致 — 同一化しない。破れはモデル(Lean の View 定義)側の是正が必要
		for (td in ir.types.filter { it.role == "viewDto" }) {
			val fieldRefs = td.fieldTypes().flatMap { it.leafRefs() }
			for (r in fieldRefs.distinct().filter { ir.typeDef(it).role == "readModelRow" }) {
				log("note: View→Row の壁の破れ: ${td.lean} が Row(${r})を運んでいます — " +
					"View の語彙は View 自身が持つべきです(Lean の View 定義側の是正が必要)")
			}
		}
		// View→ドメイン語彙の壁(Row の壁と同型): View / エラーの語彙が
		// interface 化されたドメイン語彙(ふるまい持ちの VO / Entity)へ到達すると、
		// 本番値の等価比較もリテラル生成も成立しない — 参照系ケースは生成されない。
		// 是正はモデル側(View 自身の語彙の導入)
		for (td in ir.types.filter { it.role == "viewDto" || it.role == "error" }) {
			val fieldRefs = td.fieldTypes().flatMap { it.leafRefs() }
			for (r in fieldRefs.distinct().filter { ref -> k.reachesEntityLike(IrType.Ref(ref)) }) {
				log("note: View→ドメイン語彙の壁の破れ: ${td.lean} が interface 化された語彙" +
					"(${r} 経由)を運んでいます — 期待値の比較が成立しないため該当の参照系" +
					"ケースは生成されません(モデル側で View 自身の語彙を導入してください)")
			}
		}
	}

	/** 生成に進めないモデルの形(閉じていない Port の型・名義を運ぶ内部入力・Id 型の無い泉)を見つけた順に report する。 */
	private fun reportModelErrors(ir: Ir, k: Kotlinize, report: (String) -> Unit) {
		for (p in ir.ports) for (op in p.operations) for (ty in listOf(op.request, op.outcome)) {
			if (k.reachesArrow(IrType.Ref(ty))) report("Port ${p.name}.${op.method}: ${ty} が関数型を運ぶ(構成子の引数・入れ子の中も含む)— 要求と観測は値で比較できる閉じたデータ型にし、外部を呼ぶ関数は UseCase に渡さない")
			else if (k.reachesEntityLike(IrType.Ref(ty))) report("Port ${p.name}.${op.method}: ${ty} が interface 化された語彙(Entity / ふるまい持ちの VO)を運ぶ — 要求と観測は値で比較できる閉じたデータ型にする")
		}
		// 内部入力(Observation)が名義(ActorContext)を運ぶ形は固定形の破れ — 通知・契機に利用者はいない
		for (td in ir.types.filter { it.role == "observation" }) {
			if (k.reachesRole(IrType.Ref(td.lean), "actorPort")) report("内部入力 ${td.lean} が名義(@[actorContext])を運んでいる — 通知・worker からの入力に利用者の名義は無い")
		}
		// 泉の状態 <X>IdGeneratorState には対になる Id 型 <X>Id が要る(無いと泉ポートが黙って導出されず、採番が注入されない)
		for (st in ir.types.filter { k.isFountainState(it) }) {
			val idName = k.fountainIdName(st)
			if (ir.types.none { it.isId && it.kotlin == idName }) report("泉の状態 ${st.lean} に対応する Id 型 $idName がありません(Runtime/Ids.lean の structure $idName — lean-conventions §9)")
		}
	}

	/** 生成テストが 0 件の契約定理・障害契約を report する(契約定理が先)。 */
	private fun reportUncovered(ir: Ir, tests: EmitTests, report: (String) -> Unit) {
		for (c in ir.contracts) if (tests.contractKey(c) !in tests.emittedContracts) {
			report("契約定理 ${c.useCase}.${c.theorem}(${c.target}): 生成テストが 0 件 — 契約面(execute / query・Entity / VO のふるまい・射影)越しに観測できる定理だけを指名する")
		}
		for (fc in ir.faultContracts) if (tests.faultKey(fc) !in tests.emittedContracts) {
			report("障害契約 ${fc.useCase}.${fc.def}: 生成テストが 0 件")
		}
	}
}
