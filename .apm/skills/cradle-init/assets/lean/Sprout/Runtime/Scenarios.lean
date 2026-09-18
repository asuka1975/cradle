/-
  Cradle の骨格のサンプルドメイン（メモ）。実ドメインではない — 形式化の最初のセッションで丸ごと置き換える。
  名前付きの初期状態と、流れを一巡させる #guard 表明（モックアップ・golden の源）。
  期待値のずれは lake build の失敗として検知される。どの手にも名義（Actor）が要る。
-/
import Sprout.Runtime.Views
import Sprout.Runtime.Reachable
import Sprout.Runtime.Json

namespace Sprout.Runtime

open Sprout Sprout.Domain Sprout.Application
open Lean (toJson fromJson?)

def alice : UserId := ⟨1⟩
def bob   : UserId := ⟨2⟩

/-- シナリオの基準日（非規範 — 時計は境界の持ち物）。 -/
def Scenario.today : Date := date("2026-01-01")

/-- 基本シナリオ: alice の開いたメモ 1 件・bob の閉じたメモ 1 件。 -/
def Scenario.basic : Snapshot :=
  { notes   := ⟨[ Note.post ⟨0⟩ alice ⟨"買い出し"⟩,
                  (Note.post ⟨1⟩ bob ⟨"打合せ"⟩).close ], by decide, by decide⟩
    noteIds := ⟨2⟩ }

def scenarioByName : String → Option Snapshot
  | "basic" => some Scenario.basic
  | _       => none

/-- 名前付きの環境（外部能力の script）。Port を持たない間は無い。 -/
def environmentByName : String → Option Environment
  | _ => none

-- 初期状態は検査を通る
#guard Scenario.basic.check

-- 一覧には開いているメモだけが、書かれた順に出る
#guard (views Scenario.today Scenario.basic (some alice)).notes =
  some [{ id := ⟨0⟩, author := alice, title := "買い出し", closed := false }]

-- 名無しには何も無い
#guard (views Scenario.today Scenario.basic none).notes = none

-- 本人だけが閉じられる
#guard match Snapshot.apply Scenario.today ⟨⟨bob⟩⟩ (.closeNote ⟨⟨0⟩⟩) Scenario.basic (by decide) with
  | .error .notAuthor => true
  | _ => false
#guard match Snapshot.apply Scenario.today ⟨⟨alice⟩⟩ (.closeNote ⟨⟨0⟩⟩) Scenario.basic (by decide) with
  | .ok s => (views Scenario.today s (some alice)).notes == some []
  | .error _ => false

-- external の経路は同じ手で同じ結果になり、Port を使わない手は環境を消費しない
#guard match Snapshot.applyExternal Scenario.today (.command ⟨⟨alice⟩⟩ (.closeNote ⟨⟨0⟩⟩) none) Scenario.basic Environment.empty (by decide) with
  | .applied s env [] => (views Scenario.today s (some alice)).notes == some [] && env == Environment.empty
  | _ => false
#guard match Snapshot.applyExternal Scenario.today (.command ⟨⟨bob⟩⟩ (.closeNote ⟨⟨0⟩⟩) none) Scenario.basic Environment.empty (by decide) with
  | .refused .notAuthor env [] => env == Environment.empty
  | _ => false


-- 骨格に障害契約は無いので、指名はハーネスの失敗
#guard match Snapshot.applyExternal Scenario.today (.command ⟨⟨alice⟩⟩ (.closeNote ⟨⟨0⟩⟩) (some "nope")) Scenario.basic Environment.empty (by decide) with
  | .harness _ => true
  | _ => false

-- flow は連続する step: 本人が閉じ、もう一度閉じると断られる（環境は空のまま）
#guard match flow Scenario.today [.command ⟨⟨alice⟩⟩ (.closeNote ⟨⟨0⟩⟩) none, .command ⟨⟨alice⟩⟩ (.closeNote ⟨⟨0⟩⟩) none]
    Scenario.basic Environment.empty (by decide) with
  | ([(_, _, .applied _ _ []), (_, _, .refused .alreadyClosed _ [])], s, env) =>
    env == Environment.empty && (views Scenario.today s (some alice)).notes == some []
  | _ => false


-- JSON の往復: 初期状態と空の環境は同じ値に戻る
#guard match (fromJson? (toJson Scenario.basic) : Except String Snapshot) with
  | .ok s => s == Scenario.basic
  | .error _ => false
#guard match (fromJson? (toJson Environment.empty) : Except String Environment) with
  | .ok e => e == Environment.empty
  | .error _ => false

end Sprout.Runtime
