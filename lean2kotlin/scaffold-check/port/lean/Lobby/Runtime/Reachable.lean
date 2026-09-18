/-
  可到達性による接続 — 「検証を通った状態から始めて external で進んだ状態は、いつでも検証を通る」。
  利用者の操作・内部入力・障害契約の指名のどの結果（applied / fault）も、泉の境界を保つ。
  flow（連続する step）もここで定義する — 次の手の検査は同じ補題が放電する。
-/
import Lobby.Runtime.Machine

namespace Lobby.Runtime

open Lobby Lobby.Domain Lobby.Application Lobby.Prelude

inductive Snapshot.Reachable : Snapshot → Prop
  | checked (s : Snapshot) (h : s.check = true) : Snapshot.Reachable s
  /-- external の経路で進んだ状態（利用者の操作・内部入力とも）。 -/
  | external (s s' : Snapshot) (today : Date) (input : Input) (env env' : Environment) (used : List Interaction)
      (h : Snapshot.Reachable s) (hc : s.check = true)
      (hs : Snapshot.applyExternal today input s env hc = .applied s' env' used) :
      Snapshot.Reachable s'
  /-- 指名した障害契約で中断した状態（中断点からの再開の出発点）。 -/
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

/-- Port を使う配線。 -/
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

/-- 泉から汲んだ同一性の来訪を足しても検査は保たれる。 -/
theorem check_of_visit_add (s : Snapshot) (v : Visit VisitId EmployeeId) (hfresh : v.id ∉ s.visits.ids)
    (hvac : s.visits.vacant = true) (hid : v.id = ⟨s.visitIds.next⟩) (h : s.check = true) :
    ({ s with visits := s.visits.add v hfresh hvac, visitIds := ⟨s.visitIds.next + 1⟩ } : Snapshot).check = true := by
  simp only [Snapshot.check, Bool.and_eq_true] at h ⊢
  obtain ⟨h1, h2⟩ := h
  refine ⟨?_, h2⟩
  show ((s.visits.visits ++ [v]).all _) = true
  rw [List.all_append, Bool.and_eq_true]
  constructor
  · rw [List.all_eq_true] at h1 ⊢
    intro x hx
    have := h1 x hx
    simp only [decide_eq_true_eq] at this ⊢
    omega
  · simp [hid]

/-- 同一性を変えない来訪の点更新は検査を保つ。 -/
theorem check_of_visit_update (s : Snapshot) (id : VisitId) (f : Visit VisitId EmployeeId → Visit VisitId EmployeeId)
    (hf : ∀ v, (f v).id = v.id) (hp : ∀ v, ((f v).phase != .left) = true → (v.phase != .left) = true)
    (h : s.check = true) :
    ({ s with visits := s.visits.update id f hf hp } : Snapshot).check = true := by
  simp only [Snapshot.check, Bool.and_eq_true] at h ⊢
  refine ⟨?_, h.2⟩
  exact all_updateWhere (fun v => v.id == id) f _ _ h.1 (fun x hx => by rw [hf]; exact hx)

/-- 泉から汲んだ同一性の試みを足しても検査は保たれる。 -/
theorem check_of_attempt_add (s : Snapshot) (a : PaymentAttempt PaymentAttemptId VisitId)
    (hfresh : a.id ∉ s.attempts.ids) (hid : a.id = ⟨s.attemptIds.next⟩) (h : s.check = true) :
    ({ s with attempts := s.attempts.add a hfresh, attemptIds := ⟨s.attemptIds.next + 1⟩ } : Snapshot).check = true := by
  simp only [Snapshot.check, Bool.and_eq_true] at h ⊢
  obtain ⟨h1, h2⟩ := h
  refine ⟨h1, ?_⟩
  show ((s.attempts.attempts ++ [a]).all _) = true
  rw [List.all_append, Bool.and_eq_true]
  constructor
  · rw [List.all_eq_true] at h2 ⊢
    intro x hx
    have := h2 x hx
    simp only [decide_eq_true_eq] at this ⊢
    omega
  · simp [hid]

/-- 同一性を変えない試みの点更新は検査を保つ。 -/
theorem check_of_attempt_update (s : Snapshot) (id : PaymentAttemptId)
    (f : PaymentAttempt PaymentAttemptId VisitId → PaymentAttempt PaymentAttemptId VisitId)
    (hf : ∀ a, (f a).id = a.id) (h : s.check = true) :
    ({ s with attempts := s.attempts.update id f hf } : Snapshot).check = true := by
  simp only [Snapshot.check, Bool.and_eq_true] at h ⊢
  refine ⟨h.1, ?_⟩
  exact all_updateWhere (fun a => a.id == id) f _ _ h.2 (fun x hx => by rw [hf]; exact hx)

/-! ### 芯は 1 本 -/

/-- external の 1 手は健全: 各腕の証明は UseCase の契約定理（execute_ok_shape）と障害契約の def の形の適用。 -/
theorem applyExternal_sound (today : Date) (input : Input) (s : Snapshot) (env : Environment) (hc : s.check = true) :
    (Snapshot.applyExternal today input s env hc).Sound := by
  cases input with
  | command actor cmd fault =>
    cases cmd with
    | bookVisit c =>
      simp only [Snapshot.applyExternal, Snapshot.applyCommand]
      refine withFault_sound fun f hf => viaPort_sound ?_ ?_
      · intro o s' ho
        obtain ⟨st, hst, rfl⟩ := except_map_eq_ok ho
        obtain ⟨v, hv⟩ := BookVisitUseCase.execute_ok_shape _ _ _ _ _ _ _ hst
        cases o with
        | missing => simp [BookVisitUseCase.apply] at hv
        | unavailable => simp [BookVisitUseCase.apply] at hv
        | found m =>
          simp only [BookVisitUseCase.apply] at hv
          split at hv
          · cases hv
            exact check_of_visit_add s _ (Snapshot.freshVisit s hc) v.vacant rfl hc
          · cases hv
      · intro e he
        cases f with
        | none => cases he
        | some e' =>
          have hin := hf e' rfl
          simp only [List.mem_singleton] at hin
          subst hin
          simp only [Option.map, Option.some.injEq] at he
          subst he
          exact fun _ => hc
    | leave c =>
      simp only [Snapshot.applyExternal, Snapshot.applyCommand]
      refine withFault_sound fun f hf => direct_sound ?_ ?_
      · intro s' hs'
        obtain ⟨st, hst, rfl⟩ := except_map_eq_ok hs'
        obtain ⟨v, hv⟩ := LeaveUseCase.execute_ok_shape _ _ _ _ hst
        subst hv
        exact check_of_visit_update s c.visit Visit.leave (fun _ => rfl) LeaveUseCase.leave_not_expected hc
      · intro e he
        exact (no_fault_of_empty hf _ _ he).elim
    | startPayment c =>
      simp only [Snapshot.applyExternal, Snapshot.applyCommand]
      refine withFault_sound fun f hf => direct_sound ?_ ?_
      · intro s' hs'
        obtain ⟨st, hst, rfl⟩ := except_map_eq_ok hs'
        obtain ⟨v, hv⟩ := StartPaymentUseCase.execute_ok_shape _ _ _ _ _ _ hst
        subst hv
        exact check_of_attempt_add s _ (Snapshot.freshAttempt s hc) rfl hc
      · intro e he
        cases f with
        | none => cases he
        | some e' =>
          have hin := hf e' rfl
          simp only [List.mem_singleton] at hin
          subst hin
          simp only [Option.map, Option.some.injEq] at he
          subst he
          exact hc
  | observation obs fault =>
    cases obs with
    | dispatchPayment o =>
      simp only [Snapshot.applyExternal, Snapshot.applyObservation]
      refine withFault_sound fun f hf => viaPort_sound ?_ ?_
      · intro out s' hs'
        obtain ⟨st, hst, rfl⟩ := except_map_eq_ok hs'
        obtain ⟨a, ha⟩ := DispatchPaymentUseCase.execute_ok_shape _ _ _ _ hst
        simp only [DispatchPaymentUseCase.apply, Except.ok.injEq] at ha
        subst ha
        exact check_of_attempt_update s o.attempt (DispatchPaymentUseCase.reflect out) (DispatchPaymentUseCase.reflect_id out) hc
      · intro e he
        cases f with
        | none => cases he
        | some e' =>
          have hin := hf e' rfl
          simp only [Option.map, Option.some.injEq] at he
          subst he
          simp only [List.mem_cons, List.not_mem_nil, or_false] at hin
          rcases hin with rfl | rfl | rfl
          all_goals first
            | exact check_of_attempt_update s o.attempt PaymentAttempt.markSending (fun _ => rfl) hc
            | exact fun _ => check_of_attempt_update s o.attempt PaymentAttempt.markSending (fun _ => rfl) hc
    | confirmPayment o =>
      simp only [Snapshot.applyExternal, Snapshot.applyObservation]
      refine withFault_sound fun f hf => direct_sound ?_ ?_
      · intro s' hs'
        obtain ⟨st, hst, rfl⟩ := except_map_eq_ok hs'
        obtain ⟨a, ha⟩ := ConfirmPaymentUseCase.execute_ok_shape _ _ _ hst
        subst ha
        exact check_of_attempt_update s o.attempt (fun a => a.settle o.result) (fun _ => rfl) hc
      · intro e he
        exact (no_fault_of_empty hf _ _ he).elim
    | inquirePayment o =>
      simp only [Snapshot.applyExternal, Snapshot.applyObservation]
      refine withFault_sound fun f hf => viaPort_sound ?_ ?_
      · intro out s' hs'
        obtain ⟨st, hst, rfl⟩ := except_map_eq_ok hs'
        obtain ⟨a, ha⟩ := InquirePaymentUseCase.execute_ok_shape _ _ _ _ hst
        simp only [InquirePaymentUseCase.apply, Except.ok.injEq] at ha
        subst ha
        exact check_of_attempt_update s o.attempt (InquirePaymentUseCase.reflect out) (InquirePaymentUseCase.reflect_id out) hc
      · intro e he
        exact (no_fault_of_empty hf _ _ he).elim

/-- 到達可能な状態は検査を通る。 -/
theorem Snapshot.Reachable.check {s : Snapshot} (h : s.Reachable) : s.check = true := by
  induction h with
  | checked s h => exact h
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

end Lobby.Runtime
