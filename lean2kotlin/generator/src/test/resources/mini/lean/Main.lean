/-
  golden の採取用 CLI — Cradle 標準プロトコルの `init` だけを答える（応答の形は標準と同じ）。

    stdin  : {"cmd":"init","scenario":"basic"}
    stdout : {"ok":{"state":…,"views":…}}

  `init` 以外・知らないシナリオは `{"error":…}`。
-/
import Mini

open Lean (Json toJson)
open Mini Mini.Runtime

def respond (j : Json) : IO Unit := IO.println j.compress

def main : IO Unit := do
  let input ← (← IO.getStdin).readToEnd
  match Json.parse input with
  | .error e => respond (Json.mkObj [("error", Json.str s!"bad request: {e}")])
  | .ok req =>
    match req.getObjValAs? String "cmd", req.getObjValAs? String "scenario" with
    | .ok "init", .ok name =>
      match scenarioByName name with
      | some s => respond (Json.mkObj [("ok", Json.mkObj [("state", toJson s), ("views", toJson (views s))])])
      | none   => respond (Json.mkObj [("error", Json.str s!"unknown scenario: {name}")])
    | _, _ => respond (Json.mkObj [("error", Json.str "init だけを答える（cmd と scenario が要る）")])
