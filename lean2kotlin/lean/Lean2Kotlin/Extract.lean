/-
  Lean2Kotlin.Extract — `#kotlin_ir`: 対象プロジェクトを**外から**読んで IR を書き出す

  対象の Lean に型クラス配線・フィクスチャ・ドライバを一切要求しない。読むのは:

  1. **規約(ディレクトリ/namespace)** — 生成区分はモジュールパスから導出:
     Domain/ValueObject → VO、Domain/Entity/ → Entity(ルートは印)、
     Domain/DomainService/ → ドメインサービス、
     Application/RepositoryState → 観測モデル(State)、Application/ReadModel → 読み取り行、
     Application/View → 閲覧 DTO、Application/Projection → 射影、
     Application/UseCase/<X>UseCase/ の Command / ReadModel / QueryService / UseCase
     (UseCase.lean の structure 名 State / Result は生成区分)。
     `<Root>.DomainError` と名前が *Error の型は失敗の語彙。
  2. **印(対象自前の TagAttribute)** — `@[aggregateRoot]` / `@[valueObject]` /
     `@[repositoryState]` / `@[contract]`(必須)、`@[actorContext]` / `@[faultContract]`(任意)を
     環境から読む(定数は型 TagAttribute のものを走査して評価)。
  3. **固定名** — interface 面は validate / execute(UseCase)と query(QueryService)。
     同一性は `id` フィールド、泉の種は `next`、Result の失敗枝は `error`、事後状態は `after`。
     パラメトリックな型引数は binder 名 → `<Root>.Runtime.<名前>` で単型化
     (ドライバ引数で上書きできる。表現は仮置き — 生成は ID の中身に依存しない)。
  4. **契約定理** — `@[contract]` / `@[faultContract]` を Lean 内で評価し、期待値(オラクル)を
     IR に焼き込む。golden は生成器側で読む。
  5. **制約** — 構造体の Prop フィールドのうち読める形(`(coll.map (·.f)).Nodup` /
     `(coll.filterMap (·.f)).Nodup` の一意制約、`∀ x ∈ coll, x.f = c` の全件制約、
     `(coll.filter p).length ≤ n` の上限制約)を IR に出す(fixture の構築規律)。
     Prop フィールドと def の Prop 引数はデータでも interface 面でもない —
     形状と署名から除き、評価では decide の証明で埋める。
-/
import Lean

namespace Lean2Kotlin.Extract

open Lean Meta Elab Command

/-! ### 型の正規化(モノモルフ化)と IR 化 -/

structure MonoType where
  head : Name
  args : Array Expr
  expr : Expr

abbrev MonoReg := IO.Ref (Std.HashMap Name (Array Expr))

def normalizeType (what : String) (e : Expr) : MetaM MonoType := do
  let e ← whnf (← instantiateMVars e)
  match e with
  | .const n _ => return { head := n, args := #[], expr := e }
  | .app .. =>
    match e.getAppFn with
    | .const n _ => return { head := n, args := e.getAppArgs, expr := e }
    | _ => throwError "lean2kotlin: {what} が定数の適用形に簡約できません: {e}"
  | _ => throwError "lean2kotlin: {what} が定数の適用形に簡約できません: {e}"

def registerMono (reg : MonoReg) (what : String) (m : MonoType) : MetaM Unit := do
  let map ← reg.get
  match map.get? m.head with
  | none => reg.set (map.insert m.head m.args)
  | some prev => do
    unless prev.size == m.args.size do
      throwError "lean2kotlin: 総称型 {m.head} の型引数の数が一致しません({what})"
    for p in prev, a in m.args do
      unless (← isDefEq p a) do
        throwError "lean2kotlin: 総称型 {m.head} が異なる型引数で単型化されています({what}: {p} ≠ {a})"

/-- 標準時間型の対応表: Std.Time ↔ java.time の正準対応。
    対象は `abbrev Date := Std.Time.PlainDate` 等の別名で使う(whnf が剥がす)。
    ワイヤは ISO-8601 文字列(直列化は対象の Runtime の ToJson インスタンス)。 -/
def stdTimeKind? (n : Name) : Option String :=
  if n == `Std.Time.PlainDate then some "date"
  else if n == `Std.Time.PlainDateTime then some "datetime"
  else if n == `Std.Time.ZonedDateTime then some "zoned"
  else none

/-- canonical UUID 文字列(8-4-4-4-12 の hex)か — Id 型のワイヤ観測。 -/
def isUuidString (s : String) : Bool :=
  let parts := s.splitOn "-"
  parts.map (·.length) == [8, 4, 4, 4, 12] &&
    parts.all (·.all fun c => c.isDigit || ('a' ≤ c && c ≤ 'f') || ('A' ≤ c && c ≤ 'F'))

partial def typeToIR (rootNs : Name) (reg : MonoReg) (e : Expr) : MetaM Json := do
  let e ← whnf (← instantiateMVars e)
  match e with
  | .const n _ =>
    if n == ``Nat then return Json.mkObj [("k", "nat")]
    else if n == ``String then return Json.mkObj [("k", "string")]
    else if n == ``Bool then return Json.mkObj [("k", "bool")]
    else if n == ``Unit || n == ``PUnit then return Json.mkObj [("k", "unit")]
    else if let some k := stdTimeKind? n then return Json.mkObj [("k", k)]
    else if rootNs.isPrefixOf n then do
      registerMono reg s!"{n}" { head := n, args := #[], expr := e }
      return Json.mkObj [("k", "ref"), ("name", toString n)]
    else throwError "lean2kotlin: Kotlin へ写像できない型定数です: {n}"
  | .app .. => do
    let f := e.getAppFn
    let args := e.getAppArgs
    match f with
    | .const n _ =>
      if n == ``List && args.size == 1 then
        return Json.mkObj [("k", "list"), ("of", ← typeToIR rootNs reg args[0]!)]
      else if n == ``Option && args.size == 1 then
        return Json.mkObj [("k", "option"), ("of", ← typeToIR rootNs reg args[0]!)]
      else if n == ``Prod && args.size == 2 then
        return Json.mkObj [("k", "pair"),
          ("fst", ← typeToIR rootNs reg args[0]!), ("snd", ← typeToIR rootNs reg args[1]!)]
      else if n == ``Except && args.size == 2 then
        return Json.mkObj [("k", "result"),
          ("err", ← typeToIR rootNs reg args[0]!), ("ok", ← typeToIR rootNs reg args[1]!)]
      else if rootNs.isPrefixOf n then do
        registerMono reg s!"{n}" { head := n, args := args, expr := e }
        return Json.mkObj [("k", "ref"), ("name", toString n)]
      else
        throwError "lean2kotlin: Kotlin へ写像できない型適用です: {e}"
    | _ => throwError "lean2kotlin: Kotlin へ写像できない型です: {e}"
  | .forallE _ dom body _ =>
    if body.hasLooseBVars then
      throwError "lean2kotlin: 依存関数型は写像できません: {e}"
    else
      return Json.mkObj [("k", "arrow"),
        ("from", ← typeToIR rootNs reg dom), ("to", ← typeToIR rootNs reg body)]
  | _ => throwError "lean2kotlin: Kotlin へ写像できない型です: {e}"

partial def collectRefs (j : Json) (acc : Array Name := #[]) : Array Name :=
  match j.getObjVal? "k" with
  | .ok (.str "ref") =>
    match j.getObjVal? "name" with
    | .ok (.str n) => acc.push n.toName
    | _ => acc
  | .ok (.str "list") | .ok (.str "option") | .ok (.str "withDefault") =>
    match j.getObjVal? "of" with
    | .ok o => collectRefs o acc
    | _ => acc
  | .ok (.str "pair") =>
    let acc := match j.getObjVal? "fst" with | .ok o => collectRefs o acc | _ => acc
    match j.getObjVal? "snd" with | .ok o => collectRefs o acc | _ => acc
  | .ok (.str "result") =>
    let acc := match j.getObjVal? "err" with | .ok o => collectRefs o acc | _ => acc
    match j.getObjVal? "ok" with | .ok o => collectRefs o acc | _ => acc
  | .ok (.str "arrow") =>
    let acc := match j.getObjVal? "from" with | .ok o => collectRefs o acc | _ => acc
    match j.getObjVal? "to" with | .ok o => collectRefs o acc | _ => acc
  | _ => acc

structure FieldIR where
  name : String
  type : Json

def FieldIR.toJson (f : FieldIR) : Json :=
  Json.mkObj [("name", f.name), ("type", f.type)]

/-- 既定値(リテラルに簡約できるもの)の JSON 化。 -/
def defaultLit? (structName field : Name) (targs : Array Expr) :
    MetaM (Option Json) := do
  let env ← getEnv
  let some fn := getDefaultFnForField? env structName field | return none
  let ci ← getConstInfo fn
  -- 既定値関数は構造体の型引数を先頭に取り得る — 規約引数で埋めてから評価
  let e ← applyConvArgs (mkConst fn) ci.type targs
  let v ← whnf e
  match v with
  | .lit (.natVal n) => return some (Json.num n)
  | .lit (.strVal s) => return some (Json.str s)
  | .const c _ =>
    if c == ``Bool.true then return some (Json.bool true)
    else if c == ``Bool.false then return some (Json.bool false)
    else return none
  | _ => return none
where
  applyConvArgs (e ty : Expr) (targs : Array Expr) : MetaM Expr := do
    let mut e := e
    let mut ty ← whnf ty
    let mut i := 0
    repeat
      match ty with
      | .forallE _ dom body bi =>
        if bi == .instImplicit then
          let inst ← synthInstance dom
          e := mkApp e inst
          ty ← whnf (body.instantiate1 inst)
        else if dom.isSort && i < targs.size then
          e := mkApp e targs[i]!
          ty ← whnf (body.instantiate1 targs[i]!)
          i := i + 1
        else break
      | _ => break
    return e

def ctorFields (rootNs : Name) (reg : MonoReg) (ctor : Name) (targs : Array Expr := #[]) :
    MetaM (Array FieldIR) := do
  let ci ← getConstInfoCtor ctor
  unless targs.size == ci.numParams do
    throwError "lean2kotlin: {ctor} の型引数の数が一致しません({targs.size} ≠ {ci.numParams})"
  let structName := ctor.getPrefix
  let isStruct := isStructure (← getEnv) structName
  let ty ← instantiateForall ci.type targs
  forallTelescopeReducing ty fun xs _ => do
    let mut out : Array FieldIR := #[]
    let mut i := 0
    for x in xs do
      let decl ← x.fvarId!.getDecl
      -- 制約(Prop フィールド)はデータではない — 形状から除く(読み取りは structConstraints)
      if ← Meta.isProp decl.type then continue
      let name := if decl.userName.hasMacroScopes then s!"arg{i}" else toString decl.userName
      let tJ ← typeToIR rootNs reg decl.type
      let dflt ← if isStruct then defaultLit? structName decl.userName targs else pure none
      out := out.push (match dflt with
        | some d => { name, type := Json.mkObj [("k", "withDefault"), ("of", tJ), ("default", d)] }
        | none => { name, type := tJ })
      i := i + 1
    return out

def shapeOf (rootNs : Name) (reg : MonoReg) (head : Name) (targs : Array Expr) : MetaM Json := do
  let env ← getEnv
  if isStructure env head then
    let iv ← getConstInfoInduct head
    let fields ← ctorFields rootNs reg iv.ctors.head! targs
    return Json.mkObj [("kind", "structure"),
      ("fields", Json.arr (fields.map FieldIR.toJson))]
  else
    let iv ← getConstInfoInduct head
    let mut ctors : Array (String × Array FieldIR) := #[]
    for c in iv.ctors do
      let fields ← ctorFields rootNs reg c targs
      ctors := ctors.push (toString (c.updatePrefix Name.anonymous), fields)
    if ctors.all (·.2.isEmpty) then
      return Json.mkObj [("kind", "enum"),
        ("ctors", Json.arr (ctors.map (Json.str ·.1)))]
    else
      return Json.mkObj [("kind", "sealed"),
        ("ctors", Json.arr (ctors.map fun (name, fields) =>
          Json.mkObj [("name", name), ("fields", Json.arr (fields.map FieldIR.toJson))]))]

def defaultKotlinName (n : Name) : String :=
  let comps := n.components
  match comps.getLast? with
  | none => toString n
  | some last =>
    let lastS := toString last
    -- UseCase ディレクトリ在住の型(Command / State / ReadModel 等)は
    -- <X>UseCase.<型> → "X<型>" で一意化(1 UseCase 1 ディレクトリ)
    match comps.dropLast.getLast? with
    | some parent =>
      let p := toString parent
      if p.endsWith "UseCase" && p != "UseCase" then
        (p.dropEnd "UseCase".length).toString ++ lastS
      else lastS
    | none => lastS

def isKotlinIdent (s : String) : Bool :=
  !s.isEmpty && s.front.isAlpha && s.all (fun c => c.isAlphanum || c == '_')

/-! ### 役割 -/

inductive Role
  | valueObject | entity | aggregateRoot
  | command | error | readModelRow | viewDto
  /-- Repository / ポートの観測モデル+UseCase の Effect Set(State)— fixture 語彙 -/
  | repositoryState
  /-- 観測の Set(UseCase ごとの ReadModel)— fixture 語彙 -/
  | readModel
  /-- 時計ポート(Clock): 「今日」を配る調達。ポート束と同格の
      引数種で、生成では署名から落ちる(Kotlin は java.time.Clock を直接注入 —
      interface は生成しない)。契約テストは固定 today を実装フックへ渡す -/
  | clockPort
  /-- 主体ポート(@[actorContext]): 「今このリクエストを操作している主体」
      (認証境界が調達する — 利用者の入力ではない)を配る、Clock と同格の
      第 3 の引数種。値の調達(OIDC 等)はモデル外・型と判断はモデル内。
      生成では本番署名から落ち(実装はリクエストスコープの配線で受け取る)、
      Kotlin には data class として写る(JDK に正準型が無いため Clock と違い型は
      生成する)。契約テストは固定の主体を実装フックへ渡す — 主体を量化する
      契約定理がそのまま認可分岐のテストファミリになる -/
  | actorPort
deriving BEq, Repr

def Role.str : Role → String
  | .valueObject => "valueObject" | .entity => "entity" | .aggregateRoot => "aggregateRoot"
  | .command => "command" | .error => "error"
  | .readModelRow => "readModelRow" | .viewDto => "viewDto"
  | .repositoryState => "repositoryState" | .readModel => "readModel"
  | .clockPort => "clockPort"
  | .actorPort => "actorPort"

/-! ### アノテーション(対象自前の TagAttribute)の読み取り -/

unsafe def evalTagAttrUnsafe (n : Name) : MetaM TagAttribute :=
  evalConst TagAttribute n

@[implemented_by evalTagAttrUnsafe]
def evalTagAttr (n : Name) : MetaM TagAttribute :=
  throwError "evalTagAttr: interpreter not available"

/-- 環境から名前 attrName の TagAttribute を見つけ、タグ付き宣言の判定関数を返す。 -/
def tagChecker (attrName : Name) : MetaM (Name → Bool) := do
  let env ← getEnv
  for (n, ci) in env.constants.toList do
    if !n.hasMacroScopes && ci.type.isConstOf ``Lean.TagAttribute then
      let ta ← evalTagAttr n
      if ta.attr.name == attrName then
        return fun d => ta.hasTag env d
  throwError "lean2kotlin: アノテーション @[{attrName}] の TagAttribute が見つかりません(対象プロジェクトの Annotations を import しているドライバで実行してください)"

/-- 任意アノテーションの判定(未導入のプロジェクトでは常に偽 — 抽出を止めない)。 -/
def tagCheckerOpt (attrName : Name) : MetaM (Name → Bool) := do
  try tagChecker attrName catch _ => return fun _ => false

/-! ### 契約定理(@[contract])からのテストケース演繹

対象定理を翻訳可能な断片(結論は観測可能な形・前提は Decidable か
入力パターン・量化変数は生成可能な型)として読み、抽出時に Lean 内で評価して
期待値(オラクル)を焼き込む。CI に Lean は不要のまま。 -/

/-- コンパイル済み評価(unsafe evalExpr)— WF 再帰(mergeSort 等)は kernel 簡約が
    止まらないため、ToJson インスタンスがある型はコンパイル実行で JSON 化する。 -/
unsafe def evalJsonUnsafe (e : Expr) : MetaM Json :=
  Meta.evalExpr Json (mkConst ``Lean.Json) e
@[implemented_by evalJsonUnsafe]
def evalJsonExpr (_ : Expr) : MetaM Json :=
  throwError "evalJsonExpr: interpreter not available"

unsafe def evalBoolUnsafe (e : Expr) : MetaM Bool :=
  Meta.evalExpr Bool (mkConst ``Bool) e
@[implemented_by evalBoolUnsafe]
def evalBoolExpr (_ : Expr) : MetaM Bool :=
  throwError "evalBoolExpr: interpreter not available"

/-- 前方宣言用: ctorFieldTypes は下に定義される(シリアライザ合成が使う)。 -/
private def ctorFieldTypesFwd (ctorName : Name) (lvls : List Level) (typeArgs : Array Expr) :
    MetaM (Array (Expr × Bool)) := do
  let app := mkAppN (mkConst ctorName lvls) typeArgs
  forallTelescopeReducing (← inferType app) fun xs _ =>
    xs.mapM fun x => do
      let t ← inferType x
      return (t, ← Meta.isProp t)

/-- 型 → (その型 → Json) のシリアライザ式を合成する。ToJson インスタンスに
    依存しない(対象は読み取り専用でインスタンスを足せない)。
    形は derived ToJson と同一規約(golden 互換): structure = object、
    引数なし ctor = "名前"、引数つき ctor = {"名前": {...}}、Option = null / 中身。
    合成した式はコンパイル実行(evalExpr)される — WF 再帰も評価できる。 -/
partial def mkSerializer (ty0 : Expr) : MetaM Expr := do
  let ty ← whnf ty0
  -- 既存インスタンスがあればそれを使う(derived と同形)
  try
    let inst ← synthInstance (mkApp (mkConst ``Lean.ToJson [.zero]) ty)
    return mkApp2 (mkConst ``Lean.toJson [.zero]) ty inst
  catch _ => pure ()
  let .const tn lvls := ty.getAppFn
    | throwError "lean2kotlin: シリアライザを合成できない型: {ty}"
  let args := ty.getAppArgs
  if tn == ``List && args.size == 1 then do
    let serEl ← mkSerializer args[0]!
    withLocalDeclD `xs ty fun xs => do
      let mapped ← mkAppM ``List.map #[serEl, xs]
      let body ← mkAppM ``Lean.Json.arr #[← mkAppM ``List.toArray #[mapped]]
      mkLambdaFVars #[xs] body
  else if tn == ``Option && args.size == 1 then do
    let serEl ← mkSerializer args[0]!
    withLocalDeclD `o ty fun o => do
      let mapped ← mkAppM ``Option.map #[serEl, o]
      let body ← mkAppM ``Option.getD #[mapped, mkConst ``Lean.Json.null]
      mkLambdaFVars #[o] body
  else if tn == ``Prod && args.size == 2 then do
    let serA ← mkSerializer args[0]!
    let serB ← mkSerializer args[1]!
    withLocalDeclD `p ty fun p => do
      let a := mkApp serA (← mkAppM ``Prod.fst #[p])
      let b := mkApp serB (← mkAppM ``Prod.snd #[p])
      let body ← mkAppM ``Lean.Json.arr #[← mkArrayLit (mkConst ``Lean.Json) [a, b]]
      mkLambdaFVars #[p] body
  else do
    let env ← getEnv
    let some (.inductInfo ii) := env.find? tn
      | throwError "lean2kotlin: シリアライザを合成できない型: {ty}"
    let pairTy := mkApp2 (mkConst ``Prod [.zero, .zero])
      (mkConst ``String) (mkConst ``Lean.Json)
    let mkPair (nm : String) (v : Expr) : MetaM Expr :=
      mkAppM ``Prod.mk #[mkStrLit nm, v]
    if isStructure env tn then do
      let ctor := ii.ctors.head!
      let fnames := getStructureFields env tn
      let ftys ← ctorFieldTypesFwd ctor lvls args
      -- 制約(Prop フィールド)は直列化しない
      let dataIdx := (List.range fnames.size).filter (fun i => !ftys[i]!.2)
      let mut sers : Array Expr := #[]
      for i in dataIdx do
        sers := sers.push (← mkSerializer ftys[i]!.1)
      withLocalDeclD `s ty fun s => do
        let mut pairs : List Expr := []
        for (i, k) in dataIdx.zip (List.range dataIdx.length) do
          pairs := pairs ++ [← mkPair (toString fnames[i]!)
            (mkApp sers[k]! (Expr.proj tn i s))]
        let body ← mkAppM ``Lean.Json.mkObj #[← mkListLit pairTy pairs]
        mkLambdaFVars #[s] body
    else
      withLocalDeclD `x ty fun x => do
        let motive ← withLocalDeclD `t ty fun t =>
          mkLambdaFVars #[t] (mkConst ``Lean.Json)
        let mut cargs : Array (Option Expr) := args.map some
        cargs := cargs.push (some motive)
        cargs := cargs.push (some x)
        for ctor in ii.ctors do
          let short := toString (ctor.updatePrefix Name.anonymous)
          let ctorApp := mkAppN (mkConst ctor lvls) args
          let minor ← forallTelescopeReducing (← inferType ctorApp) fun fs _ => do
            let body ← if fs.isEmpty then
                mkAppM ``Lean.Json.str #[mkStrLit short]
              else do
                let mut pairs : List Expr := []
                for f in fs do
                  let d ← f.fvarId!.getDecl
                  if ← Meta.isProp d.type then continue
                  let ser ← mkSerializer d.type
                  pairs := pairs ++ [← mkPair (toString d.userName) (mkApp ser f)]
                let inner ← mkAppM ``Lean.Json.mkObj #[← mkListLit pairTy pairs]
                mkAppM ``Lean.Json.mkObj #[← mkListLit pairTy
                  [← mkPair short inner]]
            mkLambdaFVars fs body
          cargs := cargs.push (some minor)
        let body ← mkAppOptM (tn ++ `casesOn) cargs
        mkLambdaFVars #[x] body

/-- 値ラッパ(単一フィールド structure)のワイヤ直列化のキャッシュ:
    型 → ToJson インスタンスの有無/(型, Nat 値) → JSON。 -/
initialize wireInstCache : IO.Ref (Std.HashMap Name Bool) ← IO.mkRef {}
initialize wireJsonCache : IO.Ref (Std.HashMap (Name × Nat) Json) ← IO.mkRef {}

/-- ToJson インスタンス or 合成シリアライザ経由の JSON 化(コンパイル実行 —
    kernel 簡約が止まる WF 再帰でも評価できる)。取れなければ none。 -/
def jsonViaInstance (e : Expr) : MetaM (Option Json) := do
  try
    let ty ← inferType e
    let ser ← mkSerializer ty
    return some (← evalJsonExpr (mkApp ser e))
  catch _ => return none

/-- ctor 正規形の値 → golden 互換 JSON。
    structure = フィールドの object、引数なし ctor = "名前"、
    引数つき ctor = {"名前": {引数: 値}}、Option = null / 中身、
    List = 配列、Prod = [fst, snd]。 -/
partial def valueToJson (e : Expr) : MetaM Json := do
  -- 標準時間型(Std.Time)は ctor 分解せず ToJson インスタンスで直列化する
  -- (ISO-8601 文字列 — 対象の Runtime が定義。ctor 分解すると内部表現が漏れる)
  let ty ← whnf (← inferType e)
  if let .const tyN _ := ty.getAppFn then
    if (stdTimeKind? tyN).isSome then
      match ← jsonViaInstance e with
      | some j => return j
      | none => throwError "lean2kotlin: 標準時間型 {tyN} の ToJson インスタンスがありません(対象の Runtime が ISO-8601 直列化を定義している必要があります)"
    -- 単一フィールドの structure(Id 等の値ラッパ)は対象の ToJson インスタンスを
    -- 優先する — 表現のワイヤ(例: Id の canonical UUID 文字列)
    -- をそのまま写す(golden 互換を構造で保証 — 標準時間型と同じ手筋)。derived の
    -- インスタンスは ctor 分解と同形なので、挙動が変わるのは手書きワイヤだけ。
    -- コンパイル実行は値ノードごとに走るため、(型, Nat 値) でキャッシュする
    let env ← getEnv
    if isStructure env tyN && (getStructureFields env tyN).size == 1 then
      let hasInst ← do
        match (← wireInstCache.get).get? tyN with
        | some b => pure b
        | none =>
          let b ← try
              discard <| synthInstance (mkApp (mkConst ``Lean.ToJson [.zero]) ty)
              pure true
            catch _ => pure false
          wireInstCache.modify (·.insert tyN b)
          pure b
      if hasInst then
        let eW ← whnf e
        let key? ← do
          if eW.getAppFn matches .const _ _ then
            let args := eW.getAppArgs
            if args.size > 0 then
              match ← whnf args.back! with
              | .lit (.natVal v) => pure (some (tyN, v))
              | _ => pure (none : Option (Name × Nat))
            else pure none
          else pure none
        if let some key := key? then
          if let some j := (← wireJsonCache.get).get? key then return j
        if let some j ← jsonViaInstance eW then
          if let some key := key? then wireJsonCache.modify (·.insert key j)
          return j
  let e ← whnf e
  match e with
  | .lit (.natVal n) => return Json.num n
  | .lit (.strVal s) => return Json.str s
  | _ =>
    let .const cn _ := e.getAppFn
      | match ← jsonViaInstance e with
        | some j => return j
        | none => throwError "lean2kotlin: 値を JSON にできません(ctor 正規形でない): {e}"
    let args := e.getAppArgs
    if cn == ``Bool.true then return Json.bool true
    else if cn == ``Bool.false then return Json.bool false
    else if cn == ``List.nil then return Json.arr #[]
    else if cn == ``List.cons then do
      let hd ← valueToJson args[1]!
      let .arr tl := ← valueToJson args[2]!
        | throwError "lean2kotlin: List の尾が配列になりません"
      return Json.arr (#[hd] ++ tl)
    else if cn == ``Option.none then return Json.null
    else if cn == ``Option.some then valueToJson args[1]!
    else if cn == ``Prod.mk then
      return Json.arr #[← valueToJson args[2]!, ← valueToJson args[3]!]
    else do
      let env ← getEnv
      let some (.ctorInfo ci) := env.find? cn
        | match ← jsonViaInstance e with
          | some j => return j
          | none => throwError "lean2kotlin: ctor でない値: {e}"
      let fields := args.extract ci.numParams args.size
      if isStructure env ci.induct then
        let fnames := getStructureFields env ci.induct
        let mut obj : List (String × Json) := []
        for i in [0:fields.size] do
          -- 制約(Prop フィールド)の証明は直列化しない
          if ← Meta.isProof fields[i]! then continue
          obj := obj ++ [(toString fnames[i]!, ← valueToJson fields[i]!)]
        return Json.mkObj obj
      else
        let short := toString (cn.updatePrefix Name.anonymous)
        if fields.isEmpty then return Json.str short
        else do
          let names ← forallTelescopeReducing ci.type fun xs _ =>
            xs.mapM fun x => x.fvarId!.getUserName
          let argNames := names.extract ci.numParams names.size
          let mut obj : List (String × Json) := []
          for i in [0:fields.size] do
            if ← Meta.isProof fields[i]! then continue
            obj := obj ++ [(toString argNames[i]!, ← valueToJson fields[i]!)]
          return Json.mkObj [(short, Json.mkObj obj)]

/-- ctor のフィールド型(型引数適用後)と、それが制約(Prop)かを得る。制約の判定は
    telescope の中で行う — 先行フィールドに依存する型は外に出すと判定できない。 -/
def ctorFieldTypes (ctorName : Name) (lvls : List Level) (typeArgs : Array Expr) :
    MetaM (Array (Expr × Bool)) := do
  let app := mkAppN (mkConst ctorName lvls) typeArgs
  forallTelescopeReducing (← inferType app) fun xs _ =>
    xs.mapM fun x => do
      let t ← inferType x
      return (t, ← Meta.isProp t)

/-- 型が Id 型(と List / Option / Prod)だけから成るか(泉から導出する引数の判定)。 -/
partial def isIdOnly (idHeads : List Name) (ty : Expr) : MetaM Bool := do
  let ty ← whnf ty
  let .const tn _ := ty.getAppFn | return false
  let args := ty.getAppArgs
  if idHeads.contains tn then return true
  else if tn == ``List && args.size == 1 then isIdOnly idHeads args[0]!
  else if tn == ``Option && args.size == 1 then isIdOnly idHeads args[0]!
  else if tn == ``Prod && args.size == 2 then
    return (← isIdOnly idHeads args[0]!) && (← isIdOnly idHeads args[1]!)
  else return false

/-- 命題を decide で評価(できなければ none)。 -/
def decideProp (p : Expr) : MetaM (Option Bool) := do
  let d ← try mkDecide p catch _ => return none
  -- コンパイル実行が第一(kernel 簡約は WF 再帰で止まり、重い)
  try
    return some (← evalBoolExpr d)
  catch _ => pure ()
  try
    let r ← withTransparency .all <| reduce d (skipTypes := true) (skipProofs := true)
    if r.isConstOf ``Bool.true then return some true
    else if r.isConstOf ``Bool.false then return some false
    else return none
  catch _ => return none

/-- サンプル値の構築。variant 0 = 通常、1 = 境界(List を空に・別 ctor を選ぶ)。
    Id 型は固定鍵 91(泉の領域 100.. と非衝突)。文字列はカウンタで一意。 -/
partial def buildValue (idHeads : List Name) (ctr : IO.Ref Nat)
    (ty : Expr) (variant : Nat) : MetaM (Option Expr) := do
  let ty ← whnf ty
  -- 矢印: 鍵・埋め込みの規約形だけ構築できる(数値鍵は仮置き表現の写し)
  if ty.isForall then
    let dom := ty.bindingDomain!
    let cod := ty.bindingBody!   -- 非依存前提
    let domW ← whnf dom
    let codW ← whnf cod
    let idCtorOf (t : Expr) : MetaM (Option (Name × List Level × Array Expr)) := do
      match t.getAppFn with
      | .const hn hl =>
        if idHeads.contains hn then
          let env ← getEnv
          let some (.inductInfo ii) := env.find? hn | return none
          return some (ii.ctors.head!, hl, t.getAppArgs)
        else return none
      | _ => return none
    if domW.getAppFn.isConstOf ``Nat then
      -- Nat → Id: 採番値の埋め込み = ctor
      if let some (ctor, hl, targs) ← idCtorOf codW then
        return some (.lam `n domW (mkAppN (mkConst ctor hl) (targs ++ #[.bvar 0])) .default)
    if codW.getAppFn.isConstOf ``Nat then
      -- Id → Nat: 乱択の鍵 = 中身の射影(仮置き表現の写し)
      if let some (_, _, _) ← idCtorOf domW then
        let .const dn _ := domW.getAppFn | return none
        return some (.lam `x domW (.proj dn 0 (.bvar 0)) .default)
    -- σ → α × σ(泉の供給 step — Fountain の規約形):
    -- σ = 単一 Nat フィールドの生成器状態・α = Id 型のとき、カウンタ具体化
    -- (残高を配り、残高を 1 進める — 対象の Fountain.counter と同形)を合成する
    if codW.getAppFn.isConstOf ``Prod && codW.getAppArgs.size == 2 then
      let pArgs := codW.getAppArgs
      if (← isDefEq pArgs[1]! domW) then
        if let some (idCtor, idLvls, idTargs) ← idCtorOf (← whnf pArgs[0]!) then
          if let .const dn dLvls := domW.getAppFn then
            let env ← getEnv
            if isStructure env dn && (getStructureFields env dn).size == 1 then
              if let some (.inductInfo dii) := env.find? dn then
                let stCtor := dii.ctors.head!
                let dTargs := domW.getAppArgs
                let fieldTys ← ctorFieldTypes stCtor dLvls dTargs
                if (← whnf fieldTys[0]!.1).getAppFn.isConstOf ``Nat then
                  let proj := Expr.proj dn 0 (.bvar 0)
                  let idVal := mkAppN (mkConst idCtor idLvls) (idTargs ++ #[proj])
                  let stVal := mkAppN (mkConst stCtor dLvls)
                    (dTargs ++ #[mkApp2 (mkConst ``Nat.add) proj (mkNatLit 1)])
                  let pair := mkApp4 (mkConst ``Prod.mk [.zero, .zero])
                    pArgs[0]! domW idVal stVal
                  return some (.lam `s domW pair .default)
    return none
  let .const tn lvls := ty.getAppFn | return none
  let args := ty.getAppArgs
  if tn == ``Nat then return some (mkNatLit (4 + variant))
  else if tn == `Std.Time.PlainDate then do
    -- 標準時間型: epoch 日で決定的に構築。variant で日をずらす —
    -- 独立にサンプルされる日付(clock.today と createdOn 等)の組合せが
    -- Date.le の両分岐(過去・未来)へ届く
    let days ← mkAppM ``Int.ofNat #[mkNatLit (20000 + variant)]
    let off ← mkAppM ``Std.Time.Day.Offset.ofInt #[days]
    return some (← mkAppM ``Std.Time.PlainDate.ofEpochDay #[off])
  else if tn == ``String then do
    -- variant 5 = 空文字列の境界: 「空でない」制約の失敗枝(execute の
    -- invalidValue)へ届かせる専用 variant。2 に重ねると
    -- 「別 ctor+通常値」の成功ケース(execute_ok_new 等)が消えるため分離。
    -- ケースの採用は定理の仮定(選択器)が決めるため、他の枝を汚さない
    if variant == 5 then return some (mkStrLit "")
    let n ← ctr.modifyGet fun n => (n, n + 1)
    return some (mkStrLit s!"s{n}")
  else if tn == ``Bool then
    return some (mkConst (if variant == 0 then ``Bool.false else ``Bool.true))
  else if tn == ``List && args.size == 1 then do
    let nil := mkApp (mkConst ``List.nil [.zero]) args[0]!
    let cons (h t : Expr) := mkApp3 (mkConst ``List.cons [.zero]) args[0]! h t
    -- variant 6 = 境界リスト+第 1 構成子(execute_noFolders_existing 等 —
    -- 「既存を指す入力+空のリスト」の組合せは 1/2 の variant では作れない)
    if variant == 1 || variant == 6 then
      return some nil
    else if variant == 3 || variant == 4 then do
      -- 混在リスト [通常, 境界] — 「正常なフォルダ+空フォルダ」等の
      -- 部分故障ケース(all-or-nothing・フェーズ境界)へ届かせる
      let some a ← buildValue idHeads ctr args[0]! 0 | return none
      let some b ← buildValue idHeads ctr args[0]! 1 | return none
      return some (cons a (cons b nil))
    else do
      -- variant 2 は要素へ透過(liked=true・別 ctor の個体を状態に届かせる)
      let some x ← buildValue idHeads ctr args[0]! (if variant == 2 then 2 else 0)
        | return none
      return some (cons x nil)
  else if tn == ``Option && args.size == 1 then do
    if variant == 1 then
      return some (mkApp (mkConst ``Option.none [.zero]) args[0]!)
    else do
      let some x ← buildValue idHeads ctr args[0]! 0 | return none
      return some (mkApp2 (mkConst ``Option.some [.zero]) args[0]! x)
  else do
    let env ← getEnv
    let some (.inductInfo ii) := env.find? tn | return none
    if idHeads.contains tn then
      -- Id 型(単一 Nat フィールドの structure 規約)。鍵は variant で変位させる —
      -- 同一 variant 同士(コマンドと状態)は一致し、混在リストの個体は重複しない
      -- (id 重複 = invalid な状態を fixture にしない)
      let ctor := ii.ctors.head!
      -- 変位は 3 周期: 混在リスト(要素 variant 0/1 = 91/92)の個体と
      -- variant 3/4 のコマンド側の鍵が一致する(宛先解決の整合)
      return some (mkAppN (mkConst ctor lvls) (args ++ #[mkNatLit (91 + variant % 3)]))
    -- variant 4 は「混在リスト+第 1 構成子」(3 との違いは inductive の選択のみ)、
    -- variant 6 は「境界リスト+第 1 構成子」
    let ctor := if isStructure env tn then ii.ctors.head!
      else if variant == 4 || variant == 6 then ii.ctors.head!
      else ii.ctors[min variant (ii.ctors.length - 1)]!
    let fnames := if isStructure env tn then getStructureFields env tn else #[]
    -- ctor の型を binder ごとに埋めながら歩く — 制約(Prop フィールド)の型は先行フィールドの値で閉じる
    let mut cty ← inferType (mkAppN (mkConst ctor lvls) args)
    let mut vals : Array Expr := #[]
    let mut i := 0
    repeat
      match ← whnf cty with
      | .forallE _ fty fbody _ =>
        let v ←
          if ← Meta.isProp fty then
            -- 制約: 組んだ値で decide し、真なら証明を作る。偽なら fixture として組めない
            match ← decideProp fty with
            | some true => mkDecideProof fty
            | _ => return none
          -- 泉の種(ids.next 規約フィールド): sampled な Id 変位(91..93)より必ず
          -- 大きい床(500+)から払い出す — 「保存順 = id 昇順」で観測する実 DB でも
          -- 既存(播種)< 新規(泉由来)の大小関係が成立する
          else if i < fnames.size && fnames[i]! == `next &&
              (← whnf fty).getAppFn.isConstOf ``Nat then
            pure (mkNatLit (500 + variant))
          else
            -- variant 1 = 境界(List を空に)、variant 2 = 別 ctor・別値
            -- (内側の inductive が第 2 構成子を選ぶ/Bool が true — .new・liked 等へ届く)
            match ← buildValue idHeads ctr fty variant with
            | some v => pure v
            | none => return none
        vals := vals.push v
        cty := fbody.instantiate1 v
        i := i + 1
      | _ => break
    return some (mkAppN (mkConst ctor lvls) (args ++ vals))

/-- List 値の要素列(ctor 正規形を歩く)。 -/
partial def listElems (e : Expr) : MetaM (Array Expr) := do
  let e ← whnf e
  let .const cn _ := e.getAppFn | throwError "lean2kotlin: List 値ではありません"
  if cn == ``List.nil then return #[]
  else if cn == ``List.cons then do
    let args := e.getAppArgs
    return #[args[1]!] ++ (← listElems args[2]!)
  else throwError "lean2kotlin: List 値ではありません: {e}"

/-- 泉から導出する引数の構築: Id は次の値を消費、List は形(ペイロード値)の
    長さに合わせ、Prod はペイロード要素の List フィールドを部分形として渡す。 -/
partial def deriveWellIds (idHeads : List Name) (queue : IO.Ref (List Nat))
    (ty : Expr) (shape : Option Expr) : MetaM (Option Expr) := do
  let ty ← whnf ty
  let .const tn lvls := ty.getAppFn | return none
  let args := ty.getAppArgs
  if idHeads.contains tn then do
    let env ← getEnv
    let some (.inductInfo ii) := env.find? tn | return none
    let v ← queue.modifyGet fun | n :: rest => (n, rest) | [] => (999, [])
    return some (mkAppN (mkConst ii.ctors.head! lvls) (args ++ #[mkNatLit v]))
  else if tn == ``List && args.size == 1 then do
    let elems ← match shape with
      | some sv => listElems sv
      | none => pure #[mkConst ``Unit.unit]   -- 形なし → 長さ 1(要素形なし)
    let mut vals : Array Expr := #[]
    for se in elems do
      let sub := if shape.isSome then some se else none
      let some v ← deriveWellIds idHeads queue args[0]! sub | return none
      vals := vals.push v
    let nil := mkApp (mkConst ``List.nil [.zero]) args[0]!
    return some (vals.foldr (fun v acc =>
      mkApp3 (mkConst ``List.cons [.zero]) args[0]! v acc) nil)
  else if tn == ``Prod && args.size == 2 then do
    -- ペイロード要素(structure)の List フィールドを snd の形にする
    let subShape ← match shape with
      | none => pure none
      | some sv => do
        let sv ← whnf sv
        match sv.getAppFn with
        | .const scn _ => do
          let env ← getEnv
          match env.find? scn with
          | some (.ctorInfo sci) => do
            let svArgs := sv.getAppArgs
            let ftys ← ctorFieldTypes scn (sv.getAppFn.constLevels!) (svArgs.extract 0 sci.numParams)
            let mut found : Option Expr := none
            for i in [0:ftys.size] do
              let fty ← whnf ftys[i]!.1
              if fty.getAppFn.isConstOf ``List then
                found := some svArgs[sci.numParams + i]!
            pure found
          | _ => pure none
        | _ => pure none
    let some a ← deriveWellIds idHeads queue args[0]! none | return none
    let some b ← deriveWellIds idHeads queue args[1]! subShape | return none
    return some (mkApp4 (mkConst ``Prod.mk [.zero, .zero]) args[0]! args[1]! a b)
  else return none

/-- JSON を深く走査して、集合に含まれる自然数の初出順を集める(泉の値の出現順)。 -/
partial def scanWellNums (allocated : List Nat) (j : Json) (acc : Array Nat) : Array Nat :=
  match j with
  | .num v =>
    if v.exponent == 0 && v.mantissa ≥ 0 then
      let n := v.mantissa.toNat
      if allocated.contains n && !acc.contains n then acc.push n else acc
    else acc
  | .arr a => a.foldl (fun ac x => scanWellNums allocated x ac) acc
  | .obj kvs => kvs.foldl (fun ac _ v => scanWellNums allocated v ac) acc
  | _ => acc

/-! ### 規約適用(パラメトリック宣言の単型化) -/

/-- ドライバ指定の binder 上書き(例: Name=String — Runtime に表現を置かない型引数)。 -/
initialize binderOverrides : IO.Ref (Std.HashMap Name Name) ← IO.mkRef {}

/-- binder 名の規約解決: 上書き → `<Root>.Runtime.<名前>`。 -/
def binderConst (rootNs : Name) (nm : Name) : MetaM Expr := do
  if let some c := (← binderOverrides.get).get? nm then
    return mkConst c
  let c := rootNs ++ `Runtime ++ nm
  unless (← getEnv).contains c do
    throwError "lean2kotlin: 型引数 {nm} に対応する {c} がありません(Runtime の表現規約。例外は plugin の binderOverrides 設定で)"
  return mkConst c

/-- binder 名 → `<Root>.Runtime.<名前>` の対応で型引数を、synthInstance でインスタンス引数を
    埋めて完全適用する(型・インスタンス以外の引数が現れたらそこで止める)。 -/
partial def applyConv (rootNs : Name) (e ty : Expr) : MetaM Expr := do
  let ty ← whnf ty
  match ty with
  | .forallE nm dom body bi => do
    if bi == .instImplicit then
      let inst ← synthInstance dom
      applyConv rootNs (mkApp e inst) (body.instantiate1 inst)
    else if dom.isSort then
      let c := rootNs ++ `Runtime ++ nm
      unless (← getEnv).contains c do
        throwError "lean2kotlin: 型引数 {nm} に対応する {c} がありません(Runtime の表現規約)"
      let arg := mkConst c
      applyConv rootNs (mkApp e arg) (body.instantiate1 arg)
    else
      pure e
  | _ => pure e

/-- inductive の型引数を binder 名規約で単型化した引数列。 -/
def monoArgsByConv (rootNs : Name) (n : Name) : MetaM (Array Expr) := do
  let ci ← getConstInfoInduct n
  let mut args : Array Expr := #[]
  let mut ty := ci.type
  for _ in [0:ci.numParams] do
    let ty' ← whnf ty
    match ty' with
    | .forallE nm dom body _ =>
      unless dom.isSort do
        throwError "lean2kotlin: {n} の型引数 {nm} が Type ではありません"
      let arg ← binderConst rootNs nm
      args := args.push arg
      ty := body.instantiate1 arg
    | _ => throwError "lean2kotlin: {n} の型引数が {ci.numParams} 個ありません"
  return args

/-- 構造体の `id` フィールド(同一性の規約)の単型化済みの型。 -/
def idFieldType (reg : MonoReg) (head : Name) (targs : Array Expr) :
    MetaM (Option MonoType) := do
  let env ← getEnv
  unless isStructure env head do return none
  let iv ← getConstInfoInduct head
  let ci ← getConstInfoCtor iv.ctors.head!
  let ty ← instantiateForall ci.type targs
  forallTelescopeReducing ty fun xs _ => do
    for x in xs do
      let d ← x.fvarId!.getDecl
      if d.userName == `id then
        let m ← normalizeType s!"{head}.id" d.type
        registerMono reg s!"{head}.id" m
        return some m
    return none

/-- 要素 `x` の 1 フィールドの射影(`x.f` / `S.f x`)が指すフィールド名。 -/
private def elemField? (x e : Expr) : MetaM (Option String) := do
  let env ← getEnv
  match e with
  | .proj s i y => return if y == x then (getStructureFields env s)[i]? |>.map toString else none
  | _ =>
    let .const pf _ := e.getAppFn | return none
    let some info := env.getProjectionFnInfo? pf | return none
    unless e.getAppArgs.back? == some x do return none
    return (getStructureFields env info.ctorName.getPrefix)[info.i]? |>.map toString

/-- 述語の右辺として読める閉じた値: Nat / String のリテラル、Bool、対象の inductive の引数なし構成子。
    JSON は valueToJson と同じ形(生成器はそのまま要素のフィールド型のリテラルに写す)。 -/
private def closedValue? (rootNs : Name) (c : Expr) : MetaM (Option Json) := do
  let c ← instantiateMVars c
  if c.hasLooseBVars || c.hasFVar then return none
  if let some n := c.nat? then return some (Json.num n)
  match ← whnf c with
  | .lit (.natVal n) => return some (Json.num n)
  | .lit (.strVal s) => return some (Json.str s)
  | .const n _ =>
    if n == ``Bool.true then return some (Json.bool true)
    else if n == ``Bool.false then return some (Json.bool false)
    else
      match (← getEnv).find? n with
      | some (.ctorInfo ci) =>
        if ci.numFields == 0 && rootNs.isPrefixOf ci.induct then
          return some (Json.str (toString (n.updatePrefix Name.anonymous)))
        else return none
      | _ => return none
  | _ => return none

/-- 要素 `x` についての述語(Prop でも Bool でもよい)のうち読める形を (フィールド, 比較, 値) にする:
    `x.f = c` / `x.f ≠ c` / `¬(x.f = c)` / `x.f == c` / `x.f != c` / `decide (x.f = c)` /
    `(…) = true` / `(…) = false` / Bool フィールドの `x.f` と `!x.f`。比較は eq / ne。 -/
private partial def readPredicate (rootNs : Name) (x b : Expr) :
    MetaM (Option (String × String × Json)) := do
  let b ← instantiateMVars b
  let flip (op : String) : String := if op == "eq" then "ne" else "eq"
  let neg (r : Option (String × String × Json)) : Option (String × String × Json) :=
    r.map fun (f, op, v) => (f, flip op, v)
  let eqPred (lhs rhs : Expr) (op : String) : MetaM (Option (String × String × Json)) := do
    let some f ← elemField? x lhs | return none
    let some v ← closedValue? rootNs rhs | return none
    return some (f, op, v)
  let boolField : MetaM (Option (String × String × Json)) := do
    match ← elemField? x b with
    | some f => return some (f, "eq", Json.bool true)
    | none => return none
  match b.getAppFn with
  | .const n _ =>
    let args := b.getAppArgs
    if n == ``Eq && args.size == 3 then
      -- `x.f = c` を先に読む(Bool フィールドの `x.f = false` は eq false のまま)
      if let some r ← eqPred args[1]! args[2]! "eq" then return some r
      -- `(x.f == c) = true` / `decide (x.f = c) = false` の形
      if args[2]!.isConstOf ``Bool.true then readPredicate rootNs x args[1]!
      else if args[2]!.isConstOf ``Bool.false then return neg (← readPredicate rootNs x args[1]!)
      else return none
    else if n == ``Ne && args.size == 3 then eqPred args[1]! args[2]! "ne"
    else if n == ``Not && args.size == 1 then return neg (← readPredicate rootNs x args[0]!)
    else if n == ``BEq.beq && args.size == 4 then eqPred args[2]! args[3]! "eq"
    else if n == ``bne && args.size == 4 then eqPred args[2]! args[3]! "ne"
    else if n == ``Bool.not && args.size == 1 then return neg (← readPredicate rootNs x args[0]!)
    else if n == ``Decidable.decide && args.size == 2 then readPredicate rootNs x args[0]!
    else boolField
  | _ => boolField

/-- 構造体の制約(Prop フィールド)のうち生成器が読める形を IR にする:
    `List.Nodup (List.map (fun x => x.f) coll)` は unique、
    `List.Nodup (List.filterMap (fun x => x.f) coll)` は uniqueSome(値のあるものだけが対象)、
    `∀ x ∈ coll, p x` は all(全要素が述語を満たす)、
    `(coll.filter p).length ≤ n` は atMost(述語を満たす要素は高々 n 件)。
    coll は同じ構造体の先行フィールド(List)、射影は `fun x => x.f` / `(·.f)` / `S.f`、
    述語 p は要素の 1 フィールドと閉じた値の比較(readPredicate)。
    読めない形は note の文面にして返す。 -/
def structConstraints (rootNs head : Name) (targs : Array Expr) :
    MetaM (Array Json × Array String) := do
  let env ← getEnv
  unless isStructure env head do return (#[], #[])
  let iv ← getConstInfoInduct head
  let ci ← getConstInfoCtor iv.ctors.head!
  let ty ← instantiateForall ci.type targs
  forallTelescopeReducing ty fun xs _ => do
    let mut out : Array Json := #[]
    let mut unreadable : Array String := #[]
    let mut data := 0
    for x in xs do
      let d ← x.fvarId!.getDecl
      unless ← Meta.isProp d.type do
        data := data + 1
        continue
      let name := toString d.userName
      let t ← instantiateMVars d.type
      let form? ← do
        if let some r ← uniqueForm? rootNs xs t then pure (some r)
        else if let some r ← allForm? rootNs xs t then pure (some r)
        else atMostForm? rootNs xs t
      match form? with
      | some (kind, coll, field, extra) =>
        out := out.push (Json.mkObj ([("kind", Json.str kind), ("name", Json.str name),
          ("collection", Json.str coll), ("field", Json.str field)] ++ extra))
      | none => unreadable := unreadable.push s!"{head}.{name}: {← ppExpr d.type}"
    -- データを運ばない構造体(validate の解決の成果物 = 証拠)には fixture が無い — note の対象外
    return (out, if data == 0 then #[] else unreadable)
where
  /-- `List.Nodup l` の l。 -/
  nodupArg? (t : Expr) : Option Expr :=
    match t.getAppFn with
    | .const n _ => if n == ``List.Nodup && t.getAppArgs.size == 2 then some t.getAppArgs[1]! else none
    | _ => none
  /-- 射影 `f : S → β` が指す S のフィールド名。 -/
  projField? (f : Expr) : MetaM (Option String) := do
    let .forallE _ dom _ _ ← whnf (← inferType f) | return none
    withLocalDeclD `x dom fun x => elemField? x (mkApp f x).headBeta
  /-- coll が同じ構造体の先行フィールドで、要素が対象の structure(生成区分を持ち、fixture が引かれる型)なら
      そのフィールド名。Prod の射影などは読めない形。 -/
  collOf? (rootNs : Name) (xs : Array Expr) (coll elTy : Expr) : MetaM (Option String) := do
    unless coll.isFVar && xs.contains coll do return none
    let .const elHead _ := (← whnf elTy).getAppFn | return none
    unless rootNs.isPrefixOf elHead && isStructure (← getEnv) elHead do return none
    return some (toString (← coll.fvarId!.getDecl).userName)
  uniqueForm? (rootNs : Name) (xs : Array Expr) (t : Expr) :
      MetaM (Option (String × String × String × List (String × Json))) := do
    let some inner := nodupArg? t | return none
    let .const mapName _ := inner.getAppFn | return none
    let kind ← if mapName == ``List.map then pure "unique"
      else if mapName == ``List.filterMap then pure "uniqueSome"
      else return none
    -- List.map / List.filterMap : {α β} → (α → …) → List α → List β
    let args := inner.getAppArgs
    unless args.size == 4 do return none
    let some coll ← collOf? rootNs xs args[3]! args[0]! | return none
    let some field ← projField? args[2]! | return none
    return some (kind, coll, field, [])
  /-- `∀ x, x ∈ coll → p x`(`∀ x ∈ coll, p x` の展開形)。 -/
  allForm? (rootNs : Name) (xs : Array Expr) (t : Expr) :
      MetaM (Option (String × String × String × List (String × Json))) := do
    unless t.isForall do return none
    forallBoundedTelescope t (some 2) fun ys body => do
      unless ys.size == 2 do return none
      let x := ys[0]!
      let memTy ← instantiateMVars (← inferType ys[1]!)
      let .const memN _ := memTy.getAppFn | return none
      unless memN == ``Membership.mem && memTy.getAppArgs.size == 5 do return none
      let margs := memTy.getAppArgs
      -- 容れ物と要素の並びは Lean の版に依る — 要素が x のほうを取る
      let (coll, el) := if margs[4]! == x then (margs[3]!, margs[4]!) else (margs[4]!, margs[3]!)
      unless el == x do return none
      let some collName ← collOf? rootNs xs coll (← inferType x) | return none
      let some (field, op, value) ← readPredicate rootNs x body | return none
      return some ("all", collName, field, [("op", Json.str op), ("value", value)])
  /-- `(List.filter p coll).length ≤ n`(n は Nat リテラル)。 -/
  atMostForm? (rootNs : Name) (xs : Array Expr) (t : Expr) :
      MetaM (Option (String × String × String × List (String × Json))) := do
    let .const leN _ := t.getAppFn | return none
    unless leN == ``LE.le && t.getAppArgs.size == 4 do return none
    let lenE := t.getAppArgs[2]!
    let some n := t.getAppArgs[3]!.nat? | return none
    let .const lenN _ := lenE.getAppFn | return none
    unless lenN == ``List.length && lenE.getAppArgs.size == 2 do return none
    let filt := lenE.getAppArgs[1]!
    let .const filtN _ := filt.getAppFn | return none
    unless filtN == ``List.filter && filt.getAppArgs.size == 3 do return none
    let fargs := filt.getAppArgs
    let some collName ← collOf? rootNs xs fargs[2]! fargs[0]! | return none
    unless fargs[1]!.isLambda do return none
    lambdaBoundedTelescope fargs[1]! 1 fun ys body => do
      unless ys.size == 1 do return none
      let some (field, op, value) ← readPredicate rootNs ys[0]! body | return none
      return some ("atMost", collName, field,
        [("op", Json.str op), ("value", value), ("max", Json.num n)])

elab "#kotlin_ir " nsStx:str outStx:str binds:str* : command => do
  let rootNs := nsStx.getString.toName
  let outPath := outStx.getString
  do
    let mut m : Std.HashMap Name Name := {}
    for b in binds do
      let s := b.getString
      match s.splitOn "=" with
      | [k, v] => m := m.insert k.toName v.toName
      | _ => throwError "lean2kotlin: binder 指定は \"名前=定数\" の形で: {s}"
    binderOverrides.set m
  let ir ← runTermElabM fun _ => do
    let env ← getEnv
    let reg : MonoReg ← IO.mkRef {}
    let domainNs := rootNs ++ `Domain
    let appNs := rootNs ++ `Application
    let modOf (n : Name) : Option Name := do
      let idx ← env.getModuleIdxFor? n
      pure env.header.moduleNames[idx.toNat]!
    -- Prop 値の構造体(WF 述語等)はデータではない — 分類対象外
    let isPropSort (n : Name) : Elab.TermElabM Bool := do
      let ci ← getConstInfo n
      forallTelescopeReducing ci.type fun _ b => pure b.isProp
    let isRootTagged ← tagChecker `aggregateRoot
    let isVoTagged ← tagChecker `valueObject
    -- 主体ポート — 任意アノテーション: 未導入のプロジェクトでは常に偽
    let isActorTagged ← tagCheckerOpt `actorContext

    -- 1. 生成区分(ディレクトリ/namespace 規約+アノテーション)
    let errTyName := rootNs ++ `DomainError
    let ucNs := appNs ++ `UseCase
    -- 関数フィールドを持つ structure はポート束(Fountain 等)— DTO ではない
    let hasFunctionField (n : Name) : Elab.TermElabM Bool := do
      if !isStructure env n then return false
      let some (.inductInfo ii) := env.find? n | return false
      let some (.ctorInfo ci) := env.find? ii.ctors.head! | return false
      forallTelescopeReducing ci.type fun xs _ => do
        for i in [ii.numParams:xs.size] do
          let t ← inferType xs[i]!
          -- 制約(Prop フィールド。∀ の形もある)は関数フィールドではない
          if ← Meta.isProp t then continue
          if (← whnf t).isForall then return true
        return false
    -- 時計ポート: 全フィールドが標準時間型の structure(Clock)。
    -- ポート束(関数フィールドの structure)と同格の「調達の引数種」— 型で識別する
    let isClockStruct (n : Name) : Elab.TermElabM Bool := do
      if !isStructure env n then return false
      let some (.inductInfo ii) := env.find? n | return false
      let some (.ctorInfo ci) := env.find? ii.ctors.head! | return false
      forallTelescopeReducing ci.type fun xs _ => do
        let mut data := 0
        for i in [ii.numParams:xs.size] do
          let t ← inferType xs[i]!
          if ← Meta.isProp t then continue
          let t ← whnf t
          let .const tn _ := t.getAppFn | return false
          unless (stdTimeKind? tn).isSome do return false
          data := data + 1
        return data > 0
    let mut roles : Std.HashMap Name Role := {}
    for (n, ci) in env.constants.toList do
      unless rootNs.isPrefixOf n && !n.hasMacroScopes do continue
      let .inductInfo _ := ci | continue
      if isClass env n then continue
      if (← isPropSort n) then continue
      if (← hasFunctionField n) then continue
      let some m := modOf n | continue
      let mLast := m.components.getLast!
      let nLast := toString n.components.getLast!
      if n == errTyName then roles := roles.insert n .error
      else if (← isClockStruct n) then
        -- 時計ポート(Clock): DTO ではなく調達の引数種。
        -- 生成側は署名から落とし、interface も作らない(java.time.Clock を直接注入)
        roles := roles.insert n .clockPort
      else if isActorTagged n then
        -- 主体ポート(@[actorContext]): 操作の主体の調達。置き場に依らず
        -- 印が決める(Clock は型で識別できるが主体のフィールドは平場のため印が要る)
        roles := roles.insert n .actorPort
      else if isVoTagged n then roles := roles.insert n .valueObject
      else if m == domainNs ++ `ValueObject then roles := roles.insert n .valueObject
      else if (domainNs ++ `Entity).isPrefixOf m && isStructure env n then
        roles := roles.insert n (if isRootTagged n then .aggregateRoot else .entity)
      else if m == appNs ++ `RepositoryState && isStructure env n then
        -- Repository / ポートの観測モデル(@[repositoryState] / IdGeneratorState)
        roles := roles.insert n .repositoryState
      else if m == appNs ++ `ReadModel && isStructure env n then
        roles := roles.insert n .readModelRow   -- 共有の Row(Semantic Read Model)
      else if (domainNs.isPrefixOf m || appNs.isPrefixOf m)
          && nLast.endsWith "Error" then
        roles := roles.insert n .error
      else if ucNs.isPrefixOf m && mLast == `Command then
        -- 入力語彙(ペイロード)は各 Command の持ち物
        roles := roles.insert n .command
      else if ucNs.isPrefixOf m && mLast == `ReadModel && isStructure env n then
        roles := roles.insert n .readModel      -- 観測の Set(Effect Set の読み側)
      else if ucNs.isPrefixOf m && mLast == `QueryService && isStructure env n then
        roles := roles.insert n .viewDto        -- Query(リクエスト)DTO
      else if ucNs.isPrefixOf m && mLast == `UseCase && isStructure env n then
        -- 状態遷移契約の装置: State は Effect Set(fixture)、
        -- Result は写像で消える(error 枝 → DomainResult、状態は観測)
        if nLast == "State" then roles := roles.insert n .repositoryState
        else if nLast == "Result" then continue
        else roles := roles.insert n .viewDto
      else if m == appNs ++ `View && isStructure env n then
        -- 閲覧の共有語彙(View)— UseCase ではない(DTO のみ)
        roles := roles.insert n .viewDto
      else
        continue

    -- 2. 同一性と集約(@[repositoryState] 命名規約)。
    -- Repository は <Root>RepositoryState ↔ <Root>Repository の命名規約で導出され、
    -- 生成側は役割 aggregateRoot の型ごとに Repository interface を出す。
    -- 同一性は Entity の id フィールド規約から読む。
    let mut idTypes : Std.HashMap Name MonoType := {}
    for (n, role) in roles.toList do
      if role == .aggregateRoot || role == .entity then
        let targs ← monoArgsByConv rootNs n
        if let some idM ← idFieldType reg n targs then
          idTypes := idTypes.insert n idM
    -- 同一性の型(仮置きの表現 — Runtime/Ids)は ValueObject 区分に自動分類する
    for (_, idM) in idTypes.toList do
      unless roles.contains idM.head do
        roles := roles.insert idM.head .valueObject
    -- @[repositoryState] と集約ルートの対応の検査(命名規約の破れを早期検出)
    let isRepoStateTagged ← tagChecker `repositoryState
    for (n, role) in roles.toList do
      if role == .repositoryState && isRepoStateTagged n then
        let nLast := toString n.components.getLast!
        if nLast.endsWith "RepositoryState" then
          let rootShort := (nLast.dropEnd "RepositoryState".length).toString
          unless roles.toList.any (fun (r, ro) =>
              ro == .aggregateRoot && toString r.components.getLast! == rootShort) do
            throwError "lean2kotlin: {n} に対応する集約ルート {rootShort} が見つかりません(命名規約)"

    -- 3. UseCase / QueryService の interface 面(1 UseCase 1 ディレクトリ)。
    -- モジュールの葉(UseCase / QueryService)で対象を選び、固定形(only)だけを写す。
    -- 状態遷移契約 execute : Command → State → Result の本番面は
    -- 「ペイロード → DomainResult<E, Unit>」(State・ポートは配線)
    let extractServices (modPrefix : Name) (leaf : Name) (suffix : String)
        (only : List Name := []) (stateResult : Bool := false)
        (anyLeaf : Bool := false) :
        Elab.TermElabM (Array Json × Array String) := do
      let mut byMod : Std.HashMap Name (Array Json) := {}
      let mut skipped : Array String := #[]
      let isStateRef (j : Json) : Bool :=
        match j.getObjVal? "k", j.getObjVal? "name" with
        | .ok (.str "ref"), .ok (.str nm) =>
          roles.get? nm.toName == some .repositoryState
        | _, _ => false
      for (n, ci) in env.constants.toList do
        unless rootNs.isPrefixOf n && !n.hasMacroScopes do continue
        let .defnInfo _ := ci | continue
        let some m := modOf n | continue
        unless modPrefix.isPrefixOf m &&
          (anyLeaf && m != modPrefix || m.components.getLast! == leaf) do continue
        unless only.isEmpty || only.contains (n.updatePrefix Name.anonymous) do continue
        -- コンパイラ生成物・インスタンス・射影は interface 面ではない
        if n.isInternalDetail then continue
        if isAuxRecursor env n || isNoConfusion env n then continue
        if [`noConfusionType, `ctorElimType, `ctorIdx, `toCtorIdx].contains
            (n.components.getLast!) then continue
        if (env.getProjectionFnInfo? n).isSome then continue
        if (← Meta.isInstance n) then continue
        if n.components.any (fun c => (toString c).startsWith "inst") then continue
        -- 署名の写し: 型 binder は Runtime 規約、インスタンスは合成、明示引数がメソッド引数
        let sigResult ← try
          let mut ty := ci.type
          let mut params : Array FieldIR := #[]
          let mut i := 0
          repeat
            let ty' ← whnf ty
            match ty' with
            | .forallE nm dom body bi =>
              if bi == .instImplicit then
                let inst ← synthInstance dom
                ty := body.instantiate1 inst
              else if dom.isSort then
                ty := body.instantiate1 (← binderConst rootNs nm)
              else if ← Meta.isProp dom then
                -- 制約の証明(泉の新鮮性など)は実装の義務 — 本番面に写らない
                ty := body.instantiate1 (mkConst ``Unit)
              else
                -- ポート束(関数フィールドの structure)は配線 —
                -- 本番面に写らない(precise 入力と同じ扱い)
                let domW ← whnf dom
                let isPortBundle ← match domW.getAppFn with
                  | .const dn _ => hasFunctionField dn
                  | _ => pure false
                unless isPortBundle do
                  let pname := if nm.hasMacroScopes then s!"arg{i}" else toString nm
                  params := params.push { name := pname, type := ← typeToIR rootNs reg dom }
                  i := i + 1
                -- 引数値には依存しない前提(依存すれば typeToIR が落ちる)
                ty := body.instantiate1 (mkConst ``Unit)
            | _ => break
          let retTy ← whnf ty
          -- 状態遷移契約の戻りの写像:
          --   State                       → Unit(全域 — unlike。効果は状態の観測)
          --   Except E State              → Result<E, Unit>
          --   Result{after: State, error: Option E} → Result<E, Unit>
          -- 効果(状態)はテストが fromState / toState で観測する
          let retMapped? ← do
            if stateResult then
              let headName := match retTy.getAppFn with
                | .const rn _ => some rn
                | _ => none
              match headName with
              | some rn =>
                if roles.get? rn == some .repositoryState then
                  pure (some (Json.mkObj [("k", "unit")]))
                else if (toString rn.components.getLast!) == "Result" &&
                    ucNs.isPrefixOf ((modOf rn).getD Name.anonymous) then
                  -- Result 構造体: error : Option E フィールドから E を読む
                  let some (.inductInfo ii) := env.find? rn | pure none
                  let some (.ctorInfo _) := env.find? ii.ctors.head! | pure none
                  let ftys ← ctorFieldTypes ii.ctors.head! retTy.getAppFn.constLevels!
                    retTy.getAppArgs
                  let fnames := getStructureFields env rn
                  let mut errJ : Option Json := none
                  for k in [0:ftys.size] do
                    if toString fnames[k]! == "error" then
                      let fty ← whnf ftys[k]!.1
                      if fty.getAppFn.isConstOf ``Option then
                        errJ := some (← typeToIR rootNs reg fty.getAppArgs[0]!)
                  match errJ with
                  | some e => pure (some (Json.mkObj [("k", "result"),
                      ("err", e), ("ok", Json.mkObj [("k", "unit")])]))
                  | none => pure none
                else if retTy.getAppFn.isConstOf ``Except then
                  let okJ ← typeToIR rootNs reg retTy.getAppArgs[1]!
                  if isStateRef okJ then
                    pure (some (Json.mkObj [("k", "result"),
                      ("err", ← typeToIR rootNs reg retTy.getAppArgs[0]!),
                      ("ok", Json.mkObj [("k", "unit")])]))
                  else pure none
                else pure none
              | none => pure none
            else pure none
          let ret ← match retMapped? with
            | some r => pure r
            | none => typeToIR rootNs reg retTy
          pure (some (params, ret))
        catch e =>
          skipped := skipped.push s!"{n}: {← e.toMessageData.toString}"
          pure none
        if let some (params, ret) := sigResult then
          -- 署名が参照する型はすべて生成区分を持つこと(未分類参照ならスキップ明示)
          let refs := (params.map (·.type)).push ret |>.foldl (fun a t => collectRefs t a) #[]
          let missing := refs.filter (fun r => !roles.contains r)
          if !missing.isEmpty then
            skipped := skipped.push s!"{n}: 未分類の型を参照({missing})"
            continue
          let methodJ := Json.mkObj [
            ("name", toString (n.updatePrefix Name.anonymous)),
            ("doc", (← findDocString? env n).getD ""),
            ("params", Json.arr (params.map FieldIR.toJson)), ("ret", ret)]
          -- 所属は UseCase ディレクトリ名(モジュールの親)。anyLeaf(DomainService)は
          -- ファイル = サービス単位なので葉そのもの
          let dir := if anyLeaf then m.components.getLast!
            else m.components.dropLast.getLast!
          byMod := byMod.insert dir ((byMod.get? dir |>.getD #[]).push methodJ)
      let svcJs := byMod.toList.toArray.qsort (fun a b => toString a.1 < toString b.1)
        |>.map fun (dir, methods) =>
          let dirS := toString dir
          -- 名前の規則: UseCase ディレクトリ `<X>UseCase` は `<X>` + suffix
          -- (`PostNoteUseCase` → `PostNoteQueryService`、UseCase 自身は suffix 無しでそのまま)。
          -- DomainService はファイル名がサービス名で `<名前>` + suffix(`Pricing` → `PricingService`)。
          -- 単一ファイル `Domain/DomainService.lean` の葉はそのまま `DomainService`
          -- (末尾の文字数で切ると短い名前が同名に潰れ、生成物が上書きで消える)
          let name := if suffix.isEmpty || dirS == "DomainService" then dirS
            else if dirS.endsWith "UseCase" then (dirS.dropEnd "UseCase".length).toString ++ suffix
            else dirS ++ suffix
          Json.mkObj [("name", name), ("module", dirS),
                      ("methods", Json.arr methods)]
      return (svcJs, skipped)
    -- 参照系: 各 UseCase ディレクトリの QueryService(固定名 query)
    let (queryJs, qSkipped) ← extractServices ucNs `QueryService "QueryService"
      (only := [`query])
    -- 更新系+画面: 各 UseCase ディレクトリの UseCase(固定形 validate / execute)
    let (useCaseJs, uSkipped) ← extractServices ucNs `UseCase ""
      (only := [`validate, `execute]) (stateResult := true)
    -- DomainService(複数の集約ルートへの関心)— Domain/DomainService/ の def が現れたら interface を生成
    let (domainSvcJs, dsSkipped) ← extractServices (domainNs ++ `DomainService)
      `DomainService "Service" (anyLeaf := true)
    for s in dsSkipped do
      logInfo m!"lean2kotlin: 署名を写像できないため interface 面から除外: {s}"
    for s in qSkipped ++ uSkipped do
      logInfo m!"lean2kotlin: 署名を写像できないため interface 面から除外: {s}"
    -- サービス名は生成ファイル名 — 同名は黙って上書きされるので抽出で止める
    let serviceNames := (queryJs ++ useCaseJs ++ domainSvcJs).filterMap fun j =>
      match j.getObjVal? "name", j.getObjVal? "module" with
      | .ok (.str nm), .ok (.str md) => some (nm, md)
      | _, _ => none
    let mut seenSvc : Std.HashMap String String := {}
    for (nm, md) in serviceNames do
      if let some prev := seenSvc.get? nm then
        throwError "lean2kotlin: サービス名 {nm} が衝突しています: {prev} と {md}"
      seenSvc := seenSvc.insert nm md
    -- 4. ふるまいの interface(Entity の def・VO / 入力語彙の制約・State の観測)。
    -- 「本番に写るのは Entity のふるまい+UseCase interface」の Entity 側。
    -- 対象: ふるまいモジュール内の def で、親 namespace が分類済みの型と一致するもの。
    -- State(fixture)のふるまいはテスト側に写る(生成側で振り分け)
    let behaviorSubjectRoles : List Role :=
      [.valueObject, .entity, .aggregateRoot, .command, .repositoryState]
    let isBehaviorModule (m : Name) : Bool :=
      (domainNs ++ `Entity).isPrefixOf m || m == domainNs ++ `ValueObject ||
        m == appNs ++ `RepositoryState ||
        (ucNs.isPrefixOf m && m.components.getLast! == `Command)
    let mut behaviorDefs : Std.HashMap Name Name := {}
    let mut behaviorByType : Std.HashMap Name (Array Json) := {}
    let mut behaviorMods : Std.HashMap Name Name := {}
    for (n, ci) in env.constants.toList do
      unless rootNs.isPrefixOf n && !n.hasMacroScopes do continue
      let .defnInfo _ := ci | continue
      let some m := modOf n | continue
      unless isBehaviorModule m do continue
      if n.isInternalDetail then continue
      if isAuxRecursor env n || isNoConfusion env n then continue
      if [`noConfusionType, `ctorElimType, `ctorIdx, `toCtorIdx].contains
          (n.components.getLast!) then continue
      if (env.getProjectionFnInfo? n).isSome then continue
      if (← Meta.isInstance n) then continue
      if n.components.any (fun c => (toString c).startsWith "inst") then continue
      let comps := n.components
      if comps.length < 2 then continue
      let pLast := comps[comps.length - 2]!
      let some (tyN, _) := roles.toList.find? (fun (t, ro) =>
          t.components.getLast! == pLast && behaviorSubjectRoles.contains ro) | continue
      let sigResult ← try
        let mut ty := ci.type
        let mut params : Array FieldIR := #[]
        let mut i := 0
        repeat
          let ty' ← whnf ty
          match ty' with
          | .forallE nm dom body bi =>
            if bi == .instImplicit then
              let inst ← synthInstance dom
              ty := body.instantiate1 inst
            else if dom.isSort then
              ty := body.instantiate1 (← binderConst rootNs nm)
            else if ← Meta.isProp dom then
              -- 制約の証明は実装の義務 — 署名に写らない
              ty := body.instantiate1 (mkConst ``Unit)
            else
              let pname := if nm.hasMacroScopes then s!"arg{i}" else toString nm
              params := params.push { name := pname, type := ← typeToIR rootNs reg dom }
              i := i + 1
              ty := body.instantiate1 (mkConst ``Unit)
          | _ => break
        pure (some (params, ← typeToIR rootNs reg (← whnf ty)))
      catch e =>
        logInfo m!"lean2kotlin: ふるまい {n} の署名を写像できず除外: {← e.toMessageData.toString}"
        pure none
      if let some (params, ret) := sigResult then
        let refs := (params.map (·.type)).push ret |>.foldl (fun a t => collectRefs t a) #[]
        if refs.any (fun r => !roles.contains r) then
          logInfo m!"lean2kotlin: ふるまい {n} は未分類の型を参照するため除外"
          continue
        let methodJ := Json.mkObj [
          ("name", toString (n.updatePrefix Name.anonymous)),
          ("doc", (← findDocString? env n).getD ""),
          ("params", Json.arr (params.map FieldIR.toJson)), ("ret", ret)]
        behaviorByType := behaviorByType.insert tyN
          ((behaviorByType.get? tyN |>.getD #[]).push methodJ)
        behaviorDefs := behaviorDefs.insert n tyN
        behaviorMods := behaviorMods.insert tyN m
    let behaviorsJs := behaviorByType.toList.toArray.qsort
        (fun a b => toString a.1 < toString b.1)
      |>.map fun (tyN, methods) =>
        Json.mkObj [("subject", toString tyN),
          ("module", toString ((behaviorMods.get? tyN).getD Name.anonymous)),
          ("methods", Json.arr methods)]

    -- 5. 判断関数(QueryService モジュールの query 以外)と
    -- 射影(Application/Projection — DDL テストのオラクル源)の走査。
    -- 判断はモードの経路付けにだけ使う — 判断定理はケース選択器であり、
    -- 観測は本番契約面(UseCase の execute)に置く(Judgments 語彙は立てない)
    let mut judgmentDefs : Std.HashMap Name Name := {}   -- def → UseCase ディレクトリ
    let mut execByDir : Std.HashMap Name Name := {}      -- UseCase ディレクトリ → execute
    let mut projDefs : Std.HashMap Name (Name × Name) := {}   -- def → (State 型, Row 型)
    for (n, ci) in env.constants.toList do
      unless rootNs.isPrefixOf n && !n.hasMacroScopes do continue
      let .defnInfo _ := ci | continue
      let some m := modOf n | continue
      if ucNs.isPrefixOf m && m.components.getLast! == `UseCase &&
          (n.updatePrefix Name.anonymous) == `execute then
        execByDir := execByDir.insert (m.components.dropLast.getLast!) n
      let isJudgment := ucNs.isPrefixOf m && m.components.getLast! == `QueryService &&
        (n.updatePrefix Name.anonymous) != `query
      let isProjection := m == appNs ++ `Projection
      unless isJudgment || isProjection do continue
      if n.isInternalDetail then continue
      if isAuxRecursor env n || isNoConfusion env n then continue
      if [`noConfusionType, `ctorElimType, `ctorIdx, `toCtorIdx, `ofNat].contains
          (n.components.getLast!) then continue
      if (env.getProjectionFnInfo? n).isSome then continue
      if (← Meta.isInstance n) then continue
      if n.components.any (fun c => (toString c).startsWith "inst") then continue
      let sigResult ← try
        let mut ty := ci.type
        let mut params : Array FieldIR := #[]
        let mut i := 0
        repeat
          let ty' ← whnf ty
          match ty' with
          | .forallE nm dom body bi =>
            if bi == .instImplicit then
              let inst ← synthInstance dom
              ty := body.instantiate1 inst
            else if dom.isSort then
              ty := body.instantiate1 (← binderConst rootNs nm)
            else if ← Meta.isProp dom then
              -- 制約の証明は実装の義務 — 署名に写らない
              ty := body.instantiate1 (mkConst ``Unit)
            else
              let pname := if nm.hasMacroScopes then s!"arg{i}" else toString nm
              params := params.push { name := pname, type := ← typeToIR rootNs reg dom }
              i := i + 1
              ty := body.instantiate1 (mkConst ``Unit)
          | _ => break
        pure (some (params, ← typeToIR rootNs reg (← whnf ty)))
      catch _ => pure none
      let some (params, ret) := sigResult | continue
      let refs := (params.map (·.type)).push ret |>.foldl (fun a t => collectRefs t a) #[]
      if refs.any (fun r => !roles.contains r) then continue
      if isProjection then
        -- 射影: 主体が State(親 namespace)で Row の列を返すものだけ対象
        let comps := n.components
        if comps.length < 2 then continue
        let pLast := comps[comps.length - 2]!
        let some (stTy, _) := roles.toList.find? (fun (t, ro) =>
            ro == .repositoryState && t.components.getLast! == pLast) | continue
        let rowTy? := (collectRefs ret #[]).find? (fun r =>
          roles.get? r == some .readModelRow)
        let some rowTy := rowTy? | continue
        projDefs := projDefs.insert n (stTy, rowTy)
      else
        judgmentDefs := judgmentDefs.insert n (m.components.dropLast.getLast!)

    -- 6. @[contract] 契約定理 → テストケース演繹
    let isContract ← tagChecker `contract
    let idHeads : List Name := idTypes.toList.map (·.2.head)
    let contractNames := (env.constants.toList.filterMap fun (n, ci) =>
        if rootNs.isPrefixOf n && !n.hasMacroScopes && ci matches .thmInfo _
          && isContract n then some n else none)
      |>.toArray.qsort (fun a b => toString a < toString b)
    let mut contractJs : Array Json := #[]
    let mut nonUseCaseContracts : Nat := 0
    for thmName in contractNames do
      try
        let ci ← getConstInfo thmName
        let stmt := ci.type.instantiateLevelParams ci.levelParams
          (ci.levelParams.map fun _ => .zero)
        -- 事前選別の対象: 結論と、結論の適用に引数として現れない仮定。結論が消費する仮定
        -- (制約の証明 — 泉の新鮮性など)は主対象の義務で、選別に働かない(searchIn と同じ規則)
        let view ← forallTelescopeReducing stmt fun xs concl => do
          let mut parts : Array Expr := #[concl]
          for x in xs do
            let ty ← inferType x
            if (← Meta.isProp ty) && !concl.containsFVar x.fvarId! then parts := parts.push ty
          pure parts
        let viewHas (pred : Expr → Bool) : Bool := view.any fun e => (e.find? pred).isSome
        -- 事前選別: UseCase(execute / validate)に触れる定理は UseCase モード、
        -- ふるまい(Entity / VO / State の def)に触れる定理はふるまいモード、
        -- どちらでもなければ対象外(判断関数・Projection — 次段)
        let touchesExec := viewHas (fun e =>
          match e with
          | .const fn _ =>
            ["execute", "validate"].contains (toString (fn.updatePrefix Name.anonymous)) &&
              (match modOf fn with
               | some m => ucNs.isPrefixOf m && m.components.getLast! == `UseCase
               | none => false)
          | _ => false)
        let isBehaviorTarget (e : Expr) : Bool :=
          match e.getAppFn with
          | .const fn _ => behaviorDefs.contains fn
          | _ => false
        let isJudgmentTarget (e : Expr) : Bool :=
          match e.getAppFn with
          | .const fn _ => judgmentDefs.contains fn
          | _ => false
        let isProjectionTarget (e : Expr) : Bool :=
          match e.getAppFn with
          | .const fn _ => projDefs.contains fn
          | _ => false
        -- 優先順位: 射影 → 判断 → ふるまい(射影・判断の定理は仮定に
        -- valid 等のふるまいを含むため、ふるまい判定を後段に置く)
        let projectionMode := !touchesExec && viewHas isProjectionTarget
        let judgmentMode := !touchesExec && !projectionMode && viewHas isJudgmentTarget
        let behaviorMode := !touchesExec && !projectionMode && !judgmentMode &&
          viewHas isBehaviorTarget
        unless touchesExec || behaviorMode || judgmentMode || projectionMode do
          nonUseCaseContracts := nonUseCaseContracts + 1
          continue
        -- 先頭の型 binder は Runtime 規約、インスタンスは合成(extractServices と同じ)
        let mut core := stmt
        repeat
          let core' ← whnf core
          match core' with
          | .forallE nm dom body bi =>
            if bi == .instImplicit then
              core := body.instantiate1 (← synthInstance dom)
            else if dom.isSort then
              core := body.instantiate1 (← binderConst rootNs nm)
            else break
          | _ => break
        -- 残りの binder(値・仮定)を fvar でテレスコープ
        let cases ← forallTelescopeReducing core fun xs concl => do
          -- 主対象: UseCase モジュールの execute の適用(仮定 or 結論)
          let ucPred (nm : String) (e : Expr) : Bool :=
            match e.getAppFn with
            | .const fn _ =>
              (toString (fn.updatePrefix Name.anonymous)) == nm &&
                (match modOf fn with
                 | some m => (appNs ++ `UseCase).isPrefixOf m
                 | none => false)
            | _ => false
          let mut hypIdx : Array Nat := #[]
          let mut valIdx : Array Nat := #[]
          for i in [0:xs.size] do
            let t ← inferType xs[i]!
            if (← Meta.isProp t) then hypIdx := hypIdx.push i
            else valIdx := valIdx.push i
          -- 主対象の探索: 仮定 → 結論の順。UseCase モードは execute を validate より優先
          -- (execute_invalid の仮定に validate が現れるため)
          -- 結論の適用に引数として現れる仮定(制約の証明 — 泉の新鮮性など)は主対象の
          -- 選択器ではなく主対象の義務。その型の中は探さない
          let searchIn (pred : Expr → Bool) : Elab.TermElabM (Option Expr) := do
            for i in hypIdx do
              if concl.containsFVar xs[i]!.fvarId! then continue
              if let some app := (← inferType xs[i]!).find? pred then return some app
            pure (concl.find? pred)
          let primary? ←
            if behaviorMode then searchIn isBehaviorTarget
            else if judgmentMode then do
              -- 判断定理はケース選択器 — 観測は本番契約面(UseCase の execute)。
              -- 定理の binder(行の列・パラメータ・鍵)を execute の引数へ割り付け、
              -- ReadModel / クエリ DTO はフィールド単位で組んで execute の適用を合成する
              let some japp ← searchIn isJudgmentTarget
                | throwError "判断の適用が見つかりません"
              let .const jfn _ := japp.getAppFn | unreachable!
              let dir := (judgmentDefs.get? jfn).getD Name.anonymous
              let some execC := execByDir.get? dir
                | throwError "UseCase {dir} の execute が見つかりません"
              let valIdxF := valIdx
              let strCtrJ : IO.Ref Nat ← IO.mkRef 700
              -- binder の割り付け: 名前+型一致 → 型の一意一致 → なし
              let matchBinder : Name → Expr → Elab.TermElabM (Option Expr) := fun nm ty => do
                for j in valIdxF do
                  let d ← xs[j]!.fvarId!.getDecl
                  if d.userName == nm && (← isDefEq d.type ty) then return some xs[j]!
                let mut found : Option Expr := none
                let mut cnt := 0
                for j in valIdxF do
                  if ← isDefEq (← inferType xs[j]!) ty then
                    found := some xs[j]!
                    cnt := cnt + 1
                return if cnt == 1 then found else none
              let matchHyp : Expr → Elab.TermElabM (Option Expr) := fun ty => do
                for j in hypIdx do
                  if ← isDefEq (← inferType xs[j]!) ty then return some xs[j]!
                return none
              let fillLeaf : Name → Expr → Elab.TermElabM Expr := fun nm ty => do
                if let some x ← matchBinder nm ty then return x
                match ← buildValue idHeads strCtrJ ty 0 with
                | some v => return v
                | none => throwError "execute の引数 {nm} を合成できません: {ty}"
              let fillArg : Name → Expr → Elab.TermElabM Expr := fun nm ty => do
                if let some x ← matchBinder nm ty then return x
                let tyW ← whnf ty
                if let .const tn _ := tyW.getAppFn then
                  if (roles.get? tn == some .readModel || roles.get? tn == some .viewDto) &&
                      isStructure env tn then
                    let ctor := getStructureCtor env tn
                    let ctorCi ← getConstInfo ctor.name
                    let lvls := ctorCi.levelParams.map fun _ => Level.zero
                    let mut cty := ctorCi.type.instantiateLevelParams ctorCi.levelParams lvls
                    let mut cargs : Array Expr := #[]
                    -- 構造体の型パラメータは適用済みの型から写す
                    for a in tyW.getAppArgs do
                      let .forallE _ _ body _ ← whnf cty | break
                      cargs := cargs.push a
                      cty := body.instantiate1 a
                    repeat
                      match ← whnf cty with
                      | .forallE fnm fdom fbody bi =>
                        let v ← if bi == .instImplicit then synthInstance fdom
                          else if ← Meta.isProp fdom then
                            -- 制約: 定理が同じ命題を仮定に持てばそれを使い、無ければ decide の証明
                            match ← matchHyp fdom with
                            | some h => pure h
                            | none =>
                              match ← decideProp fdom with
                              | some true => mkDecideProof fdom
                              | _ => throwError "制約 {fnm} を満たす fixture を組めません"
                          else fillLeaf fnm fdom
                        cargs := cargs.push v
                        cty := fbody.instantiate1 v
                      | _ => break
                    return mkAppN (mkConst ctor.name lvls) cargs
                fillLeaf nm ty
              let execCi ← getConstInfo execC
              let eLvls := execCi.levelParams.map fun _ => Level.zero
              let mut ety := execCi.type.instantiateLevelParams execCi.levelParams eLvls
              let mut eArgs : Array Expr := #[]
              repeat
                match ← whnf ety with
                | .forallE nm dom body bi =>
                  let v ←
                    if bi == .instImplicit then synthInstance dom
                    else if dom.isSort then binderConst rootNs nm
                    else if ← Meta.isProp dom then
                      match ← decideProp dom with
                      | some true => mkDecideProof dom
                      | _ => throwError "execute の制約 {nm} を満たす引数を組めません"
                    else fillArg nm dom
                  eArgs := eArgs.push v
                  ety := body.instantiate1 v
                | _ => break
              pure (some (mkAppN (mkConst execC eLvls) eArgs))
            else if projectionMode then searchIn isProjectionTarget
            else do
              match ← searchIn (ucPred "execute") with
              | some a => pure (some a)
              | none => searchIn (ucPred "validate")
          let some primary := primary?
            | throwError "主対象(execute / validate / ふるまい)の適用が見つかりません"
          let .const execName _ := primary.getAppFn | unreachable!
          -- 主対象の明示引数: (名前, binder の fvar か / Id 導出か)
          let execArgs := primary.getAppArgs
          let (argNames, argKinds) ← forallTelescopeReducing
              ((← getConstInfo execName).type) fun ys _ => do
            let mut names : Array Name := #[]
            let mut kinds : Array String := #[]   -- "type" | "inst" | "value"
            let mut vi := 0
            for y in ys do
              let d ← y.fvarId!.getDecl
              let isConstraint ← Meta.isProp d.type
              let kind := if d.binderInfo == .instImplicit then "inst"
                else if d.type.isSort then "type"
                else if isConstraint then "prop" else "value"
              -- 無名 binder は interface 側と同じ規約(arg<値引数の序数>)で消毒
              let nm := if kind == "value" then
                  (if d.userName.hasMacroScopes then Name.mkSimple s!"arg{vi}" else d.userName)
                else d.userName
              if kind == "value" then vi := vi + 1
              names := names.push nm
              kinds := kinds.push kind
            pure (names, kinds)
          -- 束縛の役割分け: パターン束縛(仮定 Eq の右辺に裸で現れる)→ mvar、
          -- 主対象の引数に裸で現れ型が Id のみ → 泉導出、それ以外の値 → サンプル
          let mut patternBound : Array Nat := #[]
          for i in hypIdx do
            let t ← inferType xs[i]!
            if let some (_, _, rhs) := t.eq? then
              -- パターン(ctor 適用)の右辺だけが束縛する(fs.length 等の関数適用は対象外)
              let isCtorApp ← match rhs.getAppFn with
                | .const cn _ => pure ((env.find? cn) matches some (.ctorInfo _))
                | _ => pure false
              if isCtorApp then
                for j in valIdx do
                  if rhs.containsFVar xs[j]!.fvarId! then
                    unless patternBound.contains j do patternBound := patternBound.push j
          let mut derived : Array Nat := #[]
          for k in [0:execArgs.size] do
            if argKinds[k]! == "value" then
              let a := execArgs[k]!
              if a.isFVar then
                if let some j := xs.findIdx? (· == a) then
                  if (← isIdOnly idHeads (← inferType a)) then
                    unless patternBound.contains j do derived := derived.push j
          -- サンプルするのは主対象の適用に現れる binder だけ。
          -- それ以外(結論だけに現れる binder・∀ の b 等)は mvar
          let sampled := valIdx.filter fun j =>
            !patternBound.contains j && !derived.contains j &&
              primary.containsFVar xs[j]!.fvarId!
          -- 泉の形(shape): 主対象の引数のうち、Id のみでない List 型の値
          let mut shapeIdx : Option Nat := none
          for k in [0:execArgs.size] do
            if argKinds[k]! == "value" && execArgs[k]!.isFVar then
              let a := execArgs[k]!
              let ta ← whnf (← inferType a)
              if ta.getAppFn.isConstOf ``List && !(← isIdOnly idHeads ta) then
                shapeIdx := xs.findIdx? (· == a)
          -- サンプル候補(binder ごとのプール)
          let strCtr : IO.Ref Nat ← IO.mkRef 0
          let mut pools : Array (Nat × Array Expr) := #[]
          for j in sampled do
            let ty ← inferType xs[j]!
            let tyW ← whnf ty
            let variants : List Nat ←
              if tyW.getAppFn.isConstOf ``List then pure [0, 1, 2]
              else if tyW.getAppFn.isConstOf ``Option then pure [0, 1]
              else match tyW.getAppFn with
                | .const tn _ => do
                  match (← getEnv).find? tn with
                  | some (.inductInfo ii) =>
                    -- structure は通常+境界(リスト空)+別 ctor+混在 2 種+空文字列+
                    -- 境界×第 1 構成子の 7 variant(5 = 空文字列の境界 —「空でない」
                    -- 制約の失敗枝、6 = 空リスト+第 1 構成子 — noFolders×既存作者等)。
                    -- ポート束(関数フィールド — 構築が variant に依らない)は 1 つ
                    if (← hasFunctionField tn) then pure [0]
                    else if isStructure (← getEnv) tn then pure [0, 1, 2, 3, 4, 5, 6]
                    else pure (List.range ii.ctors.length)
                  | _ => pure [0]
                | _ => pure [0]
            let mut pool : Array Expr := #[]
            for v in variants do
              strCtr.set (j * 3 + v)   -- 文字列の一意性(組合せに依らず決定的)
              if v == 2 && tyW.getAppFn.isConstOf ``List then
                -- List の複合 variant: [通常, 境界] の 2 要素
                let some c ← buildValue idHeads strCtr tyW.getAppArgs[0]! 0 | continue
                let some b ← buildValue idHeads strCtr tyW.getAppArgs[0]! 1 | continue
                let el := tyW.getAppArgs[0]!
                let nil := mkApp (mkConst ``List.nil [.zero]) el
                pool := pool.push (mkApp3 (mkConst ``List.cons [.zero]) el c
                  (mkApp3 (mkConst ``List.cons [.zero]) el b nil))
              else
                if let some x ← buildValue idHeads strCtr ty v then pool := pool.push x
            if pool.isEmpty then throwError "サンプルを構築できない型: {ty}"
            pools := pools.push (j, pool)
          -- 組合せ列挙(積、上限つき)
          let mut combos : Array (Array (Nat × Expr)) := #[#[]]
          for (j, pool) in pools do
            let mut next : Array (Array (Nat × Expr)) := #[]
            for c in combos do
              for v in pool do
                next := next.push (c.push (j, v))
            combos := next
          combos := combos.extract 0 64
          let mut caseJs : Array Json := #[]
          let mut seenCase : Array String := #[]
          let mut whys : Array String := #[s!"組合せ {combos.size}"]
          for combo in combos do
            if caseJs.size ≥ 4 then break
            -- 2 パス: 泉値を出力の出現順の連番へ正規化
            let mut preset : List Nat := (List.range 20).map (100 + ·)
            let mut result : Option Json := none
            for _pass in [0:2] do
              let queue : IO.Ref (List Nat) ← IO.mkRef preset
              -- 代入の構築(サンプル → 泉導出 → パターンは mvar)
              let mut subst : Array (Option Expr) := xs.map fun _ => none
              for (j, v) in combo do subst := subst.set! j (some v)
              let shapeVal := shapeIdx.bind fun si => subst[si]!
              let mut ok := true
              for j in derived do
                match ← deriveWellIds idHeads queue (← inferType xs[j]!) shapeVal with
                | some v => subst := subst.set! j (some v)
                | none => ok := false
              unless ok do
                whys := whys.push "泉導出不可"
                break
              for j in valIdx do
                if subst[j]!.isNone then
                  let mv ← mkFreshExprMVar (some (← inferType xs[j]!))
                  subst := subst.set! j (some mv)
              -- 仮定(Prop)の binder は代入対象外 — 自分自身で埋める(置換の no-op。
              -- get! だと none で panic ログが出る — 挙動は同じでもノイズになる)
              let mut vals : Array Expr := #[]
              for idx in [0:subst.size] do
                vals := vals.push ((subst[idx]!).getD xs[idx]!)
              let inst (e : Expr) : Expr := e.replaceFVars xs vals
              -- 仮定の検査: Eq(mvar あり)は左辺評価+単一化、他は decide
              let mut keep := true
              let mut provenIdx : Array Nat := #[]
              for i in hypIdx do
                let h ← instantiateMVars (inst (← inferType xs[i]!))
                if h.hasExprMVar then
                  if let some (_, lhs, rhs) := h.eq? then
                    if !lhs.hasExprMVar then
                      unless (← withTransparency .all <| isDefEq lhs rhs) do
                        -- 否定形(結論 False)の定理では不一致が主張そのもの —
                        -- その入力での失敗ケースとして採用する
                        if concl.isConstOf ``False then pure ()
                        else
                          whys := whys.push "パターン不一致"
                          keep := false
                    else
                      whys := whys.push "左辺に未束縛の変数"
                      keep := false
                  else
                    -- 結論構造の残滓(∀ b ∈ notes 等)— 検査せず許容。
                    -- テストの主張はオラクル一致なので健全性は保たれる
                    pure ()
                else
                  match ← decideProp h with
                  | some true => provenIdx := provenIdx.push i
                  | some false =>
                    whys := whys.push "仮定が偽"
                    keep := false
                  | none =>
                    whys := whys.push s!"decide 不可: {h}"
                    keep := false
              unless keep do break
              -- 真と決まった仮定は証明項に置き換える — 主対象が制約の証明(泉の新鮮性など)を
              -- 引数に取るとき、評価する適用が閉じた項になる
              for i in provenIdx do
                vals := vals.set! i (← mkDecideProof (← instantiateMVars (inst (← inferType xs[i]!))))
              let inst (e : Expr) : Expr := e.replaceFVars xs vals
              -- オラクル評価と泉の正規化
              let pApp ← instantiateMVars (inst primary)
              let expected := pApp   -- 評価は解釈側の whnf(頭だけ)+コンパイル実行が担う
              -- 主対象の引数に裸で現れる Id 型の binder は泉から導出し、期待値に現れた泉値を出現順の連番に正規化する。
              -- 状態遷移契約は採番の種が before 状態(ids.next)に入るので derived が空になり素通りする
              let (appear, canonical) ←
                if derived.isEmpty then pure (([] : List Nat), ([] : List Nat)) else do
                  let expectedJ ← valueToJson expected
                  let allocated := preset.take 20
                  let ap := (scanWellNums allocated expectedJ #[]).toList
                  let unused := allocated.filter (!ap.contains ·)
                  pure (ap, ap ++ unused)
              if canonical == preset.take canonical.length || _pass == 1 then
               try
                -- 期待値の解釈(状態遷移契約):
                --   更新系: (before, after, error) — テストは fromState / toState で観測
                --   参照系: (readModel, ok / error) — rm は fixture、期待は View 列
                let headOf (t : Expr) : Name :=
                  match t.getAppFn with | .const n _ => n | _ => Name.anonymous
                -- 主対象の引数から before(State)/ readModel と payload 引数を仕分け
                let mut beforeJ : Option (Json × Name) := none   -- (値, State 型名)
                let mut rmJ : Option (Json × Name) := none
                let mut argJs : List (String × Json) := []
                for k in [0:execArgs.size] do
                  if argKinds[k]! == "value" then
                    let a := inst execArgs[k]!
                    let aty ← whnf (← inferType a)
                    let h := headOf aty
                    let pureMode := behaviorMode || projectionMode
                    if !pureMode && roles.get? h == some .repositoryState then
                      beforeJ := some (← valueToJson a, h)
                    else if !pureMode && roles.get? h == some .readModel then
                      rmJ := some (← valueToJson a, h)
                    else if aty.isForall || (← hasFunctionField h) then
                      pure ()   -- ポート(埋め込み・鍵)は配線 — 直列化しない
                    else
                      argJs := argJs ++ [(toString argNames[k]!, ← valueToJson a)]
                -- 期待値の形で純値形(ふるまい)/ 遷移形 / 値形を判定
                let expW ← whnf expected
                let expHead := headOf (← whnf (← inferType expW))
                let mut caseFields : List (String × Json) := [("args", Json.mkObj argJs)]
                if behaviorMode then
                  -- ふるまい: 期待値はオラクル値そのもの(観測の等式は全値一致に包含)
                  caseFields := caseFields ++ [("kind", Json.str "pure"),
                    ("ok", ← valueToJson expW)]
                else if projectionMode then
                  -- 射影: DDL テストのケース(スキーマ抽出が Lean の射影を再現するか)
                  caseFields := caseFields ++ [("kind", Json.str "projection"),
                    ("ok", ← valueToJson expW)]
                else if roles.get? expHead == some .repositoryState then
                  -- 全域の状態遷移(unlike)
                  let some (bj, st) := beforeJ | throwError "before 状態の引数が見つかりません"
                  caseFields := caseFields ++ [("kind", Json.str "transition"),
                    ("stateType", Json.str (toString st)), ("before", bj),
                    ("after", ← valueToJson expW), ("error", Json.null)]
                else if expW.getAppFn.isConstOf ``Except.ok ||
                    expW.getAppFn.isConstOf ``Except.error then
                  let payload := expW.getAppArgs[2]!
                  let isOk := expW.getAppFn.isConstOf ``Except.ok
                  let pty ← whnf (← inferType payload)
                  if isOk && roles.get? (headOf pty) == some .repositoryState then
                    -- Except E State(like / rename 系)の成功
                    let some (bj, st) := beforeJ | throwError "before 状態の引数が見つかりません"
                    caseFields := caseFields ++ [("kind", Json.str "transition"),
                      ("stateType", Json.str (toString st)), ("before", bj),
                      ("after", ← valueToJson payload), ("error", Json.null)]
                  else if !isOk && beforeJ.isSome then
                    -- Except の失敗: 状態は変わらない(after = before)
                    let some (bj, st) := beforeJ | unreachable!
                    caseFields := caseFields ++ [("kind", Json.str "transition"),
                      ("stateType", Json.str (toString st)), ("before", bj), ("after", bj),
                      ("error", ← valueToJson payload)]
                  else if isOk && beforeJ.isSome then
                    -- validate の成功 — 状態は一切変わらない。
                    -- validate は「解決の成果物」(作用対象の
                    -- 集約ルート)を返す — 成果物が Entity / 集約ルートなら ok に
                    -- 焼き込む(テストは返り値も観測で突き合わせる)。Unit のまま
                    -- の validate(save・参照系)は従来どおり ok なし
                    let some (bj, st) := beforeJ | unreachable!
                    let pRole := roles.get? (headOf pty)
                    let okExtra ←
                      if pRole == some .aggregateRoot || pRole == some .entity ||
                          pRole == some .viewDto then
                        pure [("ok", ← valueToJson payload)]
                      else pure []
                    caseFields := caseFields ++ [("kind", Json.str "transition"),
                      ("stateType", Json.str (toString st)), ("before", bj), ("after", bj),
                      ("error", Json.null)] ++ okExtra
                  else
                    -- 参照系(値形): ok = View 列 / error = QueryError
                    let some (rj, rmT) := rmJ | throwError "ReadModel 引数が見つかりません"
                    -- 判断モードの空振り防止: 合成した execute が validate の
                    -- 関門(認可等)で失敗する組合せは、定理の語る判断を一度も観測しない —
                    -- 定理名を冠した空テストを出さない(採用は成功する組合せだけ)
                    if judgmentMode && !isOk then
                      throwError "判断の関門(validate)で失敗する組合せ — 判断を観測しないため不採用"
                    let payloadJ ← valueToJson payload
                    caseFields := caseFields ++ [("kind", Json.str "value"),
                      ("readModelType", Json.str (toString rmT)), ("readModel", rj),
                      (if isOk then ("ok", payloadJ) else ("error", payloadJ))]
                else
                  -- Result 構造体(save): after / error フィールドを読む
                  let .const dcn _ := expW.getAppFn
                    | throwError "期待値が ctor 正規形ではありません"
                  let some (.ctorInfo dci) := env.find? dcn
                    | throwError "期待値が ctor ではありません"
                  let dArgs := expW.getAppArgs
                  let dFields := dArgs.extract dci.numParams dArgs.size
                  let fnames := getStructureFields env dci.induct
                  let some (bj, st) := beforeJ | throwError "before 状態の引数が見つかりません"
                  let mut afterJ : Json := Json.null
                  let mut errJ : Json := Json.null
                  for fi in [0:dFields.size] do
                    let fn := toString fnames[fi]!
                    if fn == "after" then afterJ ← valueToJson dFields[fi]!
                    else if fn == "error" then errJ ← valueToJson dFields[fi]!
                  caseFields := caseFields ++ [("kind", Json.str "transition"),
                    ("stateType", Json.str (toString st)), ("before", bj),
                    ("after", afterJ), ("error", errJ)]
                let caseJ := Json.mkObj caseFields
                let key := caseJ.compress
                unless seenCase.contains key do
                  seenCase := seenCase.push key
                  caseJs := caseJs.push caseJ
                result := some caseJ
                break
               catch ex =>
                whys := whys.push s!"解釈不可: {← ex.toMessageData.toString}"
                break
              else
                -- 2 パス目: 割当 i(旧値 100+i)へ「出現順の連番 or 未使用の退避値」を与える
                preset := (List.range 20).map fun i =>
                  match appear.idxOf? (100 + i) with
                  | some k => 100 + k
                  | none => 900 + i
            let _ := result
          let methodName := toString (execName.updatePrefix Name.anonymous)
          let groupKey :=
            if behaviorMode then toString ((behaviorDefs.get? execName).getD Name.anonymous)
            else if projectionMode then
              toString (((projDefs.get? execName).getD (Name.anonymous, Name.anonymous)).1)
            else toString (((modOf execName).getD Name.anonymous).components.dropLast.getLast!)
          let rowTy :=
            if projectionMode then
              toString (((projDefs.get? execName).getD (Name.anonymous, Name.anonymous)).2)
            else ""
          pure ((groupKey, methodName, rowTy, caseJs, whys) :
            String × String × String × Array Json × Array String)
        let (modLast, methodName, rowTy, caseJs, whys) := cases
        if caseJs.isEmpty then
          logInfo m!"lean2kotlin: 契約定理 {thmName}: 有効なケースを演繹できませんでした({whys.toList.eraseDups})"
        else
          let target := if behaviorMode then "behaviors"
            else if projectionMode then "projection"
            else "usecase"
          let extra := if projectionMode then [("rowType", Json.str rowTy)] else []
          contractJs := contractJs.push (Json.mkObj ([
            ("target", Json.str target),
            ("useCase", Json.str modLast),
            ("method", Json.str methodName)] ++ extra ++ [
            ("theorem", Json.str (toString (thmName.updatePrefix Name.anonymous))),
            ("doc", Json.str ((← findDocString? env thmName).getD "")),
            ("cases", Json.arr caseJs)]))
      catch e =>
        logInfo m!"lean2kotlin: 契約定理 {thmName} を翻訳できません: {← e.toMessageData.toString}"
    if nonUseCaseContracts > 0 then
      logInfo m!"lean2kotlin: UseCase execute 以外の契約定理 {nonUseCaseContracts} 本は本段の対象外(Entity / VO / State 単体テストの演繹は次段)"

    -- 7. @[faultContract] 障害契約 → 障害注入フックつき契約テストの期待値。
    -- 定義の値 = 環境の技術的障害(DB 例外など — モデル外の事象)でフェーズが
    -- 中断されたときに観測されるべき状態。サンプルは同じディレクトリの execute が
    -- **成功する**入力に限る — 中断すべきフェーズが実際に走る入力だけが
    -- 障害注入の対象になる(失敗枝は通常の契約定理群が固定する)
    let isFaultContract ← tagCheckerOpt `faultContract
    let faultNames := (env.constants.toList.filterMap fun (n, ci) =>
        if rootNs.isPrefixOf n && !n.hasMacroScopes && (ci matches .defnInfo _)
          && isFaultContract n then some n else none)
      |>.toArray.qsort (fun a b => toString a < toString b)
    let mut faultJs : Array Json := #[]
    for fName in faultNames do
      try
        let some fMod := modOf fName
          | throwError "在住モジュールを特定できません"
        unless ucNs.isPrefixOf fMod && fMod.components.getLast! == `UseCase do
          throwError "UseCase ディレクトリ在住ではありません: {fMod}"
        let dir := fMod.components.dropLast.getLast!
        let some execC := execByDir.get? dir
          | throwError "UseCase {dir} の execute が見つかりません"
        -- 値引数の (名前, 型) 列(サンプルのプール用)。型・インスタンス引数は規約で埋め、
        -- 制約(Prop)の引数は含めない
        let valueBinders (declName : Name) : Elab.TermElabM (Array (Name × Expr)) := do
          let ci ← getConstInfo declName
          let mut ty := ci.type
          let mut vals : Array (Name × Expr) := #[]
          repeat
            match ← whnf ty with
            | .forallE nm dom body bi =>
              if bi == .instImplicit then
                ty := body.instantiate1 (← synthInstance dom)
              else if dom.isSort then
                ty := body.instantiate1 (← binderConst rootNs nm)
              else
                unless ← Meta.isProp dom do vals := vals.push (nm, dom)
                ty := body.instantiate1 (mkConst ``Unit)   -- 非依存前提
            | _ => break
          return vals
        -- 適用を組む: 型・インスタンスは規約、制約(Prop)は decide の証明、値は pick(none なら組めない)。
        -- 返すのは適用と値引数の (名前, 型, 値) 列
        let applyWith (declName : Name) (pick : Name → Expr → Elab.TermElabM (Option Expr)) :
            Elab.TermElabM (Option (Expr × Array (Name × Expr × Expr))) := do
          let ci ← getConstInfo declName
          let mut app := mkConst declName
          let mut ty := ci.type
          let mut vals : Array (Name × Expr × Expr) := #[]
          repeat
            match ← whnf ty with
            | .forallE nm dom body bi =>
              let v? ←
                if bi == .instImplicit then pure (some (← synthInstance dom))
                else if dom.isSort then pure (some (← binderConst rootNs nm))
                else if ← Meta.isProp dom then
                  match ← decideProp dom with
                  | some true => pure (some (← mkDecideProof dom))
                  | _ => pure none
                else do
                  let v? ← pick nm dom
                  if let some v := v? then vals := vals.push (nm, dom, v)
                  pure v?
              let some v := v? | return none
              app := mkApp app v
              ty := body.instantiate1 v
            | _ => break
          return some (app, vals)
        let fVals ← valueBinders fName
        -- サンプルのプール(fault 定義の値引数から。ポート束は構築が variant 非依存)
        let strCtrF : IO.Ref Nat ← IO.mkRef 800
        let mut pools : Array (Name × Array (Nat × Expr)) := #[]
        for (nm, ty) in fVals do
          let tyW ← whnf ty
          let variants : List Nat ← match tyW.getAppFn with
            | .const tn _ =>
              if (← hasFunctionField tn) then pure [0]
              else if isStructure env tn then pure [0, 1, 2, 3, 4, 5, 6]
              else pure [0]
            | _ => pure [0]
          let mut pool : Array (Nat × Expr) := #[]
          for v in variants do
            if let some x ← buildValue idHeads strCtrF ty v then pool := pool.push (v, x)
          if pool.isEmpty then throwError "サンプルを構築できない型: {ty}"
          pools := pools.push (nm, pool)
        let mut combos : Array (Array (Name × Nat × Expr)) := #[#[]]
        for (nm, pool) in pools do
          let mut nextCs : Array (Array (Name × Nat × Expr)) := #[]
          for c in combos do
            for (v, x) in pool do
              nextCs := nextCs.push (c.push (nm, v, x))
          combos := nextCs
        combos := combos.extract 0 64
        -- 有効ケースの収集(execute 成功のみ)→ ペイロードの多様性で ≤4 に選抜
        let mut collected : Array (String × Json) := #[]
        for combo in combos do
          if collected.size ≥ 12 then break
          -- execute の引数: fault 定義と同名はサンプル共有、それ以外(時計・他の泉)は
          -- 組合せの最大 variant で構築(独立にサンプルされる日付の整合 — clock.today)
          let vmax := combo.foldl (fun a (_, v, _) => max a v) 0
          let some (eApp, eVals) ← applyWith execC (fun nm ty => do
              match combo.find? (·.1 == nm) with
              | some (_, _, x) => pure (some x)
              | none => buildValue idHeads strCtrF ty vmax)
            | continue
          -- execute が成功する入力だけを採用(Result の error フィールドが none)
          let eRes ← whnf eApp
          let .const rcn _ := eRes.getAppFn | continue
          let some (.ctorInfo rci) := env.find? rcn | continue
          let rFields := eRes.getAppArgs.extract rci.numParams eRes.getAppArgs.size
          let rNames := getStructureFields env rci.induct
          let mut isOk := false
          for fi in [0:rFields.size] do
            if toString rNames[fi]! == "error" then
              if (← whnf rFields[fi]!).getAppFn.isConstOf ``Option.none then isOk := true
          unless isOk do continue
          -- 期待値 = fault 定義の値(障害で中断されたときに観測される状態)
          let some (fApp, _) ← applyWith fName (fun nm _ =>
              pure ((combo.find? (·.1 == nm)).map (·.2.2)))
            | continue
          let afterJ ← valueToJson (← whnf fApp)
          -- args(ペイロード・時計)と before(状態)の仕分け(usecase モードと同じ)
          let mut beforeJ : Option (Json × Name) := none
          let mut argJs : List (String × Json) := []
          let mut cmdKey := ""
          for (nm, ty, a) in eVals do
            let tyW ← whnf ty
            let h := match tyW.getAppFn with | .const hn _ => hn | _ => Name.anonymous
            if roles.get? h == some .repositoryState then
              beforeJ := some (← valueToJson a, h)
            else if tyW.isForall || (← hasFunctionField h) then
              pure ()
            else
              let aj ← valueToJson a
              if roles.get? h == some .command then cmdKey := aj.compress
              argJs := argJs ++ [(toString nm, aj)]
          let some (bj, st) := beforeJ | throwError "before 状態の引数が見つかりません"
          let caseJ := Json.mkObj [("args", Json.mkObj argJs),
            ("stateType", Json.str (toString st)), ("before", bj), ("after", afterJ)]
          unless collected.any (·.2.compress == caseJ.compress) do
            collected := collected.push (cmdKey, caseJ)
        -- 選抜: ペイロードごとに 1 件を先に取り、残枠を先頭から埋める(≤4)
        let mut caseJs : Array Json := #[]
        let mut seenCmd : Array String := #[]
        for (ck, cj) in collected do
          if caseJs.size ≥ 4 then break
          unless seenCmd.contains ck do
            seenCmd := seenCmd.push ck
            caseJs := caseJs.push cj
        for (_, cj) in collected do
          if caseJs.size ≥ 4 then break
          unless caseJs.any (·.compress == cj.compress) do
            caseJs := caseJs.push cj
        if caseJs.isEmpty then
          logInfo m!"lean2kotlin: 障害契約 {fName}: 有効なケース(execute が成功する入力)を演繹できませんでした"
        else
          faultJs := faultJs.push (Json.mkObj [
            ("useCase", Json.str (toString dir)),
            ("def", Json.str (toString (fName.updatePrefix Name.anonymous))),
            ("doc", Json.str ((← findDocString? env fName).getD "")),
            ("cases", Json.arr caseJs)])
      catch e =>
        logInfo m!"lean2kotlin: 障害契約 {fName} を翻訳できません: {← e.toMessageData.toString}"

    -- 8. 形状の抽出と未分類検出
    let roleList := roles.toList.toArray.qsort (fun a b => toString a.1 < toString b.1)
    let mut typeEntries : Array Json := #[]
    let mut allRefs : Array (Name × Name) := #[]
    let mut kotlinNames : Std.HashMap Name String := {}
    for (n, _) in roleList do
      kotlinNames := kotlinNames.insert n (defaultKotlinName n)
    let mut idTypeHeads : Array Name := #[]
    for (_, m) in idTypes.toList do
      unless idTypeHeads.contains m.head do
        idTypeHeads := idTypeHeads.push m.head

    let monoMap ← reg.get
    for (n, role) in roleList do
      let targs ← do
        match monoMap.get? n with
        | some a => pure a
        | none => monoArgsByConv rootNs n
      let shape ← shapeOf rootNs reg n targs
      -- 制約(Prop フィールド): 生成器が fixture を制約どおりに引くための宣言
      let (constraints, unreadable) ← structConstraints rootNs n targs
      for u in unreadable do
        logInfo m!"lean2kotlin: {u} は読める制約の形(`(coll.map (·.f)).Nodup` / `(coll.filterMap (·.f)).Nodup` / `∀ x ∈ coll, x.f = c` / `(coll.filter p).length ≤ n`)ではないため、生成する fixture はこの制約を満たすとは限りません"
      let collectFromShape (j : Json) : Array Name :=
        match j.getObjVal? "fields" with
        | .ok (.arr fs) => fs.foldl (fun acc f =>
            match f.getObjVal? "type" with
            | .ok t => collectRefs t acc
            | _ => acc) #[]
        | _ =>
          match j.getObjVal? "ctors" with
          | .ok (.arr cs) => cs.foldl (fun acc c =>
              match c.getObjVal? "fields" with
              | .ok (.arr fs) => fs.foldl (fun acc f =>
                  match f.getObjVal? "type" with
                  | .ok t => collectRefs t acc
                  | _ => acc) acc
              | _ => acc) #[]
          | _ => #[]
      for r in collectFromShape shape do
        allRefs := allRefs.push (n, r)
      let some kname := kotlinNames.get? n |
        throwError "lean2kotlin: 内部エラー: {n} の Kotlin 名が未計算です"
      unless isKotlinIdent kname do
        throwError "lean2kotlin: {n} の Kotlin 名 {kname} が識別子として不正です"
      let mut entry := [("lean", Json.str (toString n)), ("kotlin", Json.str kname),
                        ("role", Json.str role.str), ("shape", shape)]
      unless constraints.isEmpty do
        entry := entry ++ [("constraints", Json.arr constraints)]
      -- 生成先パッケージの導出源: 型の在住モジュール(Lean のディレクトリ構成の写し)
      if let some m := modOf n then
        entry := entry ++ [("module", Json.str (toString m))]
      -- 宣言 docstring(生成 KDoc の素材 — 泉ポートの単調性の註記等)
      if let some doc ← findDocString? env n then
        entry := entry ++ [("doc", Json.str doc)]
      if let some idM := idTypes.get? n then
        let idJ ← typeToIR rootNs reg idM.expr
        entry := entry ++ [("id", idJ)]
      if idTypeHeads.contains n then
        entry := entry ++ [("isId", Json.bool true)]
        -- ワイヤ形式の観測: Id 型の直列化が canonical UUID 文字列なら
        -- Kotlin 表現は java.util.UUID(値ラッパの中身)に写す
        let wire? ← do
          if isStructure env n && (getStructureFields env n).size == 1 then
            try
              match env.find? n with
              | some (.inductInfo ii) => do
                let ci ← getConstInfo ii.ctors.head!
                let lvls := ci.levelParams.map fun _ => Level.zero
                let sample := mkAppN (mkConst ii.ctors.head! lvls) (targs ++ #[mkNatLit 1])
                match ← valueToJson sample with
                | .str s => pure (if isUuidString s then some "uuid" else none)
                | _ => pure (none : Option String)
              | _ => pure none
            catch _ => pure none
          else pure none
        if let some w := wire? then entry := entry ++ [("wire", Json.str w)]
      typeEntries := typeEntries.push (Json.mkObj entry)

    for (src, r) in allRefs do
      unless roles.contains r do
        throwError "lean2kotlin: {src} が参照する型 {r} に生成区分がありません(配置規約 or アノテーションを確認)"
    -- Kotlin 名は型とサービス(interface)で 1 つの名前空間を分け合う
    let mut seen : Std.HashMap String Name := {}
    for (nm, md) in serviceNames do
      seen := seen.insert nm md.toName
    for (n, _) in roleList do
      let k := kotlinNames.get? n |>.getD ""
      if let some prev := seen.get? k then
        throwError "lean2kotlin: Kotlin 名 {k} が衝突しています: {prev} と {n}"
      seen := seen.insert k n

    return Json.mkObj [
      ("version", (1 : Nat)),
      ("rootNamespace", toString rootNs),
      ("types", Json.arr typeEntries),
      ("queryServices", Json.arr queryJs),
      ("useCases", Json.arr useCaseJs),
      ("domainServices", Json.arr domainSvcJs),
      ("contracts", Json.arr contractJs),
      ("faultContracts", Json.arr faultJs),
      ("behaviors", Json.arr behaviorsJs)]
  if let some dir := System.FilePath.parent outPath then
    IO.FS.createDirAll dir
  IO.FS.writeFile outPath (ir.pretty ++ "\n")
  logInfo m!"lean2kotlin: IR を書き出しました: {outPath}"

end Lean2Kotlin.Extract
