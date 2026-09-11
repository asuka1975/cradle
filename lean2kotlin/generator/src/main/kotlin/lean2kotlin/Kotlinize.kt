package lean2kotlin

import kotlinx.serialization.json.*

/**
 * Lean → Kotlin の写像規約(docs/design.md §3)の実装:
 * 型のレンダリング・識別子エスケープ・JSON オラクル値 → Kotlin リテラル。
 */

private val HARD_KEYWORDS = setOf(
	"as", "break", "class", "continue", "do", "else", "false", "for", "fun", "if",
	"in", "interface", "is", "null", "object", "package", "return", "super", "this",
	"throw", "true", "try", "typealias", "typeof", "val", "var", "when", "while")

/** Kotlin 識別子として安全な形にする(キーワード・非識別子はバッククォート)。 */
fun ident(name: String): String {
	val plain = name.isNotEmpty() && name.first().isLetter() &&
		name.all { it.isLetterOrDigit() || it == '_' } && name !in HARD_KEYWORDS
	if (plain) return name
	require('`' !in name && '\n' !in name) { "識別子に使えない文字を含みます: $name" }
	return "`$name`"
}

fun capitalizeFirst(s: String): String = s.replaceFirstChar { it.uppercaseChar() }
fun decapitalizeFirst(s: String): String = s.replaceFirstChar { it.lowercaseChar() }

/** Kotlin 文字列リテラル。 */
fun stringLit(s: String): String {
	val sb = StringBuilder("\"")
	for (c in s) {
		when (c) {
			'\\' -> sb.append("\\\\")
			'"' -> sb.append("\\\"")
			'$' -> sb.append("\\$")
			'\n' -> sb.append("\\n")
			'\r' -> sb.append("\\r")
			'\t' -> sb.append("\\t")
			else -> if (c.isISOControl()) sb.append("\\u%04x".format(c.code)) else sb.append(c)
		}
	}
	return sb.append('"').toString()
}

/** ファイル単位の参照収集の結果(インポート計算用)。 */
data class Collected(val refs: Set<String>, val arbs: Set<String>, val fixtures: Set<String>)

class Kotlinize(private val ir: Ir) {

	// ───────────────────────── 参照収集(役割別パッケージのインポート計算用)

	private var refSink: MutableSet<String>? = null
	private var arbSink: MutableSet<String>? = null
	private var fixtureSink: MutableSet<String>? = null

	/** block 中に参照された生成型(lean 名)・Arb 関数・fixture(lean 名)を収集する。 */
	fun <T> collecting(block: () -> T): Pair<T, Collected> {
		val r = mutableSetOf<String>()
		val a = mutableSetOf<String>()
		val f = mutableSetOf<String>()
		refSink = r; arbSink = a; fixtureSink = f
		try {
			return block() to Collected(r, a, f)
		} finally {
			refSink = null; arbSink = null; fixtureSink = null
		}
	}

	private fun record(lean: String) { refSink?.add(lean) }

	/**
	 * interface として生成する型(フィールド+ふるまいの統合):
	 * Entity / 集約ルートと、ドメイン在住の VO structure。
	 * Command と入力語彙(Command のフィールドの自作型)は **data class**
	 * (入力の形は規定したい側で、ふるまいの抽象化は不要。
	 * そのふるまいの保証は UseCase の validate / execute テストが担う)。
	 * 据え置き: sealed / enum(構成子を生成する都合)、Id(表現仮置きの value class)、
	 * State / Row(fixture 語彙 = データの種)、Query / View(読み側の要求・応答 DTO —
	 * RecommendParams など Application 在住の VO 例外も要求語彙として据え置き)。
	 * リテラルと Arb はテスト側の fixture(観測レコード)で構築する。
	 */
	fun isEntityLike(td: IrTypeDef): Boolean =
		td.role == "entity" || td.role == "aggregateRoot" ||
			(td.shape is IrShape.Structure && !td.isId &&
				td.role == "valueObject" && !td.lean.contains(".Application.") &&
				// interface 統合の対象は**インスタンスふるまいを持つ VO だけ**:
				// ふるまいの無い VO は値の形が正で data class。interface にすると
				// (1) 実装内部の等値比較が同一性比較に化ける (2) 値構築(Arb / リテラル)が
				// fixture 語彙に化けて本番語彙(View / sealed の ctor)に埋め込めない —
				// fixture 語彙の閉包性が破れる
				instanceMethodsOf(td).isNotEmpty())

	/** fixture の Kotlin 名(参照として記録する)。 */
	fun fixtureName(td: IrTypeDef): String {
		fixtureSink?.add(td.lean)
		return "${td.kotlin}Fixture"
	}

	// ───────────────────────── fixture 語彙の閉包

	private fun shapeFieldTypes(td: IrTypeDef): List<IrType> = when (val s = td.shape) {
		is IrShape.Structure -> s.fields.map { it.type }
		is IrShape.Sealed -> s.ctors.flatMap { c -> c.fields.map { it.type } }
		else -> emptyList()
	}

	/** 型が entity-like(interface+fixture)へ shape を通じて到達するか。 */
	fun reachesEntityLike(t: IrType, seen: MutableSet<String> = mutableSetOf()): Boolean = when (t) {
		is IrType.Ref -> {
			val td = ir.typeDef(t.lean)
			if (isEntityLike(td)) true
			else if (!seen.add(t.lean)) false
			else shapeFieldTypes(td).any { reachesEntityLike(it, seen) }
		}
		is IrType.ListOf -> reachesEntityLike(t.of, seen)
		is IrType.OptionOf -> reachesEntityLike(t.of, seen)
		is IrType.PairOf -> reachesEntityLike(t.fst, seen) || reachesEntityLike(t.snd, seen)
		is IrType.WithDefault -> reachesEntityLike(t.of, seen)
		is IrType.Result -> reachesEntityLike(t.err, seen) || reachesEntityLike(t.ok, seen)
		else -> false
	}

	/** fixture 側に平行な語彙(<X>Fixture)が要る**橋渡し型**: entity-like へ到達する
	    ドメイン VO の sealed / structure(例: ふるまい持ちの VO を運ぶ sealed)。
	    fixture(観測レコード)や Row に埋め込まれる位置で本番 interface を運ばないための
	    閉包 — 値の構築(fixture → 実装)は従来どおり具象バインディングの仕事。 */
	val fixtureBridged: Set<String> by lazy {
		ir.types.filter { td ->
			td.role == "valueObject" && !td.isId && !isEntityLike(td) &&
				shapeFieldTypes(td).any { reachesEntityLike(it) }
		}.map { it.lean }.toSet()
	}

	fun isFixtureBridged(lean: String): Boolean = lean in fixtureBridged

	/** fixture 語彙での型表現: Entity / 集約ルート・橋渡し型(entity-like を運ぶ
	    sealed / VO 構造)の参照を fixture 型に置き換える
	    (State は fixture の入れ物 — Entity interface を運ばない)。 */
	fun typeRefFixture(t: IrType): String = when (t) {
		is IrType.Ref -> {
			val td = ir.typeDef(t.lean)
			if (isEntityLike(td) || isFixtureBridged(t.lean)) fixtureName(td) else typeRef(t)
		}
		is IrType.ListOf -> "List<${typeRefFixture(t.of)}>"
		is IrType.OptionOf -> "${typeRefFixture(t.of)}?"
		is IrType.WithDefault -> typeRefFixture(t.of)
		else -> typeRef(t)
	}

	/** 生成型の Kotlin 名(参照として記録する)。 */
	fun name(lean: String): String {
		record(lean)
		return ir.kotlinName(lean)
	}

	/**
	 * 生成先パッケージ = Lean のディレクトリ構成の写し:
	 * 在住モジュールから root 名前空間と葉(ファイル)を除き、小文字連結する。
	 * 例: Sprout.Application.UseCase.PostNoteUseCase.Command → application.usecase.postnoteusecase。
	 * 同一性の Id は ValueObject — domain.valueobject 在住。
	 */
	fun packagePathOf(td: IrTypeDef): String? {
		if (td.isId) return "domain.valueobject"
		val m = td.module ?: return subpackageOf(td.role)
		val root = ir.rootNamespace + "."
		if (!m.startsWith(root)) return subpackageOf(td.role)
		val comps = m.removePrefix(root).split(".")
		// ValueObject は 1 ファイルを 1 ディレクトリとして扱う
		val dirs = if (comps.lastOrNull() == "ValueObject") comps else comps.dropLast(1)
		if (dirs.isEmpty()) return null
		return dirs.joinToString(".") { it.lowercase() }
	}

	/** ふるまいの仕分け(主体引数 = レシーバ)。 */
	fun isSubjectParam(f: IrField, td: IrTypeDef): Boolean =
		(f.type as? IrType.Ref)?.lean == td.lean

	/** 主体を引数に取るふるまい(インスタンスメソッド)。 */
	fun instanceMethodsOf(td: IrTypeDef): List<IrMethod> =
		ir.behaviors.find { it.subject == td.lean }?.methods
			?.filter { m -> m.params.any { isSubjectParam(it, td) } } ?: emptyList()

	/** 主体を取らず主体を作るふるまい(ファクトリメソッド)。 */
	fun factoryMethodsOf(td: IrTypeDef): List<IrMethod> =
		ir.behaviors.find { it.subject == td.lean }?.methods
			?.filter { m -> m.params.none { isSubjectParam(it, td) } &&
				m.ret.leafRefs().contains(td.lean) } ?: emptyList()

	/** Repository の在処: ドメインの持ち物だが、Entity / ValueObject と同格の
	    専用ディレクトリを切る。 */
	val repositoryPackage = "domain.repository"

	/** Repository 操作の導出(ドメインの遷移から許可されるものだけ)。 */
	data class RepoOps(val find: Boolean, val add: Boolean, val update: Boolean)
	fun repoOps(td: IrTypeDef): RepoOps {
		val idLean = (td.id as? IrType.Ref)?.lean
		val find = idLean != null && ir.types.any { c ->
			c.role == "command" && when (val sh = c.shape) {
				is IrShape.Structure -> sh.fields.any { it.type.leafRefs().contains(idLean) }
				is IrShape.Sealed -> sh.ctors.any { ct -> ct.fields.any { it.type.leafRefs().contains(idLean) } }
				else -> false
			}
		}
		return RepoOps(find, factoryMethodsOf(td).isNotEmpty(),
			instanceMethodsOf(td).any { m -> m.ret.leafRefs().contains(td.lean) })
	}

	/** UseCase ディレクトリ名 → パッケージ(application.usecase.<小文字>)。 */
	fun useCasePackage(dir: String): String = "application.usecase.${dir.lowercase()}"

	/** 泉(IdGenerator ポート)の導出:
	    @[repositoryState] の `<X>IdGeneratorState` ↔ ポート `<X>IdGenerator`
	    (命名規約 `<X>State ↔ <X>` — RepositoryState.lean)。供給する Id 型は
	    `<X>Id`。表現(Long 連番 / UUID)はモデルの具体化の写し。 */
	data class FountainPort(val stateTd: IrTypeDef, val port: String, val idTd: IrTypeDef)
	fun fountainPorts(): List<FountainPort> =
		ir.types.filter { it.role == "repositoryState" && it.kotlin.endsWith("IdGeneratorState") }
			.mapNotNull { st ->
				val prefix = st.kotlin.removeSuffix("IdGeneratorState")
				val idTd = ir.types.find { it.isId && it.kotlin == prefix + "Id" }
					?: return@mapNotNull null
				FountainPort(st, st.kotlin.removeSuffix("State"), idTd)
			}.sortedBy { it.port }

	/** 役割 → サブパッケージ(= ディレクトリ)。module の無い型の置き場。null はルート。 */
	fun subpackageOf(role: String): String? = when (role) {
		"valueObject", "entity", "aggregateRoot", "error" -> "model"
		"command" -> "command"
		"readModelRow" -> "query"   // 読み取りストアの行(SELECT の射影 DTO)
		"viewDto" -> "view"         // 画面の応答 DTO
		"repositoryState" -> "state" // Repository / ポートの観測モデル+Effect Set(fixture)
		"readModel" -> "query"       // 観測の Set(UseCase ごとの ReadModel)— fixture
		"actorPort" -> "application" // 主体ポート — アプリケーション境界の関心
		else -> null
	}

	/** IR の型表現 → Kotlin の型。標準時間型は java.time への正準対応。
	    FQN で書く — 生成名との衝突・インポート計算を持ち込まない。 */
	fun typeRef(t: IrType): String = when (t) {
		IrType.Nat -> "Long"
		IrType.Str -> "String"
		IrType.Bool -> "Boolean"
		IrType.Unit -> "Unit"
		IrType.Date -> "java.time.LocalDate"
		IrType.DateTime -> "java.time.LocalDateTime"
		IrType.Zoned -> "java.time.ZonedDateTime"
		IrType.Uuid -> "java.util.UUID"
		is IrType.ListOf -> "List<${typeRef(t.of)}>"
		is IrType.OptionOf -> "${typeRef(t.of)}?"
		is IrType.PairOf -> "Pair<${typeRef(t.fst)}, ${typeRef(t.snd)}>"
		is IrType.Arrow -> "(${typeRef(t.from)}) -> ${typeRef(t.to)}"
		is IrType.Ref -> name(t.lean)
		is IrType.WithDefault -> typeRef(t.of)
		is IrType.Result -> "DomainResult<${typeRef(t.err)}, ${typeRef(t.ok)}>"
	}

	/** 既定値付きフィールドの Kotlin 既定値式。 */
	fun defaultExpr(t: IrType.WithDefault): String = when (t.of) {
		IrType.Nat -> "${t.default.long}L"
		IrType.Bool -> t.default.boolean.toString()
		IrType.Str -> stringLit(t.default.content)
		else -> error("既定値を表現できない型: ${t.of}")
	}

	/** 1 フィールドの ValueObject は value class にする(docs/design.md §3)。 */
	fun isValueClass(t: IrTypeDef): Boolean =
		t.role == "valueObject" && t.shape is IrShape.Structure && t.shape.fields.size == 1

	/** entity / aggregateRoot の同一性フィールド名(Id 型に一致する唯一のフィールド)。 */
	fun idFieldName(t: IrTypeDef): String {
		val id = t.id ?: error("${t.lean} に id 型がありません")
		if (id == IrType.Unit) error("${t.lean} の Id は Unit です(フィールドを持ちません)")
		val shape = t.shape as? IrShape.Structure ?: error("${t.lean} は structure ではありません")
		val matches = shape.fields.filter { it.type == id }
		require(matches.size == 1) {
			"${t.lean}: Id 型 ${typeRef(id)} に一致するフィールドが一意に決まりません(${matches.map { it.name }})"
		}
		return matches.single().name
	}

	/** sealed のコンストラクタ名 → Kotlin のサブクラス名。 */
	fun ctorClassName(ctor: String): String = capitalizeFirst(ctor)

	// ───────────────────────── リテラル(JSON オラクル値 → Kotlin 式)

	/** 期待値 JSON を、IR の型に沿って Kotlin 式へ写す。 */
	fun literal(t: IrType, j: JsonElement): String = when (t) {
		IrType.Nat -> "${j.jsonPrimitive.long}L"
		IrType.Str -> stringLit(j.jsonPrimitive.content)
		IrType.Bool -> j.jsonPrimitive.boolean.toString()
		IrType.Unit -> "Unit"
		// ワイヤは ISO-8601 文字列 — 往復一致が契約点
		IrType.Date -> "java.time.LocalDate.parse(${stringLit(j.jsonPrimitive.content)})"
		IrType.DateTime -> "java.time.LocalDateTime.parse(${stringLit(j.jsonPrimitive.content)})"
		IrType.Zoned -> "java.time.ZonedDateTime.parse(${stringLit(j.jsonPrimitive.content)})"
		// ワイヤは canonical UUID 文字列
		IrType.Uuid -> "java.util.UUID.fromString(${stringLit(j.jsonPrimitive.content)})"
		is IrType.ListOf ->
			// 要素が Entity ならリテラルは fixture の列(fixture は interface を実装しない)
			"listOf<${typeRefFixture(t.of)}>(${j.jsonArray.joinToString(", ") { literal(t.of, it) }})"
		is IrType.OptionOf -> if (j is JsonNull) "null" else literal(t.of, j)
		is IrType.PairOf -> {
			val a = j.jsonArray
			"Pair(${literal(t.fst, a[0])}, ${literal(t.snd, a[1])})"
		}
		is IrType.Arrow -> error("関数型のリテラルは生成できません")
		is IrType.Ref -> refLiteral(ir.typeDef(t.lean), j)
		is IrType.WithDefault -> literal(t.of, j)
		is IrType.Result -> error("DomainResult のリテラルは生成できません")
	}

	fun refLiteral(td: IrTypeDef, j: JsonElement): String {
		record(td.lean)
		return refLiteralBody(td, j)
	}

	private fun refLiteralBody(td: IrTypeDef, j: JsonElement): String = when (val shape = td.shape) {
		is IrShape.Structure -> {
			// UUID ワイヤの Id: JSON は canonical UUID 文字列そのもの
			// (フィールドの object ではない)— 値ラッパの ctor に直接写す
			if (td.wire == "uuid" && shape.fields.size == 1)
				"${td.kotlin}(${literal(IrType.Uuid, j)})"
			else if (shape.fields.isEmpty()) td.kotlin   // data object
			else {
				val o = j.jsonObject
				val args = shape.fields.joinToString(", ") { f ->
					require(f.name in o) { "${td.lean}.${f.name}: JSON に無い" }
					"${ident(f.name)} = ${literal(f.type, o.getValue(f.name))}"
				}
				val ctor = if (isEntityLike(td) || isFixtureBridged(td.lean)) fixtureName(td) else td.kotlin
				"$ctor($args)"
			}
		}
		is IrShape.Enum -> {
			val name = j.jsonPrimitive.content
			require(name in shape.ctors) { "${td.lean}: 不明な enum 値 $name" }
			"${td.kotlin}.${ctorClassName(name)}"
		}
		is IrShape.Sealed -> {
			// リテラルは fixture 語彙(観測側): 橋渡し型(entity-like を運ぶ sealed)は
			// 平行 fixture(<X>Fixture)の構成子で構築する — 中身の entity-like は
			// literal() が fixture に写すため、本番 sealed に埋めると型が合わない。
			// 本番語彙での構築(コマンド入力)は inputLiteral 側の仕事
			val base = if (isFixtureBridged(td.lean)) fixtureName(td) else td.kotlin
			// 引数なし ctor は "name"(文字列)、引数あり ctor は {"name": {"arg": ...}}
			if (j is JsonPrimitive) {
				val ctor = shape.ctors.find { it.name == j.content }
					?: error("${td.lean}: 不明なコンストラクタ ${j.content}")
				require(ctor.fields.isEmpty())
				"$base.${ctorClassName(ctor.name)}"
			} else {
				val o = j.jsonObject
				require(o.size == 1) { "${td.lean}: sealed 値の JSON が不正です: $j" }
				val (name, body) = o.entries.single()
				val ctor = shape.ctors.find { it.name == name }
					?: error("${td.lean}: 不明なコンストラクタ $name")
				if (ctor.fields.isEmpty()) "$base.${ctorClassName(name)}"
				else {
					val bo = body.jsonObject
					val args = ctor.fields.joinToString(", ") { f ->
						"${ident(f.name)} = ${literal(f.type, bo.getValue(f.name))}"
					}
					"$base.${ctorClassName(name)}($args)"
				}
			}
		}
	}

	// ───────────────────────── Arb(Kotest ジェネレータ)

	/** 型ごとの Arb 関数名。 */
	fun arbFunName(kotlinName: String): String = "arb$kotlinName"

	/** Arb 関数の呼び出し(使用を記録する — Arb はテストのルートパッケージに置かれる)。 */
	fun arbCall(lean: String): String {
		val kn = ir.kotlinName(lean)
		arbSink?.add(kn)
		return "${arbFunName(kn)}()"
	}

	/** IR の型表現 → Arb 式(GeneratedArbs.kt 内で使う)。 */
	fun arbOf(t: IrType): String = when (t) {
		IrType.Nat -> "Arb.long(0L..4096L)"
		IrType.Str -> "Arb.string(0..8, Codepoint.alphanumeric())"
		IrType.Bool -> "Arb.boolean()"
		IrType.Unit -> "Arb.constant(Unit)"
		// 暦の実在は LocalDate の構築が保証(構築時執行)。epoch 日で決定的
		IrType.Date -> "Arb.long(0L..23000L).map { java.time.LocalDate.ofEpochDay(it) }"
		// UUID ワイヤの Id の中身: 値域を小さく保つ(Repository 契約テストの変位 +1000000L との
		// 不交和の論法を維持 — 乱択どうしの衝突回避は distinctBy / 変位が担う)
		IrType.Uuid -> "Arb.long(0L..4096L).map { java.util.UUID(0L, it) }"
		IrType.DateTime ->
			"Arb.long(0L..2_000_000_000L).map { java.time.LocalDateTime.ofEpochSecond(it, 0, java.time.ZoneOffset.UTC) }"
		IrType.Zoned -> error("ZonedDateTime の Arb は未対応(必要になったら対応表を拡張)")
		is IrType.ListOf -> {
			// 同一性を持つ個体の列は id を重複させない — id 重複は業務
			// 不変条件違反で、PK 制約を持つ実 DB では insert が必ず落ちる。
			// 同一性フィールドは名前でなく型(td.id)で特定する(View は noteId 等)
			val el = (t.of as? IrType.Ref)?.let { ir.typeDef(it.lean) }
			val base = "Arb.list(${arbOf(t.of)}, 0..5)"
			val idLean = (el?.id as? IrType.Ref)?.lean
			val idField = if (idLean == null) null
				else (el.shape as? IrShape.Structure)?.fields?.find { f ->
					(f.type as? IrType.Ref)?.lean == idLean
				}
			if (idField != null)
				"$base.map { xs -> xs.distinctBy { x -> x.${ident(idField.name)} } }"
			else base
		}
		is IrType.OptionOf -> "${arbOf(t.of)}.orNull(0.2)"
		is IrType.PairOf -> "Arb.pair(${arbOf(t.fst)}, ${arbOf(t.snd)})"
		is IrType.Arrow -> error("関数型の Arb は生成できません")
		is IrType.Ref -> arbCall(t.lean)
		is IrType.WithDefault -> arbOf(t.of)
		is IrType.Result -> error("DomainResult の Arb は生成できません")
	}
}
