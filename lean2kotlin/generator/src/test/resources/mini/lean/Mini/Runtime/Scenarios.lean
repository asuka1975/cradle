/-
  名前付き初期状態（golden の採取に使う）。
-/
import Mini.Runtime.Machine

namespace Mini.Runtime

open Mini Mini.Domain Mini.Application

/-- 棚の本 3 冊: 棚に並ぶ本・箱に入った貸出中の本・傷んだ本。 -/
def basicBooks : List (Book BookId) :=
  [ { id := ⟨1⟩, edition := { title := ⟨"羅生門"⟩, number := 1 }, place := .shelf,
      condition := .good, lentOn := none },
    { id := ⟨2⟩, edition := { title := ⟨"こころ"⟩, number := 3 }, place := .box ⟨"文庫"⟩,
      condition := .worn, lentOn := some (Std.Time.PlainDate.ofYearMonthDayClip 2026 1 5) },
    { id := ⟨3⟩, edition := { title := ⟨"三四郎"⟩, number := 2 }, place := .shelf,
      condition := .damaged, lentOn := none } ]

def basic : Snapshot := ⟨⟨basicBooks, by decide⟩⟩

def scenarioByName (name : String) : Option Snapshot :=
  match name with
  | "basic" => some basic
  | _       => none

end Mini.Runtime
