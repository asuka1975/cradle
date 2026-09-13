/-
  転送層 — 各 UseCase の保証を境界（Snapshot・views）の言葉に移す。
  観測モデルの構造が運ぶ制約（同一性の一意性）はそのまま使う。境界の検査（泉の境界）に依る
  保証だけが可到達性の仮定（`h : s.Reachable`）を取り、可到達性がそれを放電する。
-/
import Sprout.Runtime.Views

namespace Sprout.Laws

open Sprout Sprout.Application Sprout.Runtime

/-- 一覧に出るメモの同一性は重複しない。 -/
theorem notes_ids_nodup (today : Date) (s : Snapshot) (v : UserId)
    (vs : List (NoteView NoteId UserId)) (hvs : (views today s (some v)).notes = some vs) :
    (vs.map (·.id)).Nodup := by
  have hbase : (s.noteRows.map (·.id)).Nodup := by
    rw [show s.noteRows = Application.noteRows s.notes from rfl, Application.noteRows_ids]
    exact s.notes.uniqueIds
  simp only [views, viewOrNone, NotesUseCase.execute_ok, Option.some.injEq] at hvs
  rw [← hvs, NotesUseCase.query_ids]
  exact hbase.sublist (List.Sublist.map _ List.filter_sublist)

end Sprout.Laws
