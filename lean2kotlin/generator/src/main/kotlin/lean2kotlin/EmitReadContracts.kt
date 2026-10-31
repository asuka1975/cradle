package lean2kotlin

import kotlinx.serialization.json.*

// ───────────────────────── 読み取り(views)の golden 回帰テスト

/**
 * Row の JSON 要素に無いフィールドを、入れ子の Row(Ref / ListOf / OptionOf の中)まで
 * 辿って経路(外側Row.field.内側Row.field)で集める。Row 以外の Ref(VO / enum / sealed)
 * は辿らない — そこの欠けは literal の require が拾う本当のエラー。
 */
internal fun EmitTests.collectMissingRowFields(td: IrTypeDef, o: JsonObject, path: String, out: MutableSet<String>) {
	val shape = td.shape as? IrShape.Structure ?: return
	for (f in shape.fields) {
		val v = o[f.name]
		if (v == null) out += "$path.${f.name}"
		else collectMissingIn(f.type, v, "$path.${f.name}", out)
	}
}

internal fun EmitTests.collectMissingIn(t: IrType, j: JsonElement, path: String, out: MutableSet<String>) {
	when (t) {
		is IrType.Ref -> {
			val td = ir.typeDef(t.lean)
			if (td.role == "readModelRow" && j is JsonObject)
				collectMissingRowFields(td, j, "$path.${td.kotlin}", out)
		}
		is IrType.ListOf -> (j as? JsonArray)?.forEach { collectMissingIn(t.of, it, path, out) }
		is IrType.OptionOf -> if (j !is JsonNull) collectMissingIn(t.of, j, path, out)
		is IrType.WithDefault -> collectMissingIn(t.of, j, path, out)
		else -> {}
	}
}

/** メソッド引数の型からハーネス実引数を合成する(合成できない型なら null)。 */
internal fun EmitTests.synthesizeArg(t: IrType, state: JsonObject): String? = when (t) {
	is IrType.ListOf -> {
		val ref = t.of as? IrType.Ref ?: return null
		val td = ir.typeDef(ref.lean)
		if (td.role != "readModelRow") return null
		// Row 型 → 状態コレクション(<Xxx>Row → xxxs)から射影。要素の余剰フィールドは
		// 無視し、Row にあって要素に無いフィールド(計算する読み取りモデル)は入れ子の
		// Row まで検査して飛ばす
		val key = decapitalizeFirst(td.kotlin.removeSuffix("Row")) + "s"
		val arr = state[key]?.jsonArray ?: return null
		if (td.shape !is IrShape.Structure) return null
		val elems = arr.map { it as? JsonObject ?: return null }
		val missing = linkedSetOf<String>()
		for (e in elems) collectMissingRowFields(td, e, td.kotlin, missing)
		if (missing.isNotEmpty()) {
			if (notedRows.add(td.kotlin to key))
				log("  note: ${td.kotlin}: 状態 $key の要素に無いフィールド ${missing.joinToString(", ")} — " +
					"計算する読み取りモデルは golden の状態から合成できません(読み取りの回帰は Lean の golden-check と E2E が担う)")
			return null
		}
		"listOf<${k.name(td.lean)}>(${arr.joinToString(", ") { k.refLiteral(td, it) }})"
	}
	is IrType.Ref -> {
		val td = ir.typeDef(t.lean)
		val shape = td.shape as? IrShape.Structure ?: return null
		when {
			// 全フィールドに既定値がある VO は既定コンストラクタ
			td.role == "valueObject" && shape.fields.all { it.type is IrType.WithDefault } ->
				"${k.name(t.lean)}()"
			// 観測の Set(ReadModel)— 状態から行を射影して構築する fixture
			td.role == "readModel" -> {
				val args = shape.fields.map { f ->
					val v = synthesizeArg(f.type, state) ?: return null
					"${ident(f.name)} = $v"
				}
				"${k.name(t.lean)}(${args.joinToString(", ")})"
			}
			// クエリ DTO: フィールドを規則合成して構築(空なら data object)
			td.role == "viewDto" -> {
				if (shape.fields.isEmpty()) k.name(t.lean)
				else {
					val args = shape.fields.map { f ->
						val v = synthesizeArg(f.type, state) ?: return null
						"${ident(f.name)} = $v"
					}
					"${k.name(t.lean)}(${args.joinToString(", ")})"
				}
			}
			else -> null
		}
	}
	is IrType.WithDefault -> synthesizeArg(t.of, state)
	IrType.Nat -> "42L"   // seed — golden は CLI 既定シード 42 で採取される(プロトコル規約)
	is IrType.Arrow -> {
		// (Id) -> Nat: 仮置き表現の数値鍵(golden は Runtime 表現で採取)
		val from = t.from as? IrType.Ref ?: return null
		val td = ir.typeDef(from.lean)
		val f = (td.shape as? IrShape.Structure)?.fields?.singleOrNull() ?: return null
		if (td.isId && t.to == IrType.Nat) "{ x -> x.${ident(f.name)} }" else null
	}
	else -> null
}

/** golden 回帰の対象のメソッドと、照らす golden views のキー(null は views 全体を束ねる DTO)。 */
internal data class GoldenTarget(val method: IrMethod, val screenKey: String?)

/**
 * golden 回帰の対象(参照系)を UseCase 名ごとに ir.useCases の順で集める — emit は定理由来のケースと同じ
 * <UseCase>ContractTest に束ねる(EmitTests.emitTheoremContractTests が担う)。
 */
internal fun planGoldenTargets(ir: Ir, snapshots: List<GoldenSnapshot>): Map<String, GoldenTarget> {
	val plan = linkedMapOf<String, GoldenTarget>()
	if (snapshots.isNotEmpty()) {
		// 計画の基準は views を持つ最初のスナップショット(外部能力の golden では refused / fault が先に来ることがある)
		val v0 = snapshots.firstOrNull { it.views.isNotEmpty() }?.views ?: snapshots.first().views
		for (s in ir.useCases) {
			for (m in s.methods.filter { it.name == "execute" }) {
				val okT = (m.ret as? IrType.Result)?.ok ?: m.ret
				// 対象 1(束): 成功側が「画面束ね」DTO(フィールドが golden views のキーと一致)。
				// 束が Runtime 在住のプロジェクトでは現れない(Runtime は抽出の対象外)
				val retTd = (okT as? IrType.Ref)?.let { ir.typeDef(it.lean) }
				val fields = (retTd?.shape as? IrShape.Structure)?.fields
				if (retTd?.role == "viewDto" && !fields.isNullOrEmpty() &&
					fields.all { v0.containsKey(it.name) }) {
					plan[s.name] = GoldenTarget(m, null)
					continue
				}
				// 対象 2(画面): golden views のキー = UseCase 名(UseCase 接尾辞を
				// 剥いで先頭小文字)で、成功側が View DTO を運ぶ
				val key = decapitalizeFirst(s.module.removeSuffix("UseCase"))
				if (v0.containsKey(key) && okT.leafRefs().any {
						ir.typeDef(it).role == "viewDto" })
					plan[s.name] = GoldenTarget(m, key)
			}
		}
	}
	return plan
}

/**
 * 参照系 UseCase の契約テスト(1 UseCase 1 クラス): golden 回帰と @[contract]
 * 定理由来のケースを同じ契約面(execute)に束ねる。観測の Set(ReadModel)は
 * fixture として配線し、返り値をオラクル(golden / Lean 内評価)と突き合わせる。
 * 判断・射影の定理も入力の選択器としてここへ流れ込む — 検証面は常に本番の execute。
 */
internal fun EmitTests.emitReadUseCaseContractTest(
	s: IrService, contracts: List<IrContract>, golden: GoldenTarget?,
) {
	val m = golden?.method ?: s.methods.find { it.name == "execute" }
		?: s.methods.firstOrNull() ?: return
	val screenKey = golden?.screenKey
	val kept = m.params.filterNot { k.isUseCasePlumbing(it.type) }
	val errT = (m.ret as? IrType.Result)?.err
	val okT = (m.ret as? IrType.Result)?.ok ?: m.ret
	// View→ドメイン語彙の壁: 期待値(View・エラー)が interface 化された語彙へ
	// 到達する場合、本番値の等価比較もリテラル生成も成立しない — ケースを生成せず
	// note で明示する(是正はモデル側で View 自身の語彙を導入)
	val viewWall = listOfNotNull(okT, errT).any { t -> t.leafRefs().any { k.reachesEntityLike(IrType.Ref(it)) } }
	// 入力(Query の DTO 等)が届く場合も本番語彙の実引数を組めない — 実体化フックで組むと
	// Runner の note(該当の参照系ケースは生成されない)に反するので、同じくケースを生成しない
	val wallInputs = kept.filter { k.reachesEntityLike(it.type) }
	val inputWall = wallInputs.isNotEmpty()
	// 配管(ReadModel・鍵・主体・時計)は役割ごとにファクトリ引数へ — ReadModel はフィールドに展開、
	// 主体(actorPort)は丸ごと 1 引数(値は定理由来のケースの args が運ぶ)、時計(clockPort)は
	// Clock のフィールドごと(遷移契約と同じ固定の today。値はケースの args の時計が運ぶ)
	data class FactoryParam(
		val name: String, val type: IrType, val fromRmField: IrField?,
		val fromArgs: Boolean = false,
		/** 時計のフィールドなら、それを受ける引数名(1 つ以上)。 */
		val clockParams: List<String> = emptyList(),
	)
	val factoryParams = mutableListOf<FactoryParam>()
	val clocks = clockFieldsOf(s, listOf(m)).associateBy { it.field.name }
	// 参照系の配線を持たない配管(State・外部能力の観測・precise な入力)と役割 — note してケースを生成しない
	val unwired = mutableListOf<Pair<IrField, String>>()
	for (p in m.params.filter { k.isUseCasePlumbing(it.type) }) {
		when (val t = p.type) {
			is IrType.Ref -> {
				val td = ir.typeDef(t.lean)
				val fields = (td.shape as? IrShape.Structure)?.fields
				when {
					td.role == "actorPort" -> factoryParams += FactoryParam(p.name, p.type, null, fromArgs = true)
					td.role == "readModel" && fields != null ->
						for (f in fields) factoryParams += FactoryParam(f.name, f.type, f)
					td.role == "clockPort" && fields != null ->
						for (f in fields) if (factoryParams.none { it.name == f.name && it.clockParams.isNotEmpty() })
							factoryParams += FactoryParam(f.name, f.type, null, clockParams = clocks.getValue(f.name).paramNames)
					else -> unwired += p to (if (k.isPlumbing(t)) td.role else "precise な入力")
				}
			}
			else -> factoryParams += FactoryParam(p.name, p.type, null)
		}
	}
	val noCases = viewWall || inputWall || unwired.isNotEmpty()
	emitFile(k.useCasePackage(s.module), "${s.name}ContractTest",
		framework = junitImports, usesDomainResult = errT != null) {
		val sb = StringBuilder()
		sb.append("/**\n")
		sb.append(" * Lean: `${s.module}` の参照系契約テスト — 状態から読み取り行を射影して\n")
		sb.append(" * 実装に配線し(取得と鍵は署名に現れない — 実装の配線)、${m.name} の返り値を\n")
		sb.append(" * golden と @[contract] 定理由来のオラクル(Lean 内評価)に突き合わせる。\n")
		sb.append(" * seed は CLI 既定 42、パラメータは既定値、数値鍵は仮置き表現の写し。\n")
		sb.append(" */\n")
		sb.append("abstract class ${s.name}ContractTest {\n")
		// 時計のフィールドはフックの引数に並ぶ — 遷移契約のフックと同じく何を渡すかを書く
		val clockFields = factoryParams.filter { it.clockParams.isNotEmpty() }
		val clockDoc = if (clockFields.isNotEmpty())
			"。時計は固定の ${clockFields.joinToString("・") { it.name }} を配線する(Clock ポート)" else ""
		sb.append("\t/** 行と鍵を実装へ配線して返す(例: インメモリの読み取りストア)$clockDoc。 */\n")
		sb.append("\tprotected abstract fun useCase(" +
			factoryParams.joinToString(", ") { "${ident(it.name)}: ${k.typeRef(it.type)}" } +
			"): ${s.name}\n")
		var emitted = 0
		if (viewWall) {
			log("  note: ${s.name}: View→ドメイン語彙の壁の破れ(期待値が interface 化された語彙を運ぶ)— 参照系ケースは生成できません(モデル側の是正待ち)")
		}
		for (p in wallInputs) {
			log("  note: ${s.name}: View→ドメイン語彙の壁の破れ(入力 ${p.name} が interface 化された語彙を運ぶ)— 参照系ケースは生成できません(モデル側の是正待ち)")
		}
		for ((p, role) in unwired) {
			log("  note: ${s.name}.${m.name}: 配線 ${p.name}(${role})は参照系の契約テストに写せません — 参照系ケースは生成できません")
		}
		if (golden != null && !noCases) for (snap in goldenSnapshots) {
			val viewJson = if (screenKey == null) snap.views else snap.views[screenKey]
			if (viewJson == null) {
				log("  note: ${s.name}.${m.name}: golden ${snap.source} に $screenKey がないためスキップ")
				continue
			}
			val realArgs = kept.map { p -> synthesizeArg(p.type, snap.state) }
			val wired = factoryParams.map { fp ->
				if (fp.fromRmField != null) synthesizeArg(fp.fromRmField.type, snap.state)
				// golden の状態は時計を運ばない — 時計を受ける参照系の golden は合成できずスキップする
				else if (fp.clockParams.isNotEmpty()) null
				else synthesizeArg(m.params.first { it.name == fp.name }.type, snap.state)
			}
			if (realArgs.any { it == null } || wired.any { it == null }) {
				log("  note: ${s.name}.${m.name}: 引数を合成できないため ${snap.source} をスキップ")
				continue
			}
			val expected = k.literal(okT, viewJson)
			val expectedWrapped = if (errT != null) "DomainResult.Ok($expected)" else expected
			sb.append("\n\t@Test\n")
			sb.append("\tfun `${m.name} は golden ${testNameSafe(snap.source)} を再現する`() {\n")
			sb.append("\t\tassertEquals($expectedWrapped,\n")
			sb.append("\t\t\tuseCase(${wired.joinToString(", ") { it!! }})" +
				".${ident(m.name)}(${realArgs.joinToString(", ") { it!! }}))\n")
			sb.append("\t}\n")
			emitted++
		}
		for (c in contracts) {
			// 参照系の検証面は本番の execute(golden 対象メソッド)— それ以外の面
			// (validate 等)に付いた契約は読み飛ばす(execute 面と仮定すると
			// 期待値の型を取り違える)
			if (c.method != m.name) {
				log("  note: ${c.theorem}: 対象 ${c.method} は参照系の検証面(${m.name})ではないため読み飛ばし")
				continue
			}
			if (noCases) continue
			c.cases.forEachIndexed { i, case ->
				if (case.kind != "value" || case.readModel == null) {
					log("  note: ${c.theorem}(${i + 1}): 値形でないためスキップ")
					return@forEachIndexed
				}
				val rmObj = case.readModel as? JsonObject ?: return@forEachIndexed
				val wired = factoryParams.map { fp ->
					if (fp.fromArgs) {
						// 主体(actorPort): 定理が選んだ固定の主体を配線する
						val j = case.args[fp.name] ?: run {
							log("  note: ${c.theorem}: 主体 ${fp.name} がケースにありません")
							return@forEachIndexed
						}
						inputLiteral(fp.type, j)
					} else if (fp.fromRmField != null) {
						val j = rmObj[fp.name] ?: run {
							log("  note: ${c.theorem}: ReadModel に ${fp.name} がありません")
							return@forEachIndexed
						}
						k.literal(fp.type, j)
					} else if (fp.clockParams.isNotEmpty()) {
						// 時計(clockPort): 定理が選んだ日を配線する(ケースに無ければ既定値 — 遷移契約と同じ)
						fp.clockParams.firstNotNullOfOrNull { (case.args[it] as? JsonObject)?.get(fp.name) }?.let { k.literal(fp.type, it) }
							?: defaultLiteral(fp.type) ?: run {
								log("  note: ${c.theorem}: 時計 ${fp.name} の値を構成できません")
								return@forEachIndexed
							}
					} else {
						// 鍵などの矢印は仮置き表現の写し
						synthesizeArg(fp.type, JsonObject(emptyMap())) ?: run {
							log("  note: ${c.theorem}: 配線 ${fp.name} を合成できません")
							return@forEachIndexed
						}
					}
				}
				val callArgs = caseCallArgs(kept, case.args, c.theorem) ?: return@forEachIndexed
				val expected = when {
					case.error != null && errT != null ->
						"DomainResult.Err(${k.literal(errT, case.error)})"
					case.ok != null -> {
						val okLit = k.literal(okT, case.ok)
						if (errT != null) "DomainResult.Ok($okLit)" else okLit
					}
					else -> return@forEachIndexed
				}
				val doc = kdocLine(c.doc)
				sb.append("\n$doc\t@Test\n")
				sb.append("\tfun `${theoremTestName(m.name, c.theorem, i)}`() {\n")
				sb.append("\t\tassertEquals($expected,\n")
				sb.append("\t\t\tuseCase(${wired.joinToString(", ")})" +
					".${ident(m.name)}(${callArgs.joinToString(", ")}))\n")
				sb.append("\t}\n")
				emittedContracts += contractKey(c)
				emitted++
			}
		}
		sb.append("}")
		log("  note: 契約テスト: ${s.name} — golden+定理で $emitted ケース(参照系)")
		sb.toString()
	}
}

/**
 * Retrieve テスト(DDL):
 * スキーマ+抽出(SQL 等)が、状態から**観測の Set(ReadModel)そのもの**を
 * 復元できるか — DB スキーマ → ReadModel の変換可能性。Retrieve の単位は
 * 各 UseCase の ReadModel(Row は素材)。
 * 入力は状態の集約コレクション。
 */
internal fun EmitTests.emitDdlContractTest(projCs: List<IrContract>) {
	// Retrieve の受け皿: フィールドがすべて Row 列の ReadModel
	fun rowLeanOf(t: IrType): String? =
		((t as? IrType.ListOf)?.of as? IrType.Ref)?.lean
			?.takeIf { ir.typeDef(it).role == "readModelRow" }
	val rms = ir.types.filter { it.role == "readModel" }.sortedBy { it.kotlin }
		.mapNotNull { rm ->
			val fields = (rm.shape as? IrShape.Structure)?.fields
			if (fields.isNullOrEmpty() || !fields.all { rowLeanOf(it.type) != null }) {
				log("  note: ${rm.kotlin}: Row 列以外のフィールドを持つため Retrieve テスト対象外")
				null
			} else rm to fields
		}
	val aggs = ir.types.filter { it.role == "aggregateRoot" }.sortedBy { it.kotlin }
	if (rms.isEmpty() || aggs.isEmpty()) return
	emitFile("application", "ReadModelDdlContractTest", framework = junitImports) {
		val sb = StringBuilder()
		// 入力は fixture(データの種)— スキーマへの載せ方は実装の自由。
		// 参照収集(import 計算)ブロックの**内側**で組むこと — 外で組むと
		// golden ケースが 0 件の構成で fixture の import が欠ける
		val aggParams = aggs.joinToString(", ") {
			"${ident(decapitalizeFirst(it.kotlin) + "s")}: List<${k.fixtureName(it)}>"
		}
		sb.append("/**\n")
		sb.append(" * Retrieve テスト(DDL):\n")
		sb.append(" * スキーマ+抽出(SQL 等)が、検証済みコマンド経路で構築された状態(golden)や\n")
		sb.append(" * 射影定理の選んだ状態から、**観測の Set(ReadModel)そのもの**を復元できるか —\n")
		sb.append(" * DB スキーマ → ReadModel の変換可能性(Persistence Refinement の実装形)。\n")
		sb.append(" * 行の並びはコレクション順(= 保存順)。**順序も永続化が保持すべき情報**。\n")
		sb.append(" * 実装は状態(集約)を自分のスキーマへ載せ、自分の抽出で ReadModel を復元して返す。\n")
		sb.append(" */\n")
		sb.append("abstract class ReadModelDdlContractTest {\n")
		for ((rm, _) in rms) {
			sb.append("\t/** 集約をスキーマへ載せ、Retrieve で ${rm.kotlin}(観測の Set)を復元して返す。 */\n")
			sb.append("\tprotected abstract fun retrieve${rm.kotlin}($aggParams): " +
				"${k.typeRef(IrType.Ref(rm.lean))}\n")
		}
		var emitted = 0
		for (snap in goldenSnapshots) {
			val aggArgs = aggs.map { td ->
				snap.state[decapitalizeFirst(td.kotlin) + "s"]?.jsonArray?.let { arr ->
					"listOf<${k.fixtureName(td)}>(${arr.joinToString(", ") { k.refLiteral(td, it) }})"
				}
			}
			if (aggArgs.any { it == null }) continue
			for ((rm, fields) in rms) {
				val fieldLits = fields.map { f ->
					synthesizeArg(f.type, snap.state)?.let { "${ident(f.name)} = $it" }
				}
				if (fieldLits.any { it == null }) continue
				sb.append("\n\t@Test\n")
				sb.append("\tfun `${rm.kotlin} は golden ${testNameSafe(snap.source)} の状態から Retrieve できる`() {\n")
				sb.append("\t\tassertEquals(${k.typeRef(IrType.Ref(rm.lean))}(" +
					"${fieldLits.joinToString(", ") { it!! }}),\n")
				sb.append("\t\t\tretrieve${rm.kotlin}(${aggArgs.joinToString(", ") { it!! }}))\n")
				sb.append("\t}\n")
				emitted++
			}
		}
		// 射影(Application/Projection)の @[contract] 定理から演繹したケース —
		// 期待値は射影の Lean 評価。受け皿は
		// 当該 Row の列を持つ最初の ReadModel(他の集約は空入力 — 空の射影は空)
		for (c in projCs) {
			val rowTd = c.rowType?.let { ir.typeDef(it) } ?: continue
			val stateTd = ir.typeDef(c.useCase)
			val rootTd = rootOfStateType(stateTd) ?: continue
			val collField = k.rootCollectionOf(rootTd)?.coll?.name ?: continue
			val (rm, fields) = rms.firstOrNull { (_, fs) ->
				fs.any { rowLeanOf(it.type) == rowTd.lean }
			} ?: continue
			// Retrieve フックは集約の列だけを受ける — ほかのフィールドに依る射影は入力に渡せず、矛盾するテストになりうる
			val extra = (stateTd.shape as? IrShape.Structure)?.fields.orEmpty().map { it.name } - collField
			if (extra.isNotEmpty()) {
				log("  note: ${rowTd.kotlin}: 観測モデル ${stateTd.kotlin} の集約の列のほかのフィールド(${extra.joinToString("・")})は Retrieve フックに渡せないので、射影定理 ${c.theorem} のケースを生成できません")
				continue
			}
			c.cases.forEachIndexed { i, case ->
				if (case.kind != "projection" || case.ok == null) return@forEachIndexed
				val stJson = case.args.values.singleOrNull() as? JsonObject ?: return@forEachIndexed
				val arr = stJson[collField] as? JsonArray ?: return@forEachIndexed
				val aggArgs = aggs.map { td ->
					if (td.lean == rootTd.lean)
						"listOf<${k.fixtureName(td)}>(${arr.joinToString(", ") { k.refLiteral(td, it) }})"
					else "emptyList()"
				}
				val fieldLits = fields.map { f ->
					if (rowLeanOf(f.type) == rowTd.lean)
						"${ident(f.name)} = ${k.literal(f.type, case.ok)}"
					else "${ident(f.name)} = emptyList()"
				}
				val doc = kdocLine(c.doc)
				sb.append("\n$doc\t@Test\n")
				sb.append("\tfun `retrieve${rm.kotlin} は ${rowTd.kotlin} の定理 " +
					"${c.theorem} を再現する(${i + 1})`() {\n")
				sb.append("\t\tassertEquals(${k.typeRef(IrType.Ref(rm.lean))}(" +
					"${fieldLits.joinToString(", ")}),\n")
				sb.append("\t\t\tretrieve${rm.kotlin}(${aggArgs.joinToString(", ")}))\n")
				sb.append("\t}\n")
				emittedContracts += contractKey(c)
				emitted++
			}
		}
		sb.append("}")
		if (emitted == 0) log("  note: ReadModelDdlContractTest: 生成できたケースが 0 件です")
		else log("  note: Retrieve テスト: ReadModel ${rms.size} 種 — golden+射影定理で $emitted ケース")
		sb.toString()
	}
}
