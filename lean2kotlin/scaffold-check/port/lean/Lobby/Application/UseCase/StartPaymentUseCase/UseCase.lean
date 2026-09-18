/-
  精算を始める — 利用者（受付担当者）の操作。決済の試みを「送れる状態」で保存するだけで、外部は呼ばない。
  送るのは内部の配送（DispatchPaymentUseCase）。
-/
import Lobby.Application.ActorContext
import Lobby.Application.RepositoryState
import Lobby.Domain.Error
import Lobby.Domain.DomainService.Tax
import Lobby.Domain.DomainService.Pricing
import Lobby.Application.UseCase.StartPaymentUseCase.Command

set_option linter.unusedSectionVars false

namespace Lobby.Application.StartPaymentUseCase

open Lobby Lobby.Domain Lobby.Application

variable {PaymentAttemptId VisitId EmployeeId UserId P : Type} [DecidableEq VisitId]

structure State (PaymentAttemptId VisitId EmployeeId P : Type) where
  visits     : VisitRepositoryState VisitId EmployeeId
  attempts   : PaymentAttemptRepositoryState PaymentAttemptId VisitId
  /-- 決済の試みの泉の生成器状態（表現は境界が決める）。 -/
  attemptIds : P
deriving Repr, DecidableEq

/-- 始まる前の拒否: 来訪が無い / まだ退出していない（精算は退出の後）/ その来訪に未確定の試みがある。 -/
def validate (_actor : ActorContext UserId) (c : Command VisitId)
    (before : State PaymentAttemptId VisitId EmployeeId P) : Except DomainError (Visit VisitId EmployeeId) :=
  match before.visits.find? c.visit with
  | none   => .error .unknownVisit
  | some v =>
    if !DomainService.Tax.taxable v then .error .notYetLeft
    else if before.attempts.hasOpenFor c.visit then .error .paymentInProgress
    else .ok v

/-- 料金を決め、送れる状態の試みを保存する。 -/
def act (fountain : Fountain P PaymentAttemptId) (c : Command VisitId)
    (before : State PaymentAttemptId VisitId EmployeeId P)
    (hfresh : fountain.Fresh before.attemptIds before.attempts.ids) (v : Visit VisitId EmployeeId) :
    State PaymentAttemptId VisitId EmployeeId P :=
  { before with
    attempts   := before.attempts.add (PaymentAttempt.start (fountain.valueAt before.attemptIds) c.visit (DomainService.Pricing.fee v)) hfresh,
    attemptIds := fountain.next before.attemptIds }

def execute (actor : ActorContext UserId) (fountain : Fountain P PaymentAttemptId) (c : Command VisitId)
    (before : State PaymentAttemptId VisitId EmployeeId P)
    (hfresh : fountain.Fresh before.attemptIds before.attempts.ids) :
    Except DomainError (State PaymentAttemptId VisitId EmployeeId P) :=
  (validate actor c before).map (act fountain c before hfresh)

/-- 開始の commit 前に中断したら、試みも採番も残らない（外部はもともと呼ばない）。 -/
@[faultContract] def beforeCommit (_actor : ActorContext UserId) (_fountain : Fountain P PaymentAttemptId)
    (_c : Command VisitId) (before : State PaymentAttemptId VisitId EmployeeId P)
    (_hfresh : _fountain.Fresh before.attemptIds before.attempts.ids) :
    State PaymentAttemptId VisitId EmployeeId P :=
  before

/-! ### 契約定理 -/

/-- 宛先の来訪が無ければ始めない。 -/
@[contract] theorem execute_unknown_visit (actor : ActorContext UserId) (fountain : Fountain P PaymentAttemptId)
    (c : Command VisitId) (before : State PaymentAttemptId VisitId EmployeeId P)
    (hfresh : fountain.Fresh before.attemptIds before.attempts.ids)
    (h : before.visits.find? c.visit = none) :
    execute actor fountain c before hfresh = .error .unknownVisit := by
  simp [execute, validate, h, Except.map]

/-- まだ退出していない来訪の精算は始めない。 -/
@[contract] theorem execute_not_yet_left (actor : ActorContext UserId) (fountain : Fountain P PaymentAttemptId)
    (c : Command VisitId) (before : State PaymentAttemptId VisitId EmployeeId P)
    (hfresh : fountain.Fresh before.attemptIds before.attempts.ids) (v : Visit VisitId EmployeeId)
    (h : before.visits.find? c.visit = some v) (ht : DomainService.Tax.taxable v = false) :
    execute actor fountain c before hfresh = .error .notYetLeft := by
  simp [execute, validate, h, ht, Except.map]

/-- 未確定の試みがある来訪には、新しい試みを作らない（同じ精算を二重に送らない）。 -/
@[contract] theorem execute_in_progress (actor : ActorContext UserId) (fountain : Fountain P PaymentAttemptId)
    (c : Command VisitId) (before : State PaymentAttemptId VisitId EmployeeId P)
    (hfresh : fountain.Fresh before.attemptIds before.attempts.ids) (v : Visit VisitId EmployeeId)
    (h : before.visits.find? c.visit = some v) (ht : DomainService.Tax.taxable v = true)
    (ho : before.attempts.hasOpenFor c.visit = true) :
    execute actor fountain c before hfresh = .error .paymentInProgress := by
  simp [execute, validate, h, ht, ho, Except.map]

/-- 退出済みで未確定の試みが無ければ、料金を決めて送れる状態で保存する。 -/
@[contract] theorem execute_ok (actor : ActorContext UserId) (fountain : Fountain P PaymentAttemptId)
    (c : Command VisitId) (before : State PaymentAttemptId VisitId EmployeeId P)
    (hfresh : fountain.Fresh before.attemptIds before.attempts.ids) (v : Visit VisitId EmployeeId)
    (h : before.visits.find? c.visit = some v) (ht : DomainService.Tax.taxable v = true)
    (ho : before.attempts.hasOpenFor c.visit = false) :
    execute actor fountain c before hfresh = .ok (act fountain c before hfresh v) := by
  simp [execute, validate, h, ht, ho, Except.map]

/-- 成功したら、その結果は act の形（境界の可到達性が使う）。 -/
theorem execute_ok_shape (actor : ActorContext UserId) (fountain : Fountain P PaymentAttemptId)
    (c : Command VisitId) (before after : State PaymentAttemptId VisitId EmployeeId P)
    (hfresh : fountain.Fresh before.attemptIds before.attempts.ids)
    (h : execute actor fountain c before hfresh = .ok after) : ∃ v, after = act fountain c before hfresh v := by
  obtain ⟨v, _, hv⟩ := Lobby.Prelude.except_map_eq_ok h
  exact ⟨v, hv⟩

end Lobby.Application.StartPaymentUseCase
