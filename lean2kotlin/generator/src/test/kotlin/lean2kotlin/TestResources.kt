package lean2kotlin

import java.nio.file.Path
import kotlin.io.path.readText

/** テストリソース(由来と採り直し方は src/test/resources/README.md)。 */
val testResources: Path = Path.of("src/test/resources")

fun sproutIr(): Ir = Ir.parse(testResources.resolve("sprout/sprout-ir.json").readText())

fun lobbyIr(): Ir = Ir.parse(testResources.resolve("lobby/lobby-ir.json").readText())

fun miniIr(): Ir = Ir.parse(testResources.resolve("mini/ir.json").readText())

/** ir と golden を通した生成(出力は out の下の kotlin-main / kotlin-test / kotlin-adapter-test)のログを、出た順に字下げも残して返す。 */
fun generationLog(ir: Ir, golden: GoldenLoad, pkg: String, out: Path): List<String> {
	val lines = mutableListOf<String>()
	Lean2KotlinGeneration.generate(
		ir, golden, pkg, out.resolve("kotlin-main"), out.resolve("kotlin-test"), out.resolve("kotlin-adapter-test"), "\t") { lines += it }
	return lines
}

/** 生成完了の行だけは TempDir のパスを運ぶので、out を <out> に置き換える。 */
fun normalizedLog(lines: List<String>, out: Path): List<String> =
	lines.map { if (it.startsWith("生成完了: ")) it.replace(out.toString(), "<out>") else it }
