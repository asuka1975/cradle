/-
  可到達性による接続 — 「検証を通った状態から始めて apply で進んだ状態は、いつでも検証を通る」。
  読み取り側の保証が必要とする整合性の仮定は、この可到達性が放電する。
-/
import Sprout.Runtime.Machine

namespace Sprout.Runtime

open Sprout Sprout.Domain Sprout.Application Sprout.Prelude

inductive Snapshot.Reachable : Snapshot → Prop
  | checked (s : Snapshot) (h : s.check = true) : Snapshot.Reachable s
  | step (s s' : Snapshot) (today : Date) (actor : Actor) (cmd : Command)
      (h : Snapshot.Reachable s) (hs : Snapshot.apply today actor cmd s = .ok s') :
      Snapshot.Reachable s'

/-- 泉から汲んだ同一性のメモを足しても検査は保たれる。 -/
theorem check_of_note_add (s : Snapshot) (n : Note) (hid : n.id = ⟨s.noteIds.next⟩)
    (h : s.check = true) : (⟨s.notes.add n, ⟨s.noteIds.next + 1⟩⟩ : Snapshot).check = true := by
  simp only [Snapshot.check, Bool.and_eq_true] at h
  obtain ⟨hv, hb⟩ := h
  have hfresh : n.id ∉ s.notes.ids := by
    rw [hid]
    exact Snapshot.fresh s hb
  simp only [Snapshot.check, Bool.and_eq_true]
  refine ⟨NoteRepositoryState.add_valid s.notes n hfresh hv, ?_⟩
  show ((s.notes.notes ++ [n]).all _) = true
  rw [List.all_append, Bool.and_eq_true]
  constructor
  · simp only [Snapshot.bounds] at hb
    rw [List.all_eq_true] at hb ⊢
    intro x hx
    have := hb x hx
    simp only [decide_eq_true_eq] at this ⊢
    omega
  · simp [hid]

/-- 同一性を変えない点更新は検査を保つ。 -/
theorem check_of_note_update (s : Snapshot) (id : NoteId) (f : Note → Note)
    (hf : ∀ n, (f n).id = n.id) (h : s.check = true) :
    (⟨s.notes.update id f, s.noteIds⟩ : Snapshot).check = true := by
  simp only [Snapshot.check, Bool.and_eq_true] at h ⊢
  obtain ⟨hv, hb⟩ := h
  refine ⟨NoteRepositoryState.update_valid s.notes id f hf hv, ?_⟩
  simp only [Snapshot.bounds] at hb ⊢
  exact all_updateWhere (fun n => n.id == id) f _ _ hb (fun x hx => by rw [hf]; exact hx)

/-- 芯は 1 本: 到達可能な状態は検査を通る。各遷移腕の証明は UseCase の契約定理の適用。 -/
theorem Snapshot.Reachable.check {s : Snapshot} (h : s.Reachable) : s.check = true := by
  induction h with
  | checked s h => exact h
  | step s s' today actor cmd _ hs ih =>
    cases cmd with
    | postNote c =>
      simp only [Snapshot.apply, Snapshot.applyCommand, Snapshot.opened] at hs
      obtain ⟨st, hst, hs'⟩ := except_map_eq_ok hs
      have := PostNoteUseCase.execute_ok_shape _ _ _ _ _ hst
      subst hs'
      rw [this]
      exact check_of_note_add s _ rfl ih
    | closeNote c =>
      simp only [Snapshot.apply, Snapshot.applyCommand, Snapshot.opened] at hs
      obtain ⟨st, hst, hs'⟩ := except_map_eq_ok hs
      obtain ⟨n, hn⟩ := CloseNoteUseCase.execute_ok_shape _ _ _ _ hst
      subst hs'
      rw [hn]
      exact check_of_note_update s c.note Note.close (fun _ => rfl) ih

/-- 抽出補題: 到達可能な状態では同一性が重複しない。 -/
theorem Snapshot.Reachable.ids_nodup {s : Snapshot} (h : s.Reachable) : s.notes.ids.Nodup := by
  have := h.check
  simp only [Snapshot.check, Bool.and_eq_true, NoteRepositoryState.valid, decide_eq_true_eq] at this
  exact this.1

end Sprout.Runtime
