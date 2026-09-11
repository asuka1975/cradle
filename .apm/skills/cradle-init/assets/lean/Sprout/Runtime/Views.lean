/-
  射影（ドメイン状態 → Row）と画面の束（非規範 — モックアップ・golden の都合）。
  束は「誰が見るか」を要求する。`none`（そこに無い / 見られない）と `some []`（見えたうえで空）は別の事実。
  見ることは暦の上で起きる — 束も境界から時計を受け取る。
-/
import Sprout.Runtime.Machine
import Sprout.Application.Projection
import Sprout.Application.UseCase.NotesUseCase.UseCase

namespace Sprout.Runtime

open Sprout Sprout.Application

def Snapshot.noteRows (s : Snapshot) : List (NoteRow NoteId UserId) := Application.noteRows s.notes

/-- 画面の束。フィールド名は画面（UseCase）の名前にそろえる。 -/
structure Views where
  /-- メモの一覧。 -/
  notes : Option (List (NoteView NoteId UserId))
deriving Repr, DecidableEq

def viewOrNone {α : Type} (r : Except QueryError (List α)) : Option (List α) :=
  match r with
  | .ok vs   => some vs
  | .error _ => none

/-- 束を作る。viewer が無ければどの画面もそこに無い。 -/
def views (_today : Date) (s : Snapshot) (viewer : Option UserId) : Views :=
  match viewer with
  | none   => ⟨none⟩
  | some v => ⟨viewOrNone (NotesUseCase.execute ⟨v⟩ {} ⟨s.noteRows⟩)⟩

end Sprout.Runtime
