/-
  メモの一覧が観測する Row の集合（観測の Set）。
-/
import Sprout.Application.ReadModel

namespace Sprout.Application.NotesUseCase

open Sprout.Application

structure ReadModel (NoteId UserId : Type) where
  notes : List (NoteRow NoteId UserId)
deriving Repr, DecidableEq

end Sprout.Application.NotesUseCase
