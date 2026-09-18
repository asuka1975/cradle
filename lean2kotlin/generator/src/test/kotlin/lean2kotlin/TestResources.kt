package lean2kotlin

import java.nio.file.Path
import kotlin.io.path.readText

/** テストリソース(由来と採り直し方は src/test/resources/README.md)。 */
val testResources: Path = Path.of("src/test/resources")

fun sproutIr(): Ir = Ir.parse(testResources.resolve("sprout/sprout-ir.json").readText())

fun lobbyIr(): Ir = Ir.parse(testResources.resolve("lobby/lobby-ir.json").readText())
