package lean2kotlin

import kotlinx.serialization.json.*

/**
 * 抽出器(lean/Lean2Kotlin/Extract.lean)が書き出す IR の読み取りモデル。
 * スキーマは Extract.lean が正（概要は docs/design.md §2）。
 */

/** IR の型表現。 */
sealed interface IrType {
	data object Nat : IrType
	data object Str : IrType
	data object Bool : IrType
	data object Unit : IrType
	/** 標準時間型の対応表: Std.Time.PlainDate ↔ java.time.LocalDate。ワイヤは ISO-8601。 */
	data object Date : IrType
	/** Std.Time.PlainDateTime ↔ java.time.LocalDateTime。 */
	data object DateTime : IrType
	/** Std.Time.ZonedDateTime ↔ java.time.ZonedDateTime(将来分 — 表に備える)。 */
	data object Zoned : IrType
	/** UUID ワイヤの Id の中身: ワイヤは canonical UUID 文字列、
	    Kotlin 表現は java.util.UUID。IR には現れず、wire="uuid" の Id 型の
	    単一フィールドをパース時に置き換える。 */
	data object Uuid : IrType
	data class ListOf(val of: IrType) : IrType
	data class OptionOf(val of: IrType) : IrType
	data class PairOf(val fst: IrType, val snd: IrType) : IrType
	data class Arrow(val from: IrType, val to: IrType) : IrType
	data class Ref(val lean: String) : IrType
	/** Except の写し(DomainResult)。 */
	data class Result(val err: IrType, val ok: IrType) : IrType
	/** 既定値付きフィールド型(構造体の := 既定値)。 */
	data class WithDefault(val of: IrType, val default: JsonPrimitive) : IrType

	companion object {
		fun parse(j: JsonElement): IrType {
			val o = j.jsonObject
			return when (val k = o.getValue("k").jsonPrimitive.content) {
				"nat" -> Nat
				"string" -> Str
				"bool" -> Bool
				"unit" -> Unit
				"date" -> Date
				"datetime" -> DateTime
				"zoned" -> Zoned
				"list" -> ListOf(parse(o.getValue("of")))
				"option" -> OptionOf(parse(o.getValue("of")))
				"pair" -> PairOf(parse(o.getValue("fst")), parse(o.getValue("snd")))
				"arrow" -> Arrow(parse(o.getValue("from")), parse(o.getValue("to")))
				"ref" -> Ref(o.getValue("name").jsonPrimitive.content)
				"withDefault" -> WithDefault(parse(o.getValue("of")), o.getValue("default").jsonPrimitive)
				"result" -> Result(parse(o.getValue("err")), parse(o.getValue("ok")))
				else -> error("unknown IrType kind: $k")
			}
		}
	}
}

/** 型が参照する型名(Ref の葉)を列挙する。 */
fun IrType.leafRefs(): List<String> = when (this) {
	is IrType.Ref -> listOf(lean)
	is IrType.ListOf -> of.leafRefs()
	is IrType.OptionOf -> of.leafRefs()
	is IrType.PairOf -> fst.leafRefs() + snd.leafRefs()
	is IrType.Arrow -> from.leafRefs() + to.leafRefs()
	is IrType.Result -> err.leafRefs() + ok.leafRefs()
	is IrType.WithDefault -> of.leafRefs()
	else -> emptyList()
}

data class IrField(val name: String, val type: IrType) {
	companion object {
		fun parse(j: JsonElement): IrField {
			val o = j.jsonObject
			return IrField(o.getValue("name").jsonPrimitive.content, IrType.parse(o.getValue("type")))
		}
	}
}

/** 型の形状。 */
sealed interface IrShape {
	data class Structure(val fields: List<IrField>) : IrShape
	data class Enum(val ctors: List<String>) : IrShape
	data class Sealed(val ctors: List<IrCtor>) : IrShape

	companion object {
		fun parse(j: JsonElement): IrShape {
			val o = j.jsonObject
			return when (val k = o.getValue("kind").jsonPrimitive.content) {
				"structure" -> Structure(o.getValue("fields").jsonArray.map(IrField::parse))
				"enum" -> Enum(o.getValue("ctors").jsonArray.map { it.jsonPrimitive.content })
				"sealed" -> Sealed(o.getValue("ctors").jsonArray.map { c ->
					val co = c.jsonObject
					IrCtor(
						co.getValue("name").jsonPrimitive.content,
						co.getValue("fields").jsonArray.map(IrField::parse))
				})
				else -> error("unknown IrShape kind: $k")
			}
		}
	}
}

data class IrCtor(val name: String, val fields: List<IrField>)

/**
 * 構造体の制約(Lean の Prop フィールド)。kind = "unique": collection の要素の field が重複しない
 * (`(coll.map (·.f)).Nodup`)、"uniqueSome": 値のある要素だけが対象(`(coll.filterMap (·.f)).Nodup`)、
 * "all": 全要素が述語を満たす(`∀ x ∈ coll, x.f = c`)、"atMost": 述語を満たす要素は高々 max 件
 * (`(coll.filter p).length ≤ n`)。述語は `x.field <op> value`(op は eq / ne、value は JSON オラクル値)。
 * name は Lean のフィールド名(生成 KDoc に写す)。
 */
data class IrConstraint(
	val kind: String, val name: String, val collection: String, val field: String,
	val op: String? = null, val value: JsonElement? = null, val max: Long? = null,
) {
	companion object {
		fun parse(j: JsonElement): IrConstraint {
			val o = j.jsonObject
			return IrConstraint(
				kind = o.getValue("kind").jsonPrimitive.content,
				name = o.getValue("name").jsonPrimitive.content,
				collection = o.getValue("collection").jsonPrimitive.content,
				field = o.getValue("field").jsonPrimitive.content,
				op = o["op"]?.jsonPrimitive?.content,
				value = o["value"],
				max = o["max"]?.jsonPrimitive?.long)
		}
	}
}

data class IrTypeDef(
	val lean: String,
	val kotlin: String,
	val role: String,
	val shape: IrShape,
	/** entity / aggregateRoot のみ: 同一性の型。 */
	val id: IrType?,
	/** ある entity/root の同一性の型として使われている(表現は仮置き)。 */
	val isId: Boolean = false,
	/** 在住モジュール(Lean のディレクトリ構成の写し — 生成先パッケージの導出源)。 */
	val module: String? = null,
	/** Id 型のワイヤ観測: "uuid" = canonical UUID 文字列で直列化される
	    (Kotlin 表現は java.util.UUID)。 */
	val wire: String? = null,
	/** Lean 側の宣言 docstring(生成 KDoc の素材 — 泉ポートの単調性の註記等)。 */
	val doc: String = "",
	/** 構造体の制約(Prop フィールドのうち抽出器が読めた一意制約)。fixture はこれを満たすように引く。 */
	val constraints: List<IrConstraint> = emptyList(),
) {
	companion object {
		fun parse(j: JsonElement): IrTypeDef {
			val o = j.jsonObject
			val wire = o["wire"]?.jsonPrimitive?.content
			var shape = IrShape.parse(o.getValue("shape"))
			// UUID ワイヤの Id: 単一フィールドの中身を Uuid に写す —
			// 以降の型・リテラル・Arb の写像がすべてこの型に従う
			if (wire == "uuid" && shape is IrShape.Structure && shape.fields.size == 1) {
				shape = IrShape.Structure(listOf(IrField(shape.fields.single().name, IrType.Uuid)))
			}
			return IrTypeDef(
				lean = o.getValue("lean").jsonPrimitive.content,
				kotlin = o.getValue("kotlin").jsonPrimitive.content,
				role = o.getValue("role").jsonPrimitive.content,
				shape = shape,
				id = o["id"]?.let(IrType::parse),
				isId = o["isId"]?.jsonPrimitive?.boolean ?: false,
				module = o["module"]?.jsonPrimitive?.content,
				wire = wire,
				doc = o["doc"]?.jsonPrimitive?.content ?: "",
				constraints = o["constraints"]?.jsonArray?.map(IrConstraint::parse) ?: emptyList())
		}
	}
}

/** QueryService / UseCase の interface 面(モジュール内 def の署名写し)。 */
data class IrMethod(val name: String, val doc: String, val params: List<IrField>, val ret: IrType) {
	companion object {
		fun parse(j: JsonElement): IrMethod {
			val o = j.jsonObject
			return IrMethod(
				name = o.getValue("name").jsonPrimitive.content,
				doc = o["doc"]?.jsonPrimitive?.content ?: "",
				params = o.getValue("params").jsonArray.map(IrField::parse),
				ret = IrType.parse(o.getValue("ret")))
		}
	}
}

/** 契約ケースが Port に期待するやり取り: request が null なら呼ばれない(validate の拒否)、
 *  そうでなければその要求で 1 回呼ばれ outcome が返る。 */
data class IrCasePort(val port: String, val operation: String, val request: JsonElement?, val outcome: JsonElement?) {
	companion object {
		fun parse(j: JsonElement): IrCasePort {
			val o = j.jsonObject
			val nullable = { e: JsonElement? -> if (e == null || e is JsonNull) null else e }
			return IrCasePort(
				port = o.getValue("port").jsonPrimitive.content,
				operation = o.getValue("operation").jsonPrimitive.content,
				request = nullable(o["request"]),
				outcome = nullable(o["outcome"]))
		}
	}
}

/**
 * @[contract] 契約定理から演繹されたテストケース(期待値は抽出時の Lean 内評価)。
 * kind = "transition": 状態遷移契約 — before を fromState で播種し、
 * execute 後に error と after(toState)を突き合わせる。
 * kind = "value": 参照系 — readModel を fixture に execute の返り値(ok / error)を突き合わせる。
 * kind = "pure": ふるまい — 引数に対する返り値(ok)そのもの。
 * kind = "projection": 射影 — 状態(args)から Row 列(ok)を復元する。
 */
data class IrContractCase(
	val kind: String,
	val args: Map<String, JsonElement>,
	/** null なら成功(Ok)。 */
	val error: JsonElement?,
	/** transition: Effect Set(State)の型(lean 名)と前後の状態。 */
	val stateType: String? = null,
	val before: JsonElement? = null,
	val after: JsonElement? = null,
	/** value: 観測の Set(ReadModel)の型(lean 名)と fixture、成功時の返り値。 */
	val readModelType: String? = null,
	val readModel: JsonElement? = null,
	val ok: JsonElement? = null,
	/** transition: UseCase が使う Port への期待(Lean が評価した要求と定理の観測)。 */
	val ports: List<IrCasePort> = emptyList(),
) {
	companion object {
		fun parse(j: JsonElement): IrContractCase {
			val o = j.jsonObject
			return IrContractCase(
				kind = o.getValue("kind").jsonPrimitive.content,
				args = o.getValue("args").jsonObject.toMap(),
				error = o["error"]?.let { if (it is JsonNull) null else it },
				stateType = o["stateType"]?.jsonPrimitive?.content,
				before = o["before"],
				after = o["after"],
				readModelType = o["readModelType"]?.jsonPrimitive?.content,
				readModel = o["readModel"],
				ok = o["ok"],
				ports = o["ports"]?.jsonArray?.map(IrCasePort::parse) ?: emptyList())
		}
	}
}

data class IrContract(
	/** "usecase"(execute / validate)か "behaviors"(Entity / VO / State のふるまい)。 */
	val target: String,
	/** usecase: UseCase 名 / behaviors: 主体型の lean 名。 */
	val useCase: String,
	/** 検証対象のメソッド名(execute / validate / rename / valid …)。 */
	val method: String,
	val theorem: String, val doc: String,
	val cases: List<IrContractCase>,
	/** projection のみ: 対応する Row 型(lean 名)。 */
	val rowType: String? = null,
) {
	companion object {
		fun parse(j: JsonElement): IrContract {
			val o = j.jsonObject
			return IrContract(
				target = o["target"]?.jsonPrimitive?.content ?: "usecase",
				useCase = o.getValue("useCase").jsonPrimitive.content,
				method = o["method"]?.jsonPrimitive?.content ?: "execute",
				rowType = o["rowType"]?.jsonPrimitive?.content,
				theorem = o.getValue("theorem").jsonPrimitive.content,
				doc = o["doc"]?.jsonPrimitive?.content ?: "",
				cases = o.getValue("cases").jsonArray.map(IrContractCase::parse))
		}
	}
}

/** @[faultContract] 障害契約の 1 ケース: execute が成功する入力での
 *  「障害で中断されたときに観測されるべき状態」(期待値は Lean 内評価)。 */
data class IrFaultCase(
	val args: Map<String, JsonElement>,
	val stateType: String,
	val before: JsonElement,
	val after: JsonElement,
	val ports: List<IrCasePort> = emptyList(),
) {
	companion object {
		fun parse(j: JsonElement): IrFaultCase {
			val o = j.jsonObject
			return IrFaultCase(
				args = o.getValue("args").jsonObject.toMap(),
				stateType = o.getValue("stateType").jsonPrimitive.content,
				before = o.getValue("before"),
				after = o.getValue("after"),
				ports = o["ports"]?.jsonArray?.map(IrCasePort::parse) ?: emptyList())
		}
	}
}

/** @[faultContract] 障害契約 — 障害注入フックつき抽象契約テストの生成源。 */
data class IrFaultContract(
	val useCase: String,
	val def: String,
	val doc: String,
	val cases: List<IrFaultCase>,
) {
	companion object {
		fun parse(j: JsonElement): IrFaultContract {
			val o = j.jsonObject
			return IrFaultContract(
				useCase = o.getValue("useCase").jsonPrimitive.content,
				def = o.getValue("def").jsonPrimitive.content,
				doc = o["doc"]?.jsonPrimitive?.content ?: "",
				cases = o.getValue("cases").jsonArray.map(IrFaultCase::parse))
		}
	}
}

/** ふるまいの interface(Entity の def・VO / 入力語彙の制約・State の観測)。 */
data class IrBehavior(
	val subject: String, val module: String, val methods: List<IrMethod>,
) {
	companion object {
		fun parse(j: JsonElement): IrBehavior {
			val o = j.jsonObject
			return IrBehavior(
				subject = (o["subject"] ?: o.getValue("useCase")).jsonPrimitive.content,
				module = o.getValue("module").jsonPrimitive.content,
				methods = o.getValue("methods").jsonArray.map(IrMethod::parse))
		}
	}
}

/** UseCase が使う Port の操作(要求・観測の型は `ports` の操作が持つ)。 */
data class IrUseCasePort(val port: String, val operation: String) {
	companion object {
		fun parse(j: JsonElement): IrUseCasePort {
			val o = j.jsonObject
			return IrUseCasePort(
				port = o.getValue("port").jsonPrimitive.content,
				operation = o.getValue("operation").jsonPrimitive.content)
		}
	}
}

data class IrService(
	val name: String, val module: String, val methods: List<IrMethod>,
	/** UseCase のみ: 使う Port(署名から落ちる観測引数と、モックを組む型)。 */
	val ports: List<IrUseCasePort> = emptyList(),
) {
	companion object {
		fun parse(j: JsonElement): IrService {
			val o = j.jsonObject
			return IrService(
				name = o.getValue("name").jsonPrimitive.content,
				module = o.getValue("module").jsonPrimitive.content,
				methods = o.getValue("methods").jsonArray.map(IrMethod::parse),
				ports = o["ports"]?.jsonArray?.map(IrUseCasePort::parse) ?: emptyList())
		}
	}
}

/** 外部能力の Port の操作(`Application/Port/<Port>/<操作>`): メソッド名と要求・観測の型(lean 名)。 */
data class IrPortOp(val method: String, val request: String, val outcome: String, val doc: String) {
	companion object {
		fun parse(j: JsonElement): IrPortOp {
			val o = j.jsonObject
			return IrPortOp(
				method = o.getValue("method").jsonPrimitive.content,
				request = o.getValue("request").jsonPrimitive.content,
				outcome = o.getValue("outcome").jsonPrimitive.content,
				doc = o["doc"]?.jsonPrimitive?.content ?: "")
		}
	}
}

/** 外部能力の Port。interface(main)・モック(test)・Adapter の適合テスト(adapterTest)の生成源。
    所有層はモジュール名(`<Root>.<Application|Domain>.Port.<Port>`)が運ぶ。 */
data class IrPort(val name: String, val module: String, val operations: List<IrPortOp>) {
	companion object {
		fun parse(j: JsonElement): IrPort {
			val o = j.jsonObject
			return IrPort(
				name = o.getValue("name").jsonPrimitive.content,
				module = o.getValue("module").jsonPrimitive.content,
				operations = o.getValue("operations").jsonArray.map(IrPortOp::parse))
		}
	}
}

/** 抽出器の診断: 宣言した契約・固定形の署名が IR に入らなかった理由。生成器は失敗として読む。 */
data class IrDropped(val kind: String, val name: String, val reason: String) {
	companion object {
		fun parse(j: JsonElement): IrDropped {
			val o = j.jsonObject
			return IrDropped(
				kind = o.getValue("kind").jsonPrimitive.content,
				name = o.getValue("name").jsonPrimitive.content,
				reason = o.getValue("reason").jsonPrimitive.content)
		}
	}
}

class Ir(
	val rootNamespace: String,
	val types: List<IrTypeDef>,
	val queryServices: List<IrService>,
	val useCases: List<IrService>,
	val domainServices: List<IrService>,
	val contracts: List<IrContract> = emptyList(),
	val faultContracts: List<IrFaultContract> = emptyList(),
	val behaviors: List<IrBehavior> = emptyList(),
	val ports: List<IrPort> = emptyList(),
	val dropped: List<IrDropped> = emptyList(),
) {
	private val byLean: Map<String, IrTypeDef> = types.associateBy { it.lean }

	fun typeDef(lean: String): IrTypeDef =
		byLean[lean] ?: error("IR に型 $lean がありません")

	fun kotlinName(lean: String): String = typeDef(lean).kotlin

	fun port(name: String): IrPort = ports.find { it.name == name } ?: error("IR に Port $name がありません")

	companion object {
		fun parse(text: String): Ir {
			val o = Json.parseToJsonElement(text).jsonObject
			val version = o.getValue("version").jsonPrimitive.int
			require(version == 1) { "未対応の IR バージョン: $version" }
			return Ir(
				rootNamespace = o.getValue("rootNamespace").jsonPrimitive.content,
				types = o.getValue("types").jsonArray.map(IrTypeDef::parse),
				queryServices = o["queryServices"]?.jsonArray?.map(IrService::parse) ?: emptyList(),
				useCases = o["useCases"]?.jsonArray?.map(IrService::parse) ?: emptyList(),
				domainServices = o["domainServices"]?.jsonArray?.map(IrService::parse) ?: emptyList(),
				contracts = o["contracts"]?.jsonArray?.map(IrContract::parse) ?: emptyList(),
				faultContracts = o["faultContracts"]?.jsonArray?.map(IrFaultContract::parse) ?: emptyList(),
				behaviors = o["behaviors"]?.jsonArray?.map(IrBehavior::parse) ?: emptyList(),
				ports = o["ports"]?.jsonArray?.map(IrPort::parse) ?: emptyList(),
				dropped = o["diagnostics"]?.jsonObject?.get("dropped")?.jsonArray?.map(IrDropped::parse) ?: emptyList())
		}
	}
}
