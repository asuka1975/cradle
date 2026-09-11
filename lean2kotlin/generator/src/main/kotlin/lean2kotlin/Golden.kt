package lean2kotlin

import kotlinx.serialization.json.*
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.name
import kotlin.io.path.readText

/**
 * golden(対象プロジェクトの golden ディレクトリの JSON — Lean CLI の dump 出力)から
 * 読み取り側の回帰テストの源(状態と views の対)を読み出す。
 * 対象プロジェクト側に新しい宣言を要求せず、既存の golden だけを源にする。
 *
 * 読み方:
 * - `<name>-init.json`: init 応答 — シナリオの初期状態(と views)
 * - `<name>-flow.json`: dump 応答 — trace(command / state / views の列)。state と views を持つエントリが 1 スナップショット。init の無い flow は無視する
 * - `<name>.request.json`: 採取に使ったリクエスト — 読まない
 */

/** 状態と閲覧(views)の対 — 読み取り側の回帰テストの源。 */
data class GoldenSnapshot(val source: String, val state: JsonObject, val views: JsonObject)

data class GoldenLoad(
	val snapshots: List<GoldenSnapshot>,
	val notes: List<String>,
)

object Golden {

	fun load(dir: Path): GoldenLoad {
		val notes = mutableListOf<String>()
		val inits = mutableMapOf<String, JsonObject>()
		val initViews = mutableMapOf<String, JsonObject>()
		val flows = mutableListOf<Pair<String, JsonArray>>()

		val files = Files.list(dir).use { s ->
			s.filter { it.name.endsWith(".json") && !it.name.endsWith(".request.json") }.sorted().toList()
		}
		for (f in files) {
			val base = f.name.removeSuffix(".json")
			val parsed = runCatching { Json.parseToJsonElement(f.readText()).jsonObject }
			val j = parsed.getOrNull()
			if (j == null) {
				notes += "golden ${f.name}: JSON として読めないため無視(${parsed.exceptionOrNull()?.message})"
				continue
			}
			val ok = j["ok"] as? JsonObject
			when {
				base.endsWith("-init") && ok?.get("state") is JsonObject -> {
					inits[base.removeSuffix("-init")] = ok.getValue("state").jsonObject
					(ok["views"] as? JsonObject)?.let {
						initViews[base.removeSuffix("-init")] = it
					}
				}
				base.endsWith("-flow") && ok?.get("trace") is JsonArray ->
					flows += base.removeSuffix("-flow") to ok.getValue("trace").jsonArray
				else ->
					notes += "golden ${f.name}: init/flow のどちらでもないため無視"
			}
		}

		val snapshots = mutableListOf<GoldenSnapshot>()
		for ((prefix, st) in inits) {
			initViews[prefix]?.let { snapshots += GoldenSnapshot("$prefix-init", st, it) }
		}
		for ((prefix, trace) in flows) {
			if (inits[prefix] == null) {
				notes += "golden $prefix-flow: 初期状態(${prefix}-init.json)がないため無視"
				continue
			}
			trace.forEachIndexed { i, e ->
				val o = e.jsonObject
				val next = o["state"] as? JsonObject   // bad-command エントリは state を持たない
				val vws = o["views"] as? JsonObject
				if (next != null && vws != null) {
					snapshots += GoldenSnapshot("$prefix-flow #$i", next, vws)
				}
			}
		}
		return GoldenLoad(snapshots, notes)
	}
}
