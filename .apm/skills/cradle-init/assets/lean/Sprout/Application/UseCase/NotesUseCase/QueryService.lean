/-
  メモの一覧の取得と射影。読むのは Row だけ（Entity を見ない）。本番契約は固定名 `query`。
-/
import Sprout.Application.UseCase.NotesUseCase.ReadModel
import Sprout.Application.View

set_option linter.unusedSectionVars false

namespace Sprout.Application.NotesUseCase

open Sprout Sprout.Application

variable {NoteId UserId : Type}

/-- 問い合わせ。運ぶ値は無い（誰が見るかは名義であって問い合わせの中身ではない）。 -/
structure Query where
deriving Repr, DecidableEq, Inhabited

/-- 一覧に出るのは開いているメモだけ（閉じたメモは消えないが見えない）。 -/
def openNotes (rows : List (NoteRow NoteId UserId)) : List (NoteRow NoteId UserId) :=
  rows.filter (fun r => !r.closed)

def toView (r : NoteRow NoteId UserId) : NoteView NoteId UserId :=
  { id := r.id, author := r.author, title := r.title.text, closed := r.closed }

/-- 本番の取得契約（固定名）。 -/
def query (_q : Query) (rm : ReadModel NoteId UserId) : List (NoteView NoteId UserId) :=
  (openNotes rm.notes).map toView

/-! ### 判断の保証（健全性・完全性・並び順） -/

@[contract] theorem query_only_open (q : Query) (rm : ReadModel NoteId UserId)
    (v : NoteView NoteId UserId) (h : v ∈ query q rm) :
    ∃ r ∈ rm.notes, r.closed = false ∧ toView r = v := by
  simp only [query, openNotes, List.mem_map, List.mem_filter, Bool.not_eq_true'] at h
  obtain ⟨r, ⟨hr, hc⟩, hv⟩ := h
  exact ⟨r, hr, hc, hv⟩

/-- 完全性と並び順: 開いているメモはすべて、書かれた順のまま見える。 -/
@[contract] theorem query_ids (q : Query) (rm : ReadModel NoteId UserId) :
    (query q rm).map (·.id) = (openNotes rm.notes).map (·.id) := by
  simp [query, toView, List.map_map, Function.comp]

end Sprout.Application.NotesUseCase
