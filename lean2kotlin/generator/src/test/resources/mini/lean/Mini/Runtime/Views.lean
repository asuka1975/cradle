/-
  射影（ドメイン状態 → Row）と画面の束（非規範 — golden の都合）。
  `none`（そこに無い）と `some []`（見えたうえで空）は別の事実。この素材は名義を持たないので、どの画面も常にある。
-/
import Mini.Runtime.Machine
import Mini.Application.Projection
import Mini.Application.UseCase.ShelfUseCase.UseCase
import Mini.Application.UseCase.CatalogUseCase.UseCase

namespace Mini.Runtime

open Mini Mini.Application

/-- 画面の束。フィールド名は画面（UseCase）の名前にそろえる。 -/
structure Views where
  /-- 棚の一覧。 -/
  shelf   : Option (List (BookView BookId))
  /-- 目録。 -/
  catalog : Option (List (CatalogEntry BookId))
deriving Repr, DecidableEq

def viewOrNone {α : Type} (r : Except QueryError (List α)) : Option (List α) :=
  match r with
  | .ok vs   => some vs
  | .error _ => none

def views (s : Snapshot) : Views :=
  { shelf   := viewOrNone (ShelfUseCase.execute {} ⟨bookRows s.books⟩),
    catalog := viewOrNone (CatalogUseCase.execute {} ⟨titleRows s.books⟩) }

end Mini.Runtime
