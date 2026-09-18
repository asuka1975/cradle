/-
  ドメインモデル CLI — モックアップ・golden・仕様問い合わせの実行エンジン（Cradle 標準プロトコル）。

    stdin  : JSON 1 つ / stdout : JSON 1 つ（1 リクエスト 1 プロセス）

    {"cmd":"init","scenario":"basic","viewer":…,"actor":…,"today":"2026-01-01"}
      → {"ok":{"state":…,"views":…}}
    {"cmd":"step","state":…,"command":…,"actor":…,"viewer":…,"today":…}
      → {"ok":{"state":…,"views":…}} | {"domainError":…}
    {"cmd":"views","state":…,"viewer":…,"today":…}
      → {"ok":{"state":…,"views":…}}   （状態は変えず、別の viewer・別の日で射影し直すだけ）
    {"cmd":"flow","scenario":"basic","commands":[…],"actor":…,"viewer":…,"today":…}
      → {"ok":{"trace":[{"actor":…,"command":…,"state":…,"views":…} | {"actor":…,"command":…,"domainError":…}, …]}}
    {"cmd":"dump", …}  → {"ok":{"initial":{…},"trace":[…]}}   （init と flow を 1 応答に）

  外部能力と内部入力を扱う経路は cmd "external"（version 1。旧実行器は未知の cmd として拒否する）:
    {"cmd":"external","version":1,"action":"init","scenario":…,"environment":"名前" | "env":{"script":[…],"cursor":0},…}
      → {"ok":{"state":…,"views":…,"env":…}}
    {"cmd":"external","version":1,"action":"step","state":…,"env":…,"input":{"command":…,"actor":…} | {"observation":…},"actor":…?,…}
      → {"ok":{"result":"applied"|"refused"|"fault","state":…,"views":…,"env":…,"interactions":[…],
                "domainError":…?,"faultContract":{"name":…,"portCalls":n}?}} | {"harnessError":{"step":null,"message":…}}
    trace の各要素は入力の写し（actor / command か observation / 指名した fault の名前）に同じ欄が続く。
    {"cmd":"external","version":1,"action":"flow"|"dump","scenario":…,"inputs":[…],"stopAt":n?,…}
      → {"ok":{"trace":[…],"env":…}}（dump は "initial" も）| {"harnessError":{"step":i|null,"message":…}}
    ハーネスの失敗は常にトップレベルの 1 形（trace の要素にはならず、そこまでの trace も返さない）。step は失敗した入力の番号（1 始まり）で、
    step action と完了時の検査（全消費 / stopAt）では null。
  環境（script と cursor）は状態と同じく応答で返し、次の step が受け取る。script の不一致・不足はハーネスの失敗で、
  業務の拒否（domainError）にも外部の観測にも化けない。不明な欄・版違い・不正な組合せはプロトコルエラー。

  golden の 2 ファイルは応答そのもの: `<name>-init.json` ← init の応答 / `<name>-flow.json` ← flow の応答。
  `commands` の各要素は `{"actor":…,"command":…}` の組か、コマンドそのもの（名義はリクエストの既定）。
  `viewer` は誰として見ているか（無ければどの画面もそこに無い）、`actor` は誰として操作しているか
  （step に必須）、`today` は境界の時計（省略時はシナリオの基準日）。
  外から受け取った state は `Snapshot.check` で検証してから使う。
-/
import Sprout

open Lean (Json ToJson FromJson toJson fromJson?)
open Sprout Sprout.Runtime

structure Request where
  cmd      : String
  scenario : Option String       := none
  state    : Option Json         := none
  command  : Option Json         := none
  commands : Option (List Json)  := none
  viewer   : Option Json         := none
  actor    : Option Json         := none
  today    : Option Json         := none
deriving FromJson

def respond (j : Json) : IO Unit := IO.println j.compress

def viewerOf (req : Request) : Option UserId :=
  req.viewer.bind (fun j => (fromJson? (α := UserId) j).toOption)

def actorOf (req : Request) : Option Actor :=
  req.actor.bind (fun j => (fromJson? (α := Actor) j).toOption)

/-- 境界の時計。省略時はシナリオの基準日。**形が悪い日付は黙って既定にせず、プロトコルエラーにする**。 -/
def todayOf (req : Request) : Except String Date :=
  match req.today with
  | none   => .ok Scenario.today
  | some j => fromJson? (α := Date) j

def opened (actor? : Option Actor) (s : Snapshot) : Snapshot :=
  match actor? with
  | some a => s.opened a
  | none   => s

def okResponse (today : Date) (s : Snapshot) (viewer : Option UserId) : Json :=
  Json.mkObj [("ok", Json.mkObj [("state", toJson s), ("views", toJson (views today s viewer))])]

def domainErrorResponse (e : DomainError) : Json := Json.mkObj [("domainError", toJson e)]
def protocolError (msg : String) : Json := Json.mkObj [("error", Json.str msg)]

def splitStep (fallback : Option Actor) (j : Json) : Option Actor × Json :=
  match (j.getObjVal? "command").toOption with
  | some cj =>
    let a := ((j.getObjVal? "actor").toOption).bind (fun aj => (fromJson? (α := Actor) aj).toOption)
    (match a with | some x => some x | none => fallback, cj)
  | none    => (fallback, j)

/-- 旧経路の 1 手: 環境を持たないので、外部を要する手（script の不足）はプロトコルエラーになる。
    Port を使わない手は external と同じ結果。 -/
def legacyApply (today : Date) (actor : Actor) (c : Command) (s : Snapshot) (h : s.check = true) :
    Except String (Except DomainError Snapshot) :=
  match Snapshot.applyExternal today (.command actor c none) s Environment.empty h with
  | .applied s' _ _ => .ok (.ok s')
  | .refused e _ _ => .ok (.error e)
  | .fault _ _ _ _ _ => .error "fault result without a nomination"
  | .harness msg => .error s!"this command needs cmd external with an environment: {msg}"

def traceStep (today : Date) (viewer : Option UserId) (fallback : Option Actor)
    (acc : Snapshot × List Json) (j : Json) : Snapshot × List Json :=
  let (s, out) := acc
  let (actor?, cj) := splitStep fallback j
  match actor? with
  | none => (s, out ++ [Json.mkObj [("command", cj), ("error", Json.str "missing actor")]])
  | some actor =>
    match fromJson? (α := Command) cj with
    | .error e => (s, out ++ [Json.mkObj [("command", cj), ("error", Json.str s!"bad command: {e}")]])
    | .ok c =>
      if h : s.check = true then
        match legacyApply today actor c s h with
        | .ok (.ok s')   => (s', out ++ [Json.mkObj [("actor", toJson actor), ("command", cj),
                        ("state", toJson s'), ("views", toJson (views today s' viewer))]])
        | .ok (.error e) => (s, out ++ [Json.mkObj [("actor", toJson actor), ("command", cj),
                        ("domainError", toJson e)]])
        | .error m => (s, out ++ [Json.mkObj [("actor", toJson actor), ("command", cj), ("error", Json.str m)]])
      else (s, out ++ [Json.mkObj [("command", cj), ("error", Json.str "state failed Snapshot.check")]])

/-! ### external — 外部能力と内部入力を扱う経路（version 1）。既存 5 cmd の読取（Request）は変えない -/

/-- external のリクエスト。許可された欄だけを読む（不明な欄・版違い・不明な action はプロトコルエラー）。 -/
structure External where
  action      : String
  scenario    : Option String
  environment : Option String
  env         : Option Json
  state       : Option Json
  input       : Option Json
  inputs      : Option (Array Json)
  viewer      : Option Json
  actor       : Option Json
  today       : Option Json
  stopAt      : Option Nat

def readExternal (raw : String) : Except String External := do
  let j ← Json.parse raw
  let keys := (← j.getObj?).keys
  let version ← (← j.getObjVal? "version").getNat?
  unless version == 1 do throw s!"unsupported external version: {version} (supported: 1)"
  let action ← (← j.getObjVal? "action").getStr?
  let specific : List String ← match action with
    | "init" => pure ["scenario", "environment", "env", "actor"]
    | "step" => pure ["state", "env", "input", "actor"]
    | "views" => pure ["state", "actor"]
    | "flow" | "dump" => pure ["scenario", "environment", "env", "inputs", "actor", "stopAt"]
    | other => throw s!"unknown external action: {other}"
  let allowed := ["cmd", "version", "action", "viewer", "today"] ++ specific
  for k in keys do
    unless allowed.contains k do throw s!"unknown field for external {action}: {k}"
  let opt (k : String) : Option Json := (j.getObjVal? k).toOption
  let optStr (k : String) : Except String (Option String) :=
    match opt k with | some v => v.getStr?.map some | none => pure none
  let optNat (k : String) : Except String (Option Nat) :=
    match opt k with | some v => v.getNat?.map some | none => pure none
  let optArr (k : String) : Except String (Option (Array Json)) :=
    match opt k with | some v => v.getArr?.map some | none => pure none
  if (opt "environment").isSome && (opt "env").isSome then
    throw "give either environment (a named script) or env (the script itself), not both"
  pure { action, scenario := ← optStr "scenario", environment := ← optStr "environment", env := opt "env",
         state := opt "state", input := opt "input", inputs := ← optArr "inputs",
         viewer := opt "viewer", actor := opt "actor", today := opt "today", stopAt := ← optNat "stopAt" }

/-- 環境の決定: 名前付きの環境か、script の実物か、無ければ空。外から受けた環境は `Environment.check` を通す。 -/
def environmentOf (x : External) : Except String Environment :=
  match x.environment, x.env with
  | some name, _ =>
    match environmentByName name with
    | some e => .ok e
    | none => .error s!"unknown environment: {name}"
  | none, some ej => do
    let e ← fromJson? (α := Environment) ej
    if e.check then pure e else throw "env failed Environment.check (cursor beyond the script)"
  | none, none => .ok Environment.empty

/-- 入力 1 件の読取: 利用者の操作（actor は要素かリクエストの既定）か内部入力（actor は無い）。fault は障害契約の指名。 -/
def readInput (fallback : Option Actor) (j : Json) : Except String Input := do
  for k in (← j.getObj?).keys do
    unless ["command", "actor", "observation", "fault"].contains k do throw s!"unknown field in input: {k}"
  let fault ← match (j.getObjVal? "fault").toOption with
    | some f => f.getStr?.map some
    | none => pure none
  match (j.getObjVal? "command").toOption, (j.getObjVal? "observation").toOption with
  | some cj, none =>
    -- 名義の有無はコマンドの decode より先に見る（モデルに依らない拒否）
    let actor ← match (j.getObjVal? "actor").toOption, fallback with
      | some aj, _ => fromJson? (α := Actor) aj
      | none, some a => pure a
      | none, none => throw "command input requires actor"
    pure (.command actor (← fromJson? (α := Command) cj) fault)
  | none, some oj =>
    if (j.getObjVal? "actor").toOption.isSome then throw "observation input must not carry actor (internal inputs have no user)"
    pure (.observation (← fromJson? (α := Observation) oj) fault)
  | some _, some _ => throw "input must be either command or observation, not both"
  | none, none => throw "input requires command or observation"

/-! ### プロトコルエラーの固定 — モデルに依らない形。exe の build で走る -/

private def rejects (raw : String) : Bool :=
  match readExternal raw with | .error _ => true | .ok _ => false
private def rejectsInput (fallback : Option Actor) (raw : String) : Bool :=
  match Json.parse raw >>= readInput fallback with | .error _ => true | .ok _ => false

#guard !rejects "{\"cmd\":\"external\",\"version\":1,\"action\":\"init\",\"scenario\":\"basic\"}"
-- 版違い
#guard rejects "{\"cmd\":\"external\",\"version\":2,\"action\":\"init\",\"scenario\":\"basic\"}"
-- 不明な action
#guard rejects "{\"cmd\":\"external\",\"version\":1,\"action\":\"nope\"}"
-- action に許されない欄（step に scenario）
#guard rejects "{\"cmd\":\"external\",\"version\":1,\"action\":\"step\",\"scenario\":\"basic\",\"state\":{},\"env\":{},\"input\":{}}"
-- environment と env の両方
#guard rejects "{\"cmd\":\"external\",\"version\":1,\"action\":\"init\",\"scenario\":\"basic\",\"environment\":\"x\",\"env\":{}}"
-- views に env
#guard rejects "{\"cmd\":\"external\",\"version\":1,\"action\":\"views\",\"state\":{},\"env\":{}}"
-- 名義の無いコマンド（要素にもリクエストの既定にも無い）
#guard rejectsInput none "{\"command\":{}}"
-- 内部入力に名義
#guard rejectsInput none "{\"observation\":{},\"actor\":{\"user\":{\"id\":1}}}"
-- command と observation の両方 / どちらも無い / 知らない欄
#guard rejectsInput none "{\"command\":{},\"observation\":{}}"
#guard rejectsInput none "{}"
#guard rejectsInput none "{\"command\":{},\"actor\":{\"user\":{\"id\":1}},\"extra\":1}"

/-- trace に残す入力の写し（誰が・何を・指名した障害）。 -/
def echoOf (i : Input) : List (String × Json) :=
  match i with
  | .command a c f => [("actor", toJson a), ("command", toJson c)] ++ (f.map fun n => [("fault", Json.str n)]).getD []
  | .observation o f => [("observation", toJson o)] ++ (f.map fun n => [("fault", Json.str n)]).getD []

/-- 1 手の結果の写し（`ok` の中身）。refused は作用前の状態（不変）を返す。ハーネスの失敗は別扱い。 -/
def resultJson (today : Date) (viewer : Option UserId) (before : Snapshot) (echo : List (String × Json))
    (r : StepResult) : Except String (Snapshot × Environment × Json) :=
  let body (result : String) (s : Snapshot) (env : Environment) (used : List Interaction) (extra : List (String × Json)) :=
    Json.mkObj (echo ++ [("result", Json.str result)] ++ extra ++
      [("state", toJson s), ("views", toJson (views today s viewer)), ("env", toJson env), ("interactions", toJson used)])
  match r with
  | .applied s env used => .ok (s, env, body "applied" s env used [])
  | .refused e env used => .ok (before, env, body "refused" before env used [("domainError", toJson e)])
  | .fault s env used contract calls =>
    .ok (s, env, body "fault" s env used [("faultContract", Json.mkObj [("name", Json.str contract), ("portCalls", toJson calls)])])
  | .harness msg => .error msg

/-- ハーネスの失敗は 1 つの形: step は flow / dump で失敗した入力の番号（1 始まり）、step action と完了時の検査では null。 -/
def harnessError (step : Option Nat) (msg : String) : Json :=
  Json.mkObj [("harnessError", Json.mkObj [("step", toJson step), ("message", Json.str msg)])]

/-- 入力列を順に流す — `Runtime.flow`（連続する step の定義）の写し。入力の不正はプロトコルエラー、
    script の不一致・不足などハーネスの失敗は最初の手で止まり、どの手で起きたかを添える。 -/
def runInputs (today : Date) (viewer : Option UserId) (fallback : Option Actor) (s0 : Snapshot) (env0 : Environment)
    (inputs : Array Json) : Except Json (Snapshot × Environment × Array Json) := do
  let mut decoded : Array Input := #[]
  for ij in inputs do
    match readInput fallback ij with
    | .ok x => decoded := decoded.push x
    | .error e => throw (protocolError s!"bad input #{decoded.size + 1}: {e}")
  if h : s0.check = true then
    let (t, sf, ef) := flow today decoded.toList s0 env0 h
    let mut trace : Array Json := #[]
    for (input, before, r) in t do
      match resultJson today viewer before (echoOf input) r with
      | .ok (_, _, j) => trace := trace.push j
      | .error msg => throw (harnessError (some (trace.size + 1)) msg)
    pure (sf, ef, trace)
  else throw (protocolError "state failed Snapshot.check")

/-- 完了した flow は全消費を検査する。途中で止めるケースは stopAt に終了 cursor を明示する。 -/
def consumedCheck (env : Environment) (stopAt : Option Nat) : Option Json :=
  match stopAt with
  | some n => if env.cursor == n then none else some (harnessError none s!"the environment stopped at cursor {env.cursor}, expected stopAt {n}")
  | none => if env.exhausted then none else some (harnessError none s!"the environment was not fully consumed: cursor {env.cursor} of {env.script.length}")

def runExternal (x : External) : IO Json := do
  -- 欄の値が decode できなければプロトコルエラー（null は無いのと同じ）
  let viewer ← match x.viewer with
    | none | some .null => pure none
    | some j => match fromJson? (α := UserId) j with
      | .ok v => pure (some v)
      | .error e => return protocolError s!"bad viewer: {e}"
  let actor? ← match x.actor with
    | none | some .null => pure none
    | some j => match fromJson? (α := Actor) j with
      | .ok a => pure (some a)
      | .error e => return protocolError s!"bad actor: {e}"
  let today ← match x.today with
    | none => pure Scenario.today
    | some j => match fromJson? (α := Date) j with
      | .ok d => pure d
      | .error e => return protocolError s!"bad today: {e}"
  let stateOf : Except String Snapshot := do
    let some sj := x.state | throw s!"external {x.action} requires state"
    let s ← fromJson? (α := Snapshot) sj
    if s.check then pure s else throw "state failed Snapshot.check"
  let scenarioOf : Except String Snapshot :=
    match x.scenario.bind scenarioByName with
    | some s => .ok (opened actor? s)
    | none => .error "unknown scenario"
  match x.action with
  | "init" =>
    match scenarioOf, environmentOf x with
    | .ok s, .ok env => return Json.mkObj [("ok", Json.mkObj [("state", toJson s), ("views", toJson (views today s viewer)), ("env", toJson env)])]
    | .error e, _ | _, .error e => return protocolError e
  | "views" =>
    match stateOf with
    | .ok s => return okResponse today (opened actor? s) viewer
    | .error e => return protocolError e
  | "step" =>
    match stateOf, environmentOf x, x.input with
    | .ok s, .ok env, some ij =>
      if x.env.isNone then return protocolError "external step requires env"
      match readInput actor? ij with
      | .error e => return protocolError s!"bad input: {e}"
      | .ok input =>
        if h : s.check = true then
          match resultJson today viewer s [] (Snapshot.applyExternal today input s env h) with
          | .ok (_, _, j) => return Json.mkObj [("ok", j)]
          | .error msg => return harnessError none msg
        else return protocolError "state failed Snapshot.check"
    | .error e, _, _ | _, .error e, _ => return protocolError e
    | _, _, none => return protocolError "external step requires input"
  | "flow" | "dump" =>
    match scenarioOf, environmentOf x with
    | .ok s0, .ok env0 =>
      match runInputs today viewer actor? s0 env0 (x.inputs.getD #[]) with
      | .error j => return j
      | .ok (_, env, trace) =>
        if let some e := consumedCheck env x.stopAt then return e
        let base := [("trace", Json.arr trace), ("env", toJson env)]
        if x.action == "dump" then
          return Json.mkObj [("ok", Json.mkObj ([("initial", Json.mkObj [("state", toJson s0), ("views", toJson (views today s0 viewer)), ("env", toJson env0)])] ++ base))]
        else return Json.mkObj [("ok", Json.mkObj base)]
    | .error e, _ | _, .error e => return protocolError e
  | other => return protocolError s!"unknown external action: {other}"

def main : IO Unit := do
  let input ← (← IO.getStdin).readToEnd
  match Json.parse input >>= fromJson? (α := Request) with
  | .error e => respond <| protocolError s!"bad request: {e}"
  | .ok req =>
    let viewer := viewerOf req
    let actor? := actorOf req
    match todayOf req with
    | .error e => respond <| protocolError s!"bad today: {e}"
    | .ok today =>
    match req.cmd with
    | "init" =>
      match req.scenario.bind scenarioByName with
      | some s => respond (okResponse today (opened actor? s) viewer)
      | none   => respond <| protocolError "unknown scenario"
    | "step" =>
      match req.state, req.command with
      | some sj, some cj =>
        match fromJson? (α := Snapshot) sj, fromJson? (α := Command) cj with
        | .ok s, .ok c =>
          if h : s.check = true then
            match actor? with
            | none => respond <| protocolError "step requires actor"
            | some actor =>
              match legacyApply today actor c s h with
              | .ok (.ok s')   => respond (okResponse today s' viewer)
              | .ok (.error e) => respond (domainErrorResponse e)
              | .error m => respond <| protocolError m
          else respond <| protocolError "state failed Snapshot.check"
        | .error e, _ => respond <| protocolError s!"bad state: {e}"
        | _, .error e => respond <| protocolError s!"bad command: {e}"
      | _, _ => respond <| protocolError "step requires state and command"
    | "views" =>
      match req.state with
      | none    => respond <| protocolError "views requires state"
      | some sj =>
        match fromJson? (α := Snapshot) sj with
        | .error e => respond <| protocolError s!"bad state: {e}"
        | .ok s    =>
          if !s.check then respond <| protocolError "state failed Snapshot.check"
          else respond (okResponse today (opened actor? s) viewer)
    | "flow" =>
      match req.scenario.bind scenarioByName with
      | none    => respond <| protocolError "unknown scenario"
      | some s0 =>
        let (_, trace) := (req.commands.getD []).foldl (traceStep today viewer actor?) (s0, [])
        respond <| Json.mkObj [("ok", Json.mkObj [("trace", Json.arr trace.toArray)])]
    | "dump" =>
      match req.scenario.bind scenarioByName with
      | none    => respond <| protocolError "unknown scenario"
      | some s0 =>
        let (_, trace) := (req.commands.getD []).foldl (traceStep today viewer actor?) (s0, [])
        respond <| Json.mkObj [("ok", Json.mkObj [
          ("initial", Json.mkObj [("state", toJson (opened actor? s0)),
            ("views", toJson (views today (opened actor? s0) viewer))]),
          ("trace", Json.arr trace.toArray)])]
    | "external" =>
      match readExternal input with
      | .error e => respond <| protocolError s!"bad external request: {e}"
      | .ok x => respond (← runExternal x)
    | other => respond <| protocolError s!"unknown cmd: {other}"
