package lean2kotlin

/**
 * main ソース(型と interface)の生成。生成先パッケージは Lean のディレクトリ構成の写し
 * (Kotlinize.packagePathOf)。DomainResult はルート。
 * 生成するのは interface と不変データのみ — default メソッド・実装は絶対に生成しない。
 * テスト専用語彙(Row・ReadModel・Factory)は testOut に出す。note は log に流す。
 */
class EmitMain(
	private val ir: Ir,
	private val k: Kotlinize,
	private val out: Output,
	private val testOut: Output,
	private val log: (String) -> Unit,
) {

	fun emitAll() {
		emitFile(null, "DomainResult") { domainResultBody }
		for (td in ir.types) {
			when (td.role) {
				// Row はテスト専用の概念(DB スキーマ → Read Model の変換可能性の
				// チェック = DDL テスト。スキーマ設計の導き)。
				// main に出るのは View→Row の壁が破れている間の橋だけ(Runner が警告)
				"readModelRow" -> emitFile(k.packagePathOf(td), td.kotlin,
					toTest = td.lean !in mainReachable) { dataTypeBody(td) }
				// State(RepositoryState)は Lean 側の意味論装置(遷移契約の量化対象・
				// オラクルの源)— 観測は本物の Repository で行い、テストは before を
				// 集約 fixture 列に分解して播種するため、Kotlin には写さない
				"repositoryState" -> {}
				// 観測の Set(ReadModel)は fixture 語彙 — 生成テストが配線に使う
				"readModel" -> emitFile(k.packagePathOf(td), td.kotlin,
					toTest = true) { dataTypeBody(td) }
				// 時計ポート(Clock): 調達の引数種。interface は生成しない —
				// Kotlin 実装は正準の seam(java.time.Clock)を直接注入する
				"clockPort" -> log("  note: ${td.kotlin}: 時計ポート — 生成しない" +
					"(実装は java.time.Clock を直接注入。契約テストは固定 today を配線)")
				// 主体ポート(@[actorContext]): 調達の引数種だが、Clock と違い
				// JDK に正準型が無いため型(data class)は main に生成する。
				// 本番の UseCase 署名からは落ちる(isPlumbing — 実装の配線)
				"actorPort" -> emitFile(k.packagePathOf(td), td.kotlin) { actorPortBody(td) }
				else -> emitFile(k.packagePathOf(td), td.kotlin) { dataTypeBody(td) }
			}
		}
		for (td in ir.types.filter { it.role == "aggregateRoot" }) {
			// Repository はドメインの持ち物、かつ Entity / ValueObject と同格の専用ディレクトリ
			emitFile(k.repositoryPackage, "${td.kotlin}Repository") { repositoryBody(td) }
		}
		for (s in ir.queryServices) {
			// QueryService は本番の取得ポート(参照系 UseCase が内部で呼ぶ)— main。
			// ただし Row は「DB スキーマ → Read Model の変換可能性」をチェックする
			// テスト専用の概念なので、Row を運ぶメソッドは本番
			// interface に写せない — 除外して note で明示する(取得の契約面には
			// Row によらない形が必要 = モデル側の宿題)
			val kept = s.methods.filter { m ->
				val refs = m.params.filterNot { isPlumbing(it.type) }
					.flatMap { it.type.leafRefs() } + m.ret.leafRefs()
				refs.none { ir.typeDef(it).role == "readModelRow" && it !in mainReachable }
			}
			for (m in s.methods - kept.toSet()) {
				log("  note: ${s.name}.${m.name}: Row(テスト専用語彙)を運ぶため本番 interface から除外")
			}
			if (kept.isEmpty()) {
				log("  note: ${s.name}: 本番に写せるメソッドがないため interface を生成しません")
				continue
			}
			emitFile(k.useCasePackage(s.module), s.name,
				usesDomainResult = kept.any { it.ret is IrType.Result }) { serviceInterfaceBody(
				s.copy(methods = kept),
				"取得ポート — 参照系 UseCase が内部で呼ぶ**アプリの持ち物**。") }
		}
		for (s in ir.useCases) {
			emitFile(k.useCasePackage(s.module), s.name,
				usesDomainResult = s.methods.any { it.ret is IrType.Result }) { serviceInterfaceBody(s,
				"アプリケーション層の UseCase(固定形 validate / execute)。",
				fixedForm = true) }
		}
		for (s in ir.domainServices) {
			emitFile("domain.domainservice", s.name,
				usesDomainResult = s.methods.any { it.ret is IrType.Result }) { serviceInterfaceBody(s,
				"**ドメインモデルの持ち物**(DomainService — 複数の集約ルートへの関心・参照透過)。") }
		}
		for (b in ir.behaviors) {
			val td = ir.typeDef(b.subject)
			if (k.isEntityLike(td)) {
				// ふるまいは主体の interface に統合済み。create 系は Factory へ、
				// 主体を取らず主体も返さない静的語彙(Date.isLeap 等)だけ Behaviors に残す
				val factory = factoryMethodsOf(td)
				if (factory.isNotEmpty()) {
					// Factory の消費者はテストだけ(実装は自分の表現で構築する)— テスト専用語彙
					emitFile(k.packagePathOf(td), "${td.kotlin}Factory", toTest = true,
						usesDomainResult = factory.any { it.ret is IrType.Result }) {
						serviceInterfaceBody(
							IrService("${td.kotlin}Factory", b.module, factory),
							"ファクトリ(`${b.subject}` を作るふるまい — テスト専用語彙。採番は呼び出し側の関心)。",
							raw = true)
					}
				}
				val contracted = contractedStaticsOf(td).map { it.name }.toSet()
				for (m in b.methods) {
					val static = m.params.none { isSubjectParam(it, td) } && !factory.contains(m)
					if (static && m.name !in contracted) {
						log("  note: ${td.kotlin}.${m.name}: 契約指名のない静的語彙 — " +
							"証明の分解装置として本番から除外")
					}
				}
				continue
			}
			// 入力語彙(Command とそのフィールドの自作型)のふるまいは写さない —
			// その保証は UseCase の validate / execute テストが担う
			if (td.role == "command") {
				log("  note: ${td.kotlin}: 入力語彙のふるまいは本番に出さない" +
					"(UseCase の validate / execute テストが保証)")
				continue
			}
			// State のふるまい(valid 等)は写さない — 不変量は遷移テストの
			// オラクル完全一致に包含され、Kotlin 側に消費者がいない
			if (td.role == "repositoryState") {
				log("  note: ${td.kotlin}: State のふるまいは Kotlin に写さない(Lean 側の意味論装置)")
				continue
			}
			// sealed / enum のふるまい(主体に統合できないもの)は別 interface。
			// ここも契約指名されたものだけを写す(指名なしは証明の分解装置)
			val contracted = b.methods.filter { m ->
				ir.contracts.any {
					it.target == "behaviors" && it.useCase == td.lean && it.method == m.name
				}
			}
			for (m in b.methods - contracted.toSet()) {
				log("  note: ${td.kotlin}.${m.name}: 契約指名のないふるまい — 本番から除外")
			}
			if (contracted.isEmpty()) continue
			val toTest = td.role in setOf("repositoryState", "readModel", "readModelRow")
			emitFile(k.packagePathOf(td), "${td.kotlin}Behaviors", toTest = toTest,
				usesDomainResult = contracted.any { it.ret is IrType.Result }) {
				serviceInterfaceBody(
					IrService("${td.kotlin}Behaviors", b.module, contracted),
					"ふるまい(`${b.subject}` の def の写し — @[contract] 定理群が単体テストで固定)。",
					raw = true)
			}
		}
		// 泉ごとの IdGenerator ポート: @[repositoryState] の <X>IdGeneratorState から
		// 命名規約 <X>State ↔ <X> で導出。供給値の型はモデルの具体化の写し(Long 連番 / UUID)
		for (p in k.fountainPorts()) {
			emitFile("application", p.port) { fountainPortBody(p) }
		}
	}

	/** 宣言 doc の先頭行(KDoc の 1 行要約に使う)。 */
	private fun docLine(doc: String): String? =
		doc.lineSequence().firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }

	/**
	 * 本番(main)面から参照が到達する型の集合。種は main に出る型の形
	 * (フィールド・ctor 引数)と、main に出る interface(固定形フィルタ後の
	 * UseCase・DomainService)の署名。Row はテスト専用の概念
	 * (DB スキーマ → Read Model の変換可能性チェック)なのでここに入らないのが
	 * 正常 — 入るのは View→Row の壁が破れている間の橋(警告付き)だけ。
	 * QueryService は種に含めない(query 面が Row を運んだらそれは壁の破れで、
	 * 除外+note の対象 — 種に入れると破れが Row を main へ引き込んでしまう)。
	 */
	private val mainReachable: Set<String> by lazy {
		val testRoles = setOf("readModelRow", "repositoryState", "readModel", "clockPort")
		fun shapeRefs(td: IrTypeDef): List<String> = when (val s = td.shape) {
			is IrShape.Structure -> s.fields.flatMap { it.type.leafRefs() }
			is IrShape.Sealed -> s.ctors.flatMap { c -> c.fields.flatMap { it.type.leafRefs() } }
			else -> emptyList()
		}
		val seeds = mutableListOf<String>()
		for (td in ir.types) if (td.role !in testRoles) seeds += shapeRefs(td)
		for (s in ir.useCases) for (m in s.methods) {
			seeds += m.params.filterNot { isPlumbing(it.type) || isPreciseInput(it.type) }
				.flatMap { it.type.leafRefs() }
			seeds += m.ret.leafRefs()
		}
		for (s in ir.domainServices) for (m in s.methods) {
			seeds += m.params.filterNot { isPlumbing(it.type) }.flatMap { it.type.leafRefs() }
			seeds += m.ret.leafRefs()
		}
		val reach = mutableSetOf<String>()
		val queue = ArrayDeque(seeds)
		while (queue.isNotEmpty()) {
			val n = queue.removeFirst()
			if (!reach.add(n)) continue
			queue += shapeRefs(ir.typeDef(n))
		}
		reach
	}

	private fun emitFile(
		subpkg: String?, name: String, usesDomainResult: Boolean = false,
		toTest: Boolean = false, build: () -> String,
	) {
		val (body, c) = k.collecting(build)
		val imports = mutableListOf<String>()
		if (usesDomainResult && subpkg != null) imports.add("${out.basePackage}.DomainResult")
		for (lean in c.refs) {
			val td = ir.typeDef(lean)
			val target = k.packagePathOf(td)
			if (target != subpkg) {
				imports.add(out.basePackage + (target?.let { ".$it" } ?: "") + "." + td.kotlin)
			}
		}
		for (lean in c.fixtures) {
			// fixture はテストのルートパッケージ(GeneratedFixtures)在住
			if (subpkg != null) {
				imports.add(out.basePackage + "." + ir.typeDef(lean).kotlin + "Fixture")
			}
		}
		if (subpkg != null && body.contains(".toFixture(")) {
			imports.add("${out.basePackage}.toFixture")
		}
		(if (toTest) testOut else out).file(subpkg, name, imports, body)
	}

	private val domainResultBody = """
/**
 * ドメイン操作の結果(Lean の `Except` の写し)。
 */
sealed interface DomainResult<out E, out A> {
	data class Ok<out A>(val value: A) : DomainResult<Nothing, A>
	data class Err<out E>(val error: E) : DomainResult<E, Nothing>
}
""".trimIndent()

	private fun docFor(td: IrTypeDef): String =
		if (td.isId) {
			// ID の表現は実装側の自由ではなく、非機能要件を根拠に
			// モデリングパイプライン(Lean 側)が決める — 生成は具体化を写すだけ
			val rep = if (td.wire == "uuid")
				"同一性の表現は**モデルの具体化の写し**(NFR を根拠にモデリング\n * パイプラインが決定): ワイヤは canonical UUID 文字列、\n * Kotlin 表現は java.util.UUID。"
			else
				"同一性の表現は**モデルの具体化の写し**(NFR を根拠にモデリング\n * パイプラインが決定。現在の具体化は Long 連番)。"
			"/**\n * Lean: `${td.lean}`(${td.role})\n * $rep\n */"
		} else
			"/**\n * Lean: `${td.lean}`(${td.role})\n */"

	private fun instanceMethodsOf(td: IrTypeDef) = k.instanceMethodsOf(td)
	private fun factoryMethodsOf(td: IrTypeDef) = k.factoryMethodsOf(td)
	private fun isSubjectParam(f: IrField, td: IrTypeDef) = k.isSubjectParam(f, td)

	/** 主体を取らず主体も返さない静的語彙のうち、@[contract] 定理が指名するもの。
	    指名のないもの(isLeap 等)は証明の分解装置 — 本番に写さない。 */
	fun contractedStaticsOf(td: IrTypeDef): List<IrMethod> =
		(ir.behaviors.find { it.subject == td.lean }?.methods ?: emptyList())
			.filter { m ->
				m.params.none { isSubjectParam(it, td) } &&
					!m.ret.leafRefs().contains(td.lean) &&
					ir.contracts.any {
						it.target == "behaviors" && it.useCase == td.lean && it.method == m.name
					}
			}

	private fun dataTypeBody(td: IrTypeDef): String = when (val shape = td.shape) {
		is IrShape.Structure ->
			if (k.isEntityLike(td)) {
				// Entity / 集約ルートは interface — フィールド(getter)と**ふるまい**を
				// 1 つの interface に統合。表現は実装の決定。
				// ふるまいの自分自身引数はレシーバに畳む。create(自分自身を取らない)は
				// <X>Factory へ。テストは fixture(観測レコード)+実体化フックで検証する
				val props = shape.fields.joinToString("\n") { f ->
					"\tval ${ident(f.name)}: ${k.typeRef((f.type as? IrType.WithDefault)?.of ?: f.type)}"
				}
				val methods = (instanceMethodsOf(td) + contractedStaticsOf(td))
					.joinToString("") { m ->
					// レシーバに畳むのは**先頭の**主体引数だけ(le(a, b) の b は引数のまま)。
					// 契約指名された静的語彙(daysInMonth 等)はレシーバ非依存のメソッド
					val si = m.params.indexOfFirst { isSubjectParam(it, td) }
					val ps = m.params.filterIndexed { idx, _ -> idx != si }
						.joinToString(", ") { "${ident(it.name)}: ${k.typeRef(it.type)}" }
					val doc = docLine(m.doc)?.let { "\t/** $it */\n" } ?: ""
					"\n$doc\tfun ${ident(m.name)}($ps): ${k.typeRef(m.ret)}"
				}
				"${docFor(td)}\ninterface ${td.kotlin} {\n$props$methods\n}"
			} else if (k.isValueClass(td)) {
				val f = shape.fields.single()
				"${docFor(td)}\n@JvmInline\nvalue class ${td.kotlin}(val ${ident(f.name)}: ${k.typeRef(f.type)})"
			} else if (shape.fields.isEmpty()) {
				"${docFor(td)}\ndata object ${td.kotlin}"
			} else {
				val fixtureTyped = td.role == "repositoryState" || td.role == "readModelRow"
				val params = shape.fields.joinToString("\n") { f ->
					val dflt = (f.type as? IrType.WithDefault)?.let { " = ${k.defaultExpr(it)}" } ?: ""
					val tr = if (fixtureTyped) k.typeRefFixture(f.type) else k.typeRef(f.type)
					"\tval ${ident(f.name)}: $tr$dflt,"
				}
				"${docFor(td)}\ndata class ${td.kotlin}(\n$params\n)"
			}
		is IrShape.Enum -> {
			val entries = shape.ctors.joinToString("\n") { "\t${k.ctorClassName(it)}," }
			"${docFor(td)}\nenum class ${td.kotlin} {\n$entries\n}"
		}
		is IrShape.Sealed -> {
			val subs = shape.ctors.joinToString("\n") { c ->
				if (c.fields.isEmpty())
					"\tdata object ${k.ctorClassName(c.name)} : ${td.kotlin}"
				else {
					val params = c.fields.joinToString(", ") { f ->
						"val ${ident(f.name)}: ${k.typeRef(f.type)}"
					}
					"\tdata class ${k.ctorClassName(c.name)}($params) : ${td.kotlin}"
				}
			}
			"${docFor(td)}\nsealed interface ${td.kotlin} {\n$subs\n}"
		}
	}

	private fun repositoryBody(td: IrTypeDef): String {
		val rootK = k.name(td.lean)
		val param = decapitalizeFirst(rootK)
		return if (td.id == IrType.Unit) """
/**
 * Lean: `${td.lean}` 集約のリポジトリ。同一性が Unit = サイトに 1 つだけの集約。
 * v1 契約: get は保存済みがなければ null、save は上書き。
 * 実装は AI が別ファイルに書く。default 禁止。
 */
interface ${rootK}Repository {
	fun get(): $rootK?
	fun save(${ident(param)}: $rootK)
}
""".trimIndent() else {
			val idK = k.typeRef(td.id ?: error("${td.lean}: id がありません"))
			// 操作は規約固定ではなく**ドメインモデルから許可されるものだけ**導出する:
			// 根拠のない操作は生成しない(削除の遷移が無ければ remove なし)
			val (hasFind, hasAdd, hasUpdate) = k.repoOps(td)
			val ops = buildString {
				if (hasFind)
					append("\n\t/** 宛先解決(コマンドが同一性を運ぶ根拠から導出)。 */" +
						"\n\tfun findById(id: $idK): $rootK?")
				append("\n\t/** 集約の集合の観測(Repository = 集約ルート集合)。並びは保存順。 */" +
					"\n\tfun findAll(): List<$rootK>")
				if (hasAdd)
					append("\n\t/** 新規個体の追加 = 末尾への追加(生成の遷移 create がある根拠から導出)。 */" +
						"\n\tfun add(${ident(param)}: $rootK)")
				if (hasUpdate)
					append("\n\t/** 既存個体の書き換え(書き換えの遷移がある根拠から導出)。並びは保たれる。 */" +
						"\n\tfun update(${ident(param)}: $rootK)")
			}
			"""
/**
 * Lean: `${td.lean}` 集約のリポジトリ(トランザクション境界の単位)。
 * 操作はドメインの遷移から許可されるものだけ(削除の遷移が無いため remove は無い)。
 * 実装は AI が別ファイルに書く。default 禁止。
 */
interface ${rootK}Repository {$ops
}
""".trimIndent()
		}
	}

	/** 主体ポート(@[actorContext])の型: 「今このリクエストを操作している主体」。
	    KDoc には Lean 側の docstring を全文写す — この値がどこから調達されるか
	    (認証境界)の説明は Lean の docstring が正(引数付きアノテーションは
	    増やさない)。組み立て(認証情報 → この型)の正しさは
	    生成テストの保証の**外** — 構築箇所の制限は lint 等の別の網で守ること。 */
	private fun actorPortBody(td: IrTypeDef): String {
		val shape = td.shape as? IrShape.Structure
			?: error("${td.lean}: actorPort は structure である必要があります")
		val docBody = td.doc.trim().lineSequence()
			.joinToString("\n") { " * ${it.trim()}" }.ifEmpty { " *" }
		val params = shape.fields.joinToString("\n") { f ->
			"\tval ${ident(f.name)}: ${k.typeRef((f.type as? IrType.WithDefault)?.of ?: f.type)},"
		}
		// data class は引数 0 を許さない — 値を運ばない主体は data object
		// (なお「判断に効かない主体は契約に入れない」が §9 の指針 —
		// 値ゼロの主体が本当に要るかはモデル側で再考すること)
		val body = if (shape.fields.isEmpty()) "data object ${td.kotlin}"
			else "data class ${td.kotlin}(\n$params\n)"
		return "/**\n" +
			" * Lean: `${td.lean}`(actorPort — 操作の主体の調達ポート)。\n" +
			docBody + "\n" +
			" *\n" +
			" * 値の調達(認証)は境界の関心 — **この型を構築してよいのは認証アダプタだけ**\n" +
			" * (リクエストのペイロードから組み立ててはならない: クライアントが主体を\n" +
			" * 名乗れる形は認可の破れになる)。UseCase 実装はリクエストスコープの配線\n" +
			" * (resolver 等)で受け取る — 本番の UseCase 署名には現れない。\n" +
			" * 契約テストは固定の主体をフックで注入する — 主体依存のふるまい(認可分岐)は\n" +
			" * そちらが検証する。**組み立ての正しさ(認証情報 → この型)は生成テストの\n" +
			" * 保証の外** — 境界のテスト・構築箇所を縛る lint を別途持つこと。\n" +
			" */\n" +
			body
	}

	/** 泉ごとの IdGenerator ポート。KDoc には Lean 側の生成器状態の docstring を
	    全文写す — 泉の単調性(保存順の担い手)のような法則の所在が実装者に見える。 */
	private fun fountainPortBody(p: Kotlinize.FountainPort): String {
		val docBody = p.stateTd.doc.trim().lineSequence()
			.joinToString("\n") { " * ${it.trim()}" }.ifEmpty { " *" }
		return "/**\n" +
			" * Lean: `${p.stateTd.lean}` — 泉(同一性の供給)の観測モデルに対応する\n" +
			" * IdGenerator ポート(命名規約 `<X>State ↔ <X>`)。\n" +
			docBody + "\n" +
			" *\n" +
			" * 供給値の型はモデルの具体化の写し。freshness(供給値の相異・\n" +
			" * 既使用との不交和)は実装の義務。契約テストは決定的な供給(Sequential 相当)を\n" +
			" * 注入する — 本番の採番戦略は実装の自由。\n" +
			" * 実装は AI が別ファイルに書く。default 禁止。\n" +
			" */\n" +
			"interface ${p.port} {\n" +
			"\t/** 次の同一性を配る(1 回の供給 — 供給ごとに前へ進む)。 */\n" +
			"\tfun nextId(): ${k.name(p.idTd.lean)}\n" +
			"}"
	}

	/** モデル配管(観測の Set・乱択の鍵・時計・主体)— 本番署名から落とし、実装の配線とする。 */
	fun isPlumbing(t: IrType): Boolean = when (t) {
		is IrType.Ref -> ir.typeDef(t.lean).role in
			setOf("readModel", "repositoryState", "clockPort", "actorPort")
		is IrType.Arrow -> (t.from as? IrType.Ref)?.let { ir.typeDef(it.lean).isId } == true &&
			t.to == IrType.Nat
		else -> false
	}

	/**
	 * precise な入力(lookup 結果・採番列)の判定: 参照の葉がすべて
	 * Id・集約ルート・Entity・Row のもの。ペイロード(Command / Query / View の DTO)は
	 * 残る。UseCase の固定形にのみ適用する(DomainService の resolve の lu/nid 等は
	 * ドメイン語彙なので落とさない)。
	 */
	private fun isPreciseInput(t: IrType): Boolean {
		val refs = t.leafRefs()
		return refs.isNotEmpty() && refs.all {
			val td = ir.typeDef(it)
			td.isId || td.role in setOf("aggregateRoot", "entity", "readModelRow")
		}
	}

	/** QueryService / UseCase の interface(Lean モジュール内 def の署名写し)。 */
	private fun serviceInterfaceBody(
		s: IrService, roleDoc: String, fixedForm: Boolean = false, raw: Boolean = false,
	): String {
		var dropped = false
		val methods = s.methods.joinToString("\n") { m ->
			val real = if (raw) m.params else m.params.filterNot {
				isPlumbing(it.type) || (fixedForm && isPreciseInput(it.type))
			}
			if (real.size != m.params.size) dropped = true
			val ps = real.joinToString(", ") { f -> "${ident(f.name)}: ${k.typeRef(f.type)}" }
			val doc = if (fixedForm && m.name == "validate") {
				// validate は本番では execute の内部第一段(実装は execute を
				// validate 経由に一本化)。公開メンバとしてはテストシーム
				val head = docLine(m.doc)?.let { "\t * $it\n" } ?: ""
				"\t/**\n$head\t * 本番では execute の内部第一段として呼ばれる(実装は「execute は\n" +
					"\t * validate を呼ぶ」形に一本化する — 分岐条件を再実装しない)。\n" +
					"\t * 公開メンバとしては**テストシーム**(定理→テスト 1:1 導出・読み取り専用の検査)。\n\t */\n"
			} else docLine(m.doc)?.let { "\t/** $it */\n" } ?: ""
			"$doc\tfun ${ident(m.name)}($ps): ${k.typeRef(m.ret)}"
		}
		val plumbingDoc = if (dropped)
			"\n * 取得(読み取りストア)・乱択の鍵・調達ポート(時計・主体)・precise な入力\n * (lookup 結果・採番列)は**実装の配線**(注入ポート)— 署名には現れない\n * (証明装置を本番界面に写さない)。効果はリポジトリ経由で観測する。"
			else ""
		return "/**\n * Lean: モジュール `${s.module}` の interface 面(署名は Lean の def の写し)。\n * $roleDoc$plumbingDoc\n * 実装は AI が別ファイルに書く。default 禁止。\n */\n" +
			"interface ${s.name} {\n$methods\n}"
	}
}
