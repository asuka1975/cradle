/-
  書き込みモデル → 読み取りモデルの射影（Entity を読んでよい唯一の読み側）と転送定理。
-/
import Sprout.Application.ReadModel
import Sprout.Application.RepositoryState

namespace Sprout.Application

open Sprout Sprout.Domain

variable {NoteId UserId : Type}

def toNoteRow (n : Note NoteId UserId) : NoteRow NoteId UserId :=
  { id := n.id, author := n.author, title := n.title, closed := n.closed }

/-- メモの行の一覧（書かれた順のまま）。 -/
def noteRows (s : NoteRepositoryState NoteId UserId) : List (NoteRow NoteId UserId) :=
  s.notes.map toNoteRow

/-- 妥当な書き込みモデルの射影は行の同一性を保つ。 -/
@[contract] theorem noteRows_ids (s : NoteRepositoryState NoteId UserId) :
    (noteRows s).map (·.id) = s.ids := by
  simp [noteRows, toNoteRow, NoteRepositoryState.ids, List.map_map, Function.comp]

end Sprout.Application
