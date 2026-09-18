/-
  送ったかどうか分からない決済を照会する — 内部の配送（Observation + Port の別の操作）。
  印つき（sending）・結果不明・通知待ちからは新しい決済を作らず、同じ冪等キーで確かめる。届いていなかったなら送れる状態に戻す。
-/
import Lobby.Application.RepositoryState
import Lobby.Application.Port.PaymentGateway.Inquire
import Lobby.Domain.Error
import Lobby.Application.UseCase.InquirePaymentUseCase.Observation

set_option linter.unusedSectionVars false

namespace Lobby.Application.InquirePaymentUseCase

open Lobby Lobby.Domain Lobby.Application
open Lobby.Application.Port.PaymentGateway

variable {PaymentAttemptId VisitId : Type} [DecidableEq PaymentAttemptId]

structure State (PaymentAttemptId VisitId : Type) where
  attempts : PaymentAttemptRepositoryState PaymentAttemptId VisitId
deriving Repr, DecidableEq

/-- 始まる前の拒否: 試みが無い / 照会する状態（印つき・結果不明・通知待ち）ではない。 -/
def validate (o : Observation PaymentAttemptId) (before : State PaymentAttemptId VisitId) :
    Except DomainError (PaymentAttempt PaymentAttemptId VisitId) :=
  match before.attempts.find? o.attempt with
  | none   => .error .unknownAttempt
  | some a => if a.isInquirable then .ok a else .error .attemptNotInquirable

def mkRequest (_o : Observation PaymentAttemptId) (_before : State PaymentAttemptId VisitId)
    (a : PaymentAttempt PaymentAttemptId VisitId) : Inquire.Request PaymentAttemptId :=
  ⟨a.id⟩

def request (o : Observation PaymentAttemptId) (before : State PaymentAttemptId VisitId) :
    Except DomainError (Inquire.Request PaymentAttemptId) :=
  (validate o before).map (mkRequest o before)

/-- 観測ごとの反映: 確定していれば確定、届いていなければ送れる状態に戻す、答えなければそのまま。 -/
def reflect (outcome : Inquire.Outcome) (a : PaymentAttempt PaymentAttemptId VisitId) :
    PaymentAttempt PaymentAttemptId VisitId :=
  match outcome with
  | .settled r   => a.settle r
  | .notFound    => a.resetPending
  | .unavailable => a

theorem reflect_id (outcome : Inquire.Outcome) (a : PaymentAttempt PaymentAttemptId VisitId) :
    (reflect outcome a).id = a.id := by
  cases outcome <;> rfl

def apply (outcome : Inquire.Outcome) (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (_a : PaymentAttempt PaymentAttemptId VisitId) :
    Except DomainError (State PaymentAttemptId VisitId) :=
  .ok ⟨before.attempts.update o.attempt (reflect outcome) (reflect_id outcome)⟩

def execute (outcome : Inquire.Outcome) (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) : Except DomainError (State PaymentAttemptId VisitId) :=
  (validate o before) >>= apply outcome o before

/-! ### 契約定理 -/

/-- 試みが無ければ照会しない。 -/
@[contract] theorem execute_unknown_attempt (outcome : Inquire.Outcome) (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (h : before.attempts.find? o.attempt = none) :
    execute outcome o before = .error .unknownAttempt := by
  simp [execute, validate, h, Bind.bind, Except.bind]

/-- 照会する状態でなければ照会しない（送れる状態・確定済み）。 -/
@[contract] theorem execute_not_inquirable (outcome : Inquire.Outcome) (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : a.isInquirable = false) :
    execute outcome o before = .error .attemptNotInquirable := by
  simp [execute, validate, h, hp, Bind.bind, Except.bind]

/-- 確定していれば、その結果で確定する。 -/
@[contract] theorem execute_settled (r : PaymentResult) (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : a.isInquirable = true) :
    execute (.settled r) o before = .ok ⟨before.attempts.update o.attempt (reflect (.settled r)) (reflect_id (.settled r))⟩ := by
  simp [execute, validate, apply, h, hp, Bind.bind, Except.bind]

/-- 提供元に届いていなければ、送れる状態に戻す（同じ冪等キーで送り直す）。 -/
@[contract] theorem execute_not_found (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : a.isInquirable = true) :
    execute .notFound o before = .ok ⟨before.attempts.update o.attempt (reflect .notFound) (reflect_id .notFound)⟩ := by
  simp [execute, validate, apply, h, hp, Bind.bind, Except.bind]

/-- 答えなければそのまま（次の照会を待つ）。 -/
@[contract] theorem execute_unavailable (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : a.isInquirable = true) :
    execute .unavailable o before = .ok ⟨before.attempts.update o.attempt (reflect .unavailable) (reflect_id .unavailable)⟩ := by
  simp [execute, validate, apply, h, hp, Bind.bind, Except.bind]

/-- 成功したら、その結果は apply の形（境界の可到達性が使う）。 -/
theorem execute_ok_shape (outcome : Inquire.Outcome) (o : Observation PaymentAttemptId)
    (before after : State PaymentAttemptId VisitId)
    (h : execute outcome o before = .ok after) :
    ∃ a, apply outcome o before a = .ok after := by
  unfold execute at h
  cases hv : validate o before with
  | error e => rw [hv] at h; cases h
  | ok a => rw [hv] at h; exact ⟨a, h⟩

end Lobby.Application.InquirePaymentUseCase
