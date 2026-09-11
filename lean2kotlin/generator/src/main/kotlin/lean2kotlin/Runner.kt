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
			else GoldenLoad(emptyList(),
				listOf("golden ディレクトリがありません: $goldenDir — golden 由来のケース(参照系の golden 回帰・Retrieve)は生成しません"))
		generate(ir, golden, kotlinPackage, mainOut, testOut, indent, log)
	}

	/** 読み込み済みの IR と golden から main / test を生成する。 */
	fun generate(
		ir: Ir,
		golden: GoldenLoad,
		kotlinPackage: String,
		mainOut: Path,
		testOut: Path,
		indent: String,
		log: (String) -> Unit,
	) {
		val k = Kotlinize(ir)
		val main = Output(mainOut, kotlinPackage, indent)
		val test = Output(testOut, kotlinPackage, indent)
		// 泉: @[repositoryState] の <X>IdGeneratorState があれば泉ごとの IdGenerator ポートへ導出する
		val fountainPorts = k.fountainPorts()
		if (fountainPorts.isNotEmpty()) {
			log("note: 泉ポート(泉ごとの IdGenerator ポート): " +
				fountainPorts.joinToString(", ") { "${it.port}(供給: ${it.idTd.kotlin})" })
		}
		// View→Row の壁: Row はインフラの関心事(スキーマ・抽出に影響される)であり、
		// View(UseCase の出力語彙)のメンバーであってはならない。形が同じでも
		// 偶然の一致 — 同一化しない。破れはモデル(Lean の View 定義)側の是正が必要
		for (td in ir.types.filter { it.role == "viewDto" }) {
			val shape = td.shape
			val fieldRefs = when (shape) {
				is IrShape.Structure -> shape.fields.flatMap { it.type.leafRefs() }
				is IrShape.Sealed -> shape.ctors.flatMap { c -> c.fields.flatMap { it.type.leafRefs() } }
				else -> emptyList()
			}
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
			val fieldRefs = when (val shape = td.shape) {
				is IrShape.Structure -> shape.fields.flatMap { it.type.leafRefs() }
				is IrShape.Sealed -> shape.ctors.flatMap { c -> c.fields.flatMap { it.type.leafRefs() } }
				else -> emptyList()
			}
			for (r in fieldRefs.distinct().filter { ref -> k.reachesEntityLike(IrType.Ref(ref)) }) {
				log("note: View→ドメイン語彙の壁の破れ: ${td.lean} が interface 化された語彙" +
					"(${r} 経由)を運んでいます — 期待値の比較が成立しないため該当の参照系" +
					"ケースは生成されません(モデル側で View 自身の語彙を導入してください)")
			}
		}
		main.cleanGenerated()
		test.cleanGenerated()
		EmitMain(ir, k, main, test, log).emitAll()
		EmitTests(ir, k, test, golden.snapshots, log).emitAll()
		for (n in golden.notes) log("note: $n")
		log("生成完了: main ${main.report().size} ファイル -> $mainOut / test ${test.report().size} ファイル -> $testOut")
	}
}
