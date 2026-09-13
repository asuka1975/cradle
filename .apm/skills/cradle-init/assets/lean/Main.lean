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
        match Snapshot.apply today actor c s h with
        | .ok s'   => (s', out ++ [Json.mkObj [("actor", toJson actor), ("command", cj),
                        ("state", toJson s'), ("views", toJson (views today s' viewer))]])
        | .error e => (s, out ++ [Json.mkObj [("actor", toJson actor), ("command", cj),
                        ("domainError", toJson e)]])
      else (s, out ++ [Json.mkObj [("command", cj), ("error", Json.str "state failed Snapshot.check")]])

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
              match Snapshot.apply today actor c s h with
              | .ok s'   => respond (okResponse today s' viewer)
              | .error e => respond (domainErrorResponse e)
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
    | other => respond <| protocolError s!"unknown cmd: {other}"
