/-
  可到達性による接続 — 「検証を通った状態から始めて apply / external で進んだ状態は、いつでも検証を通る」。
  読み取り側の保証が境界の検査（泉の境界）に依るとき、その仮定はこの可到達性が放電する。
  flow（連続する step）もここで定義する — 次の手の検査は同じ補題が放電する。
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
  /-- external の経路で進んだ状態（利用者の操作・内部入力とも）。 -/
  | external (s s' : Snapshot) (today : Date) (input : Input) (env env' : Environment) (used : List Interaction)
      (h : Snapshot.Reachable s) (hc : s.check = true)
      (hs : Snapshot.applyExternal today input s env hc = .applied s' env' used) :
      Snapshot.Reachable s'
  /-- 指名した障害契約で中断した状態（中断点からの再開の出発点）。この骨格に障害契約は無い。 -/
  | faulted (s s' : Snapshot) (today : Date) (input : Input) (env env' : Environment) (used : List Interaction)
      (contract : String) (portCalls : Nat)
      (h : Snapshot.Reachable s) (hc : s.check = true)
      (hs : Snapshot.applyExternal today input s env hc = .fault s' env' used contract portCalls) :
      Snapshot.Reachable s'

/-- 結果が運ぶ状態は検査を通る（applied と fault について。refused と harness は状態を運ばない）。 -/
def StepResult.Sound : StepResult → Prop
  | .applied s _ _ => s.check = true
  | .fault s _ _ _ _ => s.check = true
  | .refused _ _ _ => True
  | .harness _ => True

/-- 障害契約の解決先が運ぶ状態は検査を通る。 -/
def FaultSpec.Sound {O : Type} : FaultSpec O → Prop
  | .beforeCall after => after.check = true
  | .afterResponse after => ∀ o, (after o).check = true

/-! ### 配線の分解 — 各配線は、execute の成功と障害契約の状態が検査を通るなら、結果も通す -/

/-- Port を使わない配線。 -/
theorem direct_sound {env : Environment} {run : Except DomainError Snapshot} {fault : Option (String × Snapshot)}
    (hrun : ∀ s', run = .ok s' → s'.check = true)
    (hfault : ∀ e, fault = some e → e.2.check = true) : (direct env run fault).Sound := by
  cases run with
  | error e => rcases fault with _ | ⟨name, after⟩ <;> trivial
  | ok s' =>
    rcases fault with _ | ⟨name, after⟩
    · exact hrun s' rfl
    · exact hfault (name, after) rfl

set_option linter.unusedVariables false in
/-- Port を使う配線。Interaction に構成子が無い間は hrun を使わずに閉じる（Port を足すと使う）。 -/
theorem viaPort_sound {R O : Type} [BEq R] {env : Environment} {req : Except DomainError R}
    {pick : Interaction → Option (R × O)} {run : O → Except DomainError Snapshot}
    {fault : Option (String × FaultSpec O)}
    (hrun : ∀ o s', run o = .ok s' → s'.check = true)
    (hfault : ∀ e, fault = some e → e.2.Sound) : (viaPort env req pick run fault).Sound := by
  unfold viaPort
  repeat' split
  all_goals first
    | trivial
    | exact hrun _ _ ‹_›
    | exact hfault _ rfl
    | exact hfault _ ‹_›
    | exact (hfault _ rfl) _
    | exact (hfault _ ‹_›) _

/-- 障害契約の表引き: 続きが表の要素（か無し）で健全なら全体も健全。 -/
theorem withFault_sound {α : Type} {fault : Option String} {table : List (String × α)}
    {k : Option (String × α) → StepResult}
    (hk : ∀ f, (∀ e, f = some e → e ∈ table) → (k f).Sound) : (withFault fault table k).Sound := by
  unfold withFault
  split
  · exact hk none (fun _ h => nomatch h)
  · split
    · exact hk _ (fun e he => by cases he; exact List.mem_of_find?_eq_some ‹_›)
    · trivial

/-- 表が空なら障害契約の指名は無い。 -/
theorem no_fault_of_empty {α β : Type} {f : Option (String × α)} (hf : ∀ e, f = some e → e ∈ ([] : List (String × α)))
    (g : String × α → β) (e : β) (h : f.map g = some e) : False := by
  cases f with
  | none => cases h
  | some e' => exact List.not_mem_nil (hf e' rfl)

/-! ### 集約ごとの保存 -/

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

/-- 旧経路の 1 手が検査を保つこと（external の腕はこれに帰着する）。 -/
theorem check_of_apply (s s' : Snapshot) (today : Date) (actor : Actor) (cmd : Command)
    (hc : s.check = true) (hs : Snapshot.apply today actor cmd s hc = .ok s') : s'.check = true := by
  cases cmd with
  | postNote c =>
    simp only [Snapshot.apply, Snapshot.applyCommand, Snapshot.opened] at hs
    obtain ⟨st, hst, hs'⟩ := except_map_eq_ok hs
    obtain ⟨free, hfree⟩ := PostNoteUseCase.execute_ok_shape _ _ _ _ _ _ hst
    subst hs'
    rw [hfree]
    exact check_of_note_add s _ (Snapshot.fresh s hc) free.free rfl hc
  | closeNote c =>
    simp only [Snapshot.apply, Snapshot.applyCommand, Snapshot.opened] at hs
    obtain ⟨st, hst, hs'⟩ := except_map_eq_ok hs
    obtain ⟨n, hn⟩ := CloseNoteUseCase.execute_ok_shape _ _ _ _ hst
    subst hs'
    rw [hn]
    exact check_of_note_update s c.note Note.close (fun _ => rfl) (fun _ => rfl) hc

/-! ### 芯は 1 本 -/

/-- external の 1 手は健全: 腕は旧経路の 1 手（check_of_apply）への配線で、障害契約の表は空。 -/
theorem applyExternal_sound (today : Date) (input : Input) (s : Snapshot) (env : Environment) (hc : s.check = true) :
    (Snapshot.applyExternal today input s env hc).Sound := by
  cases input with
  | observation obs _ => exact nomatch obs
  | command actor cmd fault =>
    simp only [Snapshot.applyExternal]
    refine withFault_sound fun f hf => direct_sound ?_ ?_
    · intro s' hs'
      exact check_of_apply s s' today actor cmd hc hs'
    · intro e he
      exact (List.not_mem_nil (hf e he)).elim

/-- 到達可能な状態は検査を通る。 -/
theorem Snapshot.Reachable.check {s : Snapshot} (h : s.Reachable) : s.check = true := by
  induction h with
  | checked s h => exact h
  | step s s' today actor cmd _ hc hs _ => exact check_of_apply s s' today actor cmd hc hs
  | external s s' today input env env' used _ hc hs _ =>
    have hsound := applyExternal_sound today input s env hc
    rw [hs] at hsound
    exact hsound
  | faulted s s' today input env env' used contract calls _ hc hs _ =>
    have hsound := applyExternal_sound today input s env hc
    rw [hs] at hsound
    exact hsound

/-! ### flow — 入力列を順に流す（flow / dump の定義そのもの: 連続する step） -/

/-- 各手について（入力・手前の状態・結果）を残し、ハーネスの失敗で止まる（その手を最後の要素として返す）。
    applied / fault の次の検査は applyExternal_sound が放電するので、検査に失敗する腕は無い。 -/
def flow (today : Date) : List Input → (s : Snapshot) → Environment → s.check = true →
    List (Input × Snapshot × StepResult) × Snapshot × Environment
  | [], s, env, _ => ([], s, env)
  | i :: rest, s, env, h =>
    match hr : Snapshot.applyExternal today i s env h with
    | .applied s' env' used =>
      let (t, sf, ef) := flow today rest s' env' (by have hs := applyExternal_sound today i s env h; rw [hr] at hs; exact hs)
      ((i, s, .applied s' env' used) :: t, sf, ef)
    | .refused e env' used =>
      let (t, sf, ef) := flow today rest s env' h
      ((i, s, .refused e env' used) :: t, sf, ef)
    | .fault s' env' used c n =>
      let (t, sf, ef) := flow today rest s' env' (by have hs := applyExternal_sound today i s env h; rw [hr] at hs; exact hs)
      ((i, s, .fault s' env' used c n) :: t, sf, ef)
    | .harness msg => ([(i, s, .harness msg)], s, env)

end Sprout.Runtime
