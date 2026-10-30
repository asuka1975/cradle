/-
  射影（ドメイン状態 → Row）と画面の束（非規範 — golden の都合）。
  `none`（そこに無い）と `some []`（見えたうえで空）は別の事実。束は見る者を要求せず、参照系は断らないので、どの画面も常にある。
  時計は境界の持ち物 — 時計を受ける画面は採取の今日（`goldenClock`）で評価する。
-/
import Mini.Runtime.Machine
import Mini.Application.Projection
import Mini.Application.UseCase.ShelfUseCase.UseCase
import Mini.Application.UseCase.CatalogUseCase.UseCase
import Mini.Application.UseCase.LoansUseCase.UseCase

namespace Mini.Runtime

open Mini Mini.Application

/-- 画面の束。フィールド名は画面（UseCase）の名前にそろえる。 -/
structure Views where
  /-- 棚の一覧。 -/
  shelf   : Option (List (BookView BookId))
  /-- 目録。 -/
  catalog : Option (List (CatalogEntry BookId))
  /-- 今日の貸出。 -/
  loans   : Option (List (BookView BookId))
deriving Repr, DecidableEq

def viewOrNone {α : Type} (r : Except QueryError (List α)) : Option (List α) :=
  match r with
  | .ok vs   => some vs
  | .error _ => none

/-- golden を採る日の時計。basic の貸出中の本を貸した日にそろえる。 -/
def goldenClock : Clock := ⟨Std.Time.PlainDate.ofYearMonthDayClip 2026 1 5⟩

def views (s : Snapshot) : Views :=
  { shelf   := viewOrNone (ShelfUseCase.execute {} ⟨bookRows s.books⟩),
    catalog := viewOrNone (CatalogUseCase.execute {} ⟨titleRows s.books⟩),
    loans   := viewOrNone (LoansUseCase.execute goldenClock {} ⟨bookRows s.books⟩) }

end Mini.Runtime
