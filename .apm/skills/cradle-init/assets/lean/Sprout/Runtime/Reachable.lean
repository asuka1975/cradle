/-
  可到達性による接続 — 「検証を通った状態から始めて apply で進んだ状態は、いつでも検証を通る」。
  読み取り側の保証が境界の検査（泉の境界）に依るとき、その仮定はこの可到達性が放電する。
-/
import Sprout.Runtime.Machine

namespace Sprout.Runtime

open Sprout Sprout.Domain Sprout.Application Sprout.Prelude

inductive Snapshot.Reachable : Snapshot → Prop
  | checked (s : Snapshot) (h : s.check = true) : Snapshot.Reachable s
  | step (s s' : Snapshot) (today : Date) (actor : Actor) (cmd : Command)
      (h : Snapshot.Reachable s) (hc : s.check = true)
      (hs : Snapshot.apply today actor cmd s hc = .ok s') :
      Snapshot.Reachable s'

/-- 泉から汲んだ同一性のメモを足しても検査は保たれる。 -/
theorem check_of_note_add (s : Snapshot) (n : Note) (hfresh : n.id ∉ s.notes.ids)
    (hfree : n.title ∉ s.notes.titles) (hid : n.id = ⟨s.noteIds.next⟩) (h : s.check = true) :
    (⟨s.notes.add n hfresh hfree, ⟨s.noteIds.next + 1⟩⟩ : Snapshot).check = true := by
  show ((s.notes.notes ++ [n]).all _) = true
  rw [List.all_append, Bool.and_eq_true]
  constructor
  · simp only [Snapshot.check, Snapshot.bounds] at h
    rw [List.all_eq_true] at h ⊢
    intro x hx
    have := h x hx
    simp only [decide_eq_true_eq] at this ⊢
    omega
  · simp [hid]

/-- 同一性と題を変えない点更新は検査を保つ。 -/
theorem check_of_note_update (s : Snapshot) (id : NoteId) (f : Note → Note)
    (hf : ∀ n, (f n).id = n.id) (ht : ∀ n, (f n).title = n.title) (h : s.check = true) :
    (⟨s.notes.update id f hf ht, s.noteIds⟩ : Snapshot).check = true := by
  simp only [Snapshot.check, Snapshot.bounds] at h ⊢
  exact all_updateWhere (fun n => n.id == id) f _ _ h (fun x hx => by rw [hf]; exact hx)

/-- 芯は 1 本: 到達可能な状態は検査を通る。各遷移腕の証明は UseCase の契約定理の適用。 -/
theorem Snapshot.Reachable.check {s : Snapshot} (h : s.Reachable) : s.check = true := by
  induction h with
  | checked s h => exact h
  | step s s' today actor cmd _ hc hs ih =>
    cases cmd with
    | postNote c =>
      simp only [Snapshot.apply, Snapshot.applyCommand, Snapshot.opened] at hs
      obtain ⟨st, hst, hs'⟩ := except_map_eq_ok hs
      obtain ⟨free, hfree⟩ := PostNoteUseCase.execute_ok_shape _ _ _ _ _ _ hst
      subst hs'
      rw [hfree]
      exact check_of_note_add s _ (Snapshot.fresh s ih) free.free rfl ih
    | closeNote c =>
      simp only [Snapshot.apply, Snapshot.applyCommand, Snapshot.opened] at hs
      obtain ⟨st, hst, hs'⟩ := except_map_eq_ok hs
      obtain ⟨n, hn⟩ := CloseNoteUseCase.execute_ok_shape _ _ _ _ hst
      subst hs'
      rw [hn]
      exact check_of_note_update s c.note Note.close (fun _ => rfl) (fun _ => rfl) ih

end Sprout.Runtime
