/-
  確定の通知を適用する — 内部入力（Observation）だけの固定形。固定形は lean-conventions §4c。
  重複（同じ結果をもう一度）は適用済みとして通し、無関係（試みが無い・まだ送っていない）と矛盾（確定した結果と違う）は断る。
  遅延・順序逆転（印つき・結果不明・通知待ちのまま届く）は、その通知で確定する。
-/
import Lobby.Application.RepositoryState
import Lobby.Domain.Error
import Lobby.Application.UseCase.ConfirmPaymentUseCase.Observation

set_option linter.unusedSectionVars false

namespace Lobby.Application.ConfirmPaymentUseCase

open Lobby Lobby.Domain Lobby.Application

variable {PaymentAttemptId VisitId : Type} [DecidableEq PaymentAttemptId]

structure State (PaymentAttemptId VisitId : Type) where
  attempts : PaymentAttemptRepositoryState PaymentAttemptId VisitId
deriving Repr, DecidableEq

/-- 始まる前の拒否: 試みが無い（無関係な通知）/ まだ送っていない試みへの通知（無関係な結果）/ 確定した結果と矛盾する通知。 -/
def validate (o : Observation PaymentAttemptId) (before : State PaymentAttemptId VisitId) :
    Except DomainError (PaymentAttempt PaymentAttemptId VisitId) :=
  match before.attempts.find? o.attempt with
  | none   => .error .unknownAttempt
  | some a =>
    if a.phase == .pending then .error .unexpectedResult
    else if a.isSettled && !a.settledAs o.result then .error .contradictingResult
    else .ok a

/-- 通知の結果で確定する（同じ結果の重複は変化なし）。 -/
def act (o : Observation PaymentAttemptId) (before : State PaymentAttemptId VisitId)
    (_a : PaymentAttempt PaymentAttemptId VisitId) : State PaymentAttemptId VisitId :=
  ⟨before.attempts.update o.attempt (fun a => a.settle o.result) (fun _ => rfl)⟩

def execute (o : Observation PaymentAttemptId) (before : State PaymentAttemptId VisitId) :
    Except DomainError (State PaymentAttemptId VisitId) :=
  (validate o before).map (act o before)

/-! ### 契約定理 -/

/-- 試みが無ければ受け付けない（無関係な通知）。 -/
@[contract] theorem execute_unknown_attempt (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (h : before.attempts.find? o.attempt = none) :
    execute o before = .error .unknownAttempt := by
  simp [execute, validate, h, Except.map]

/-- まだ送っていない試みへの通知は受け付けない（無関係な結果）。 -/
@[contract] theorem execute_unexpected (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : (a.phase == .pending) = true) :
    execute o before = .error .unexpectedResult := by
  simp [execute, validate, h, hp, Except.map]

/-- 確定した結果と違う通知は上書きしない。 -/
@[contract] theorem execute_contradicting (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : (a.phase == .pending) = false)
    (hs : a.isSettled = true) (hd : a.settledAs o.result = false) :
    execute o before = .error .contradictingResult := by
  simp [execute, validate, h, hp, hs, hd, Except.map]

/-- 同じ結果の通知が重なっても、適用済みとして通る（状態は変わらない）。 -/
@[contract] theorem execute_duplicate (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : (a.phase == .pending) = false)
    (hs : a.isSettled = true) (hd : a.settledAs o.result = true) :
    execute o before = .ok (act o before a) := by
  simp [execute, validate, h, hp, hs, hd, Except.map]

/-- 送った後で未確定（印つき・通知待ち・結果不明）なら、その通知で確定する — 順序が逆でも遅れて届いても同じ。 -/
@[contract] theorem execute_settles (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : (a.phase == .pending) = false)
    (hs : a.isSettled = false) :
    execute o before = .ok (act o before a) := by
  simp [execute, validate, h, hp, hs, Except.map]

end Lobby.Application.ConfirmPaymentUseCase
