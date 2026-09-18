package lean2kotlin

import kotlinx.serialization.json.*
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.name
import kotlin.io.path.readText

/**
 * golden(対象プロジェクトの golden ディレクトリの JSON — Lean CLI の応答)から
 * 読み取り側の回帰テストの源(状態と views の対)を読み出す。
 * 対象プロジェクト側に新しい宣言を要求せず、既存の golden だけを源にする。
 *
 * 読み方:
 * - `<name>-init.json`: init 応答 — シナリオの初期状態(と views)
 * - `<name>-flow.json`: flow 応答 — trace(入力 / state / views の列)。state と views を持つエントリが 1 スナップショット。init の無い flow は無視する
 * - `<name>.request.json`: 採取に使ったリクエスト(脇書き)。`{"version":1,"init":…,"flow":…}` の形で、`version` の無い旧形式は
 *   従来の形(cmd init / flow)の golden にだけ許す(黙って受ける)。`version` があって 1 でなければ経路に依らず読めない(error)。
 *   外部能力を使う golden かは `init.cmd` が `external` かで決まり(`version` は見ない)、脇書きが無ければ応答の形で見分ける
 *   (init 応答に `ok.env` があるか、trace の要素に `env` か `result` があるか — 従来の応答にはどれも無い)。
 *
 * 外部能力を使う golden は、init 応答が `ok.env`(環境 = script と cursor)を、trace の各エントリが `result`(applied / refused / fault)・
 * `env`・`interactions` を運び、refused / fault のエントリも state と views を持つのでスナップショットにする。
 * fault のエントリは指名した障害契約 `faultContract`(name と portCalls)を運び、[checkFaults] で IR の障害契約と突き合わせる。
 *
 * 再生できない golden は error(生成の失敗)に集める: 外部能力の golden に版 1 の外部能力の脇書きが無い、
 * 脇書きの版が読めない、外部能力の golden の init / flow 応答がトップに `ok` を持たない(`error` / `harnessError`)、
 * fault のエントリが障害契約を指名していない、指名した障害契約が IR に無い・portCalls が違う。
 */

/** fault のエントリが指名した障害契約(trace の `faultContract`)。 */
data class GoldenFaultContract(
	/** `<UseCase>.<def>` */
	val name: String,
	/** 消費位置(中断までに Port を呼んだ回数) */
	val portCalls: Int,
)

/** 状態と閲覧(views)の対 — 読み取り側の回帰テストの源。外部能力の golden では result / env / interactions も運ぶ。 */
data class GoldenSnapshot(
	val source: String,
	val state: JsonObject,
	val views: JsonObject,
	/** trace エントリの結果(applied / refused / fault)。init と従来の golden では null */
	val result: String? = null,
	/** 適用後の環境(script と cursor)。従来の golden では null */
	val env: JsonElement? = null,
	/** そのエントリで起きた Port との往復。従来の golden では空 */
	val interactions: List<JsonElement> = emptyList(),
	/** fault のエントリが指名した障害契約。fault 以外では null */
	val faultContract: GoldenFaultContract? = null,
)

data class GoldenLoad(
	val snapshots: List<GoldenSnapshot>,
	val notes: List<String>,
	/** 再生できない golden(生成を失敗にする) */
	val errors: List<String> = emptyList(),
)

object Golden {

	/** 読める脇書きの版(cmd external の版でもある) */
	const val SIDECAR_VERSION = 1

	/** 読めた脇書き: 版を持つか(旧形式は持たない)と、外部能力を使う golden を宣言しているか(`init.cmd` が `external`)。 */
	private data class Sidecar(val versioned: Boolean, val external: Boolean)

	fun load(dir: Path): GoldenLoad {
		val notes = mutableListOf<String>()
		val errors = mutableListOf<String>()
		val sidecars = mutableMapOf<String, Sidecar>()
		val unreadable = mutableSetOf<String>()                           // 版が読めない脇書きの prefix — その golden は読まない
		val inits = mutableMapOf<String, Pair<String, JsonObject>>()      // prefix -> (ファイル名, init 応答)
		val flows = mutableMapOf<String, Pair<String, JsonObject>>()      // prefix -> (ファイル名, flow 応答)

		val files = Files.list(dir).use { s -> s.filter { it.name.endsWith(".json") }.sorted().toList() }
		for (f in files) {
			val parsed = runCatching { Json.parseToJsonElement(f.readText()).jsonObject }
			val j = parsed.getOrNull()
			if (j == null) {
				notes += "golden ${f.name}: JSON として読めないため無視(${parsed.exceptionOrNull()?.message})"
				continue
			}
			if (f.name.endsWith(".request.json")) {
				val prefix = f.name.removeSuffix(".request.json")
				val version = j["version"]
				when {
					version == null -> sidecars[prefix] = Sidecar(versioned = false, external = declaresExternal(j))
					version is JsonPrimitive && !version.isString && version.intOrNull == SIDECAR_VERSION ->
						sidecars[prefix] = Sidecar(versioned = true, external = declaresExternal(j))
					else -> {
						errors += "golden $prefix の脇書き ${f.name} の version $version は読めない（読める版は $SIDECAR_VERSION）"
						unreadable += prefix
					}
				}
				continue
			}
			val base = f.name.removeSuffix(".json")
			when {
				base.endsWith("-init") -> inits[base.removeSuffix("-init")] = f.name to j
				base.endsWith("-flow") -> flows[base.removeSuffix("-flow")] = f.name to j
				else -> notes += "golden ${f.name}: init/flow のどちらでもないため無視"
			}
		}

		// prefix ごとに読める golden かを決める(外部能力の golden は版 1 の外部能力の脇書きと ok の応答が要る)
		val readable = mutableSetOf<String>()
		for (prefix in (inits.keys + flows.keys).distinct()) {
			if (prefix in unreadable) continue
			val init = inits[prefix]
			val flow = flows[prefix]
			val initOk = init?.second?.get("ok") as? JsonObject
			val flowOk = flow?.second?.get("ok") as? JsonObject
			// 外部能力を使う golden か: 脇書きがあればその宣言、無ければ応答の形(version は見ない)
			val marked = initOk?.get("env") != null ||
				(flowOk?.get("trace") as? JsonArray)?.any { e -> (e as? JsonObject)?.let { it["result"] != null || it["env"] != null } == true } == true
			val sidecar = sidecars[prefix]
			if (sidecar?.external ?: marked) {
				// 再生には版 1 の外部能力の脇書き(環境・入力列)が要る。旧形式の脇書き・cmd init の脇書きでは足りない
				if (sidecar == null || !sidecar.versioned || !sidecar.external) {
					errors += "外部能力を使う golden $prefix は $prefix.request.json（版・環境・入力列）が無いと再生できない"
					continue
				}
				// 応答のトップが ok でない(error / harnessError)golden は採り直しの対象で、再生できない
				val notOk = listOfNotNull(init, flow).filter { (_, j) -> j["ok"] !is JsonObject }
				for ((file, j) in notOk) {
					errors += "外部能力を使う golden $prefix の $file は ok の応答でない（${j.keys.joinToString(", ")}）— 再生できない"
				}
				if (notOk.isNotEmpty()) continue
			}
			readable += prefix
		}

		// スナップショットは init の列、次に flow の列(どちらもファイル名順)
		val snapshots = mutableListOf<GoldenSnapshot>()
		val states = mutableMapOf<String, JsonObject>()   // prefix -> 初期状態
		for ((prefix, init) in inits) {
			if (prefix !in readable) continue
			val ok = init.second["ok"] as? JsonObject
			val state = ok?.get("state") as? JsonObject
			if (state == null) {
				notes += "golden ${init.first}: init/flow のどちらでもないため無視"
				continue
			}
			states[prefix] = state
			val vws = ok["views"] as? JsonObject ?: continue
			snapshots += GoldenSnapshot("$prefix-init", state, vws, env = ok["env"])
		}
		for ((prefix, flow) in flows) {
			if (prefix !in readable) continue
			val trace = (flow.second["ok"] as? JsonObject)?.get("trace") as? JsonArray
			if (trace == null) {
				notes += "golden ${flow.first}: init/flow のどちらでもないため無視"
				continue
			}
			if (states[prefix] == null) {
				notes += "golden $prefix-flow: 初期状態(${prefix}-init.json)がないため無視"
				continue
			}
			trace.forEachIndexed { i, e ->
				val o = e.jsonObject
				val next = o["state"] as? JsonObject   // 従来の bad-command エントリは state を持たない
				val vws = o["views"] as? JsonObject
				if (next == null || vws == null) return@forEachIndexed
				val result = (o["result"] as? JsonPrimitive)?.takeIf { it.isString }?.content
				val fault = (o["faultContract"] as? JsonObject)?.let { fc ->
					val name = (fc["name"] as? JsonPrimitive)?.takeIf { it.isString }?.content
					val portCalls = (fc["portCalls"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
					if (name != null && portCalls != null) GoldenFaultContract(name, portCalls) else null
				}
				if (result == "fault" && fault == null) {
					errors += "外部能力を使う golden $prefix-flow #$i は fault のエントリなのに障害契約の指名 faultContract（name と portCalls）を持たない — 再生できない"
					return@forEachIndexed
				}
				snapshots += GoldenSnapshot("$prefix-flow #$i", next, vws,
					result = result,
					env = o["env"],
					interactions = (o["interactions"] as? JsonArray)?.toList() ?: emptyList(),
					faultContract = fault.takeIf { result == "fault" })
			}
		}
		return GoldenLoad(snapshots, notes, errors)
	}

	/**
	 * fault のエントリが指名した障害契約を IR の障害契約(`<UseCase>.<def>` と Lean の署名から導いた portCalls)と突き合わせる。
	 * 名前が IR に無い・portCalls が違う golden は、生成する障害契約テストと食い違うので再生できない(error)。
	 */
	fun checkFaults(load: GoldenLoad, ir: Ir): List<String> = load.snapshots.mapNotNull { s ->
		val fc = s.faultContract ?: return@mapNotNull null
		val declared = ir.faultContracts.find { "${it.useCase}.${it.def}" == fc.name }
		when {
			declared == null ->
				"golden ${s.source}: 障害契約 ${fc.name}（portCalls ${fc.portCalls}）が IR の障害契約に無い" +
					"（IR: ${ir.faultContracts.joinToString(", ") { "${it.useCase}.${it.def}" }.ifEmpty { "無し" }}）"
			declared.portCalls != fc.portCalls ->
				"golden ${s.source}: 障害契約 ${fc.name} の portCalls が合わない — golden は ${fc.portCalls}、IR（Lean の署名）は ${declared.portCalls}"
			else -> null
		}
	}

	/** 脇書きが外部能力を使う golden を宣言しているか(`init.cmd` が `external`)。 */
	private fun declaresExternal(sidecar: JsonObject): Boolean =
		((sidecar["init"] as? JsonObject)?.get("cmd") as? JsonPrimitive)?.takeIf { it.isString }?.content == "external"
}
