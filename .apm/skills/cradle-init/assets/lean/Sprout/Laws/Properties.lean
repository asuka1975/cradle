/-
  転送層 — 各 UseCase の保証を境界（Snapshot・views）の言葉に移す。
  整合性の仮定は可到達性が放電する（仮定は `h : s.Reachable` だけ）。
-/
import Sprout.Runtime.Reachable
import Sprout.Runtime.Views

namespace Sprout.Laws

open Sprout Sprout.Application Sprout.Runtime

/-- 一覧に出るメモの同一性は重複しない。 -/
theorem notes_ids_nodup (today : Date) (s : Snapshot) (v : UserId) (h : s.Reachable)
    (vs : List (NoteView NoteId UserId)) (hvs : (views today s (some v)).notes = some vs) :
    (vs.map (·.id)).Nodup := by
  have hbase : (s.noteRows.map (·.id)).Nodup := by
    rw [show s.noteRows = Application.noteRows s.notes from rfl, Application.noteRows_ids]
    exact h.ids_nodup
  simp only [views, viewOrNone, NotesUseCase.execute_ok, Option.some.injEq] at hvs
  rw [← hvs, NotesUseCase.query_ids]
  exact hbase.sublist (List.Sublist.map _ List.filter_sublist)

end Sprout.Laws
