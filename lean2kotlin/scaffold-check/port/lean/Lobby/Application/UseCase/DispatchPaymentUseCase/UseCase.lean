/-
  決済を送る — 内部の配送（Observation + Port）。固定形は lean-conventions §4c。
  「どの状態なら送るか」「送り直してよいか」は validate と request が決める: 送れるのは pending だけ。
  受付済み・確定済み・結果不明からは送り直さない（結果不明は InquirePaymentUseCase が照会する）。
  送る印（試行番号）を保存してから送る — 中断しても印が残り、同じ冪等キーで再開できる。
-/
import Lobby.Application.RepositoryState
import Lobby.Application.Port.PaymentGateway.Authorize
import Lobby.Domain.Error
import Lobby.Application.UseCase.DispatchPaymentUseCase.Observation

set_option linter.unusedSectionVars false

namespace Lobby.Application.DispatchPaymentUseCase

open Lobby Lobby.Domain Lobby.Application
open Lobby.Application.Port.PaymentGateway

variable {PaymentAttemptId VisitId : Type} [DecidableEq PaymentAttemptId]

structure State (PaymentAttemptId VisitId : Type) where
  attempts : PaymentAttemptRepositoryState PaymentAttemptId VisitId
deriving Repr, DecidableEq

/-- 始まる前の拒否: 試みが無い（無関係な契機）/ 送れる状態でない。 -/
def validate (o : Observation PaymentAttemptId) (before : State PaymentAttemptId VisitId) :
    Except DomainError (PaymentAttempt PaymentAttemptId VisitId) :=
  match before.attempts.find? o.attempt with
  | none   => .error .unknownAttempt
  | some a => if a.phase == .pending then .ok a else .error .attemptNotDispatchable

/-- 要求の組み立て: 保存した試みから、冪等キー・金額・次の試行番号。 -/
def mkRequest (_o : Observation PaymentAttemptId) (_before : State PaymentAttemptId VisitId)
    (a : PaymentAttempt PaymentAttemptId VisitId) : Authorize.Request PaymentAttemptId :=
  ⟨a.id, a.amount, a.tries + 1⟩

/-- 外部への要求（validate が通ったときだけ要求がある）。 -/
def request (o : Observation PaymentAttemptId) (before : State PaymentAttemptId VisitId) :
    Except DomainError (Authorize.Request PaymentAttemptId) :=
  (validate o before).map (mkRequest o before)

/-- 観測ごとの反映。どの観測でも試行番号は進む（送ったので）。 -/
def reflect (outcome : Authorize.Outcome) (a : PaymentAttempt PaymentAttemptId VisitId) :
    PaymentAttempt PaymentAttemptId VisitId :=
  match outcome with
  | .authorized  => a.markSending.settle .authorized
  | .declined    => a.markSending.settle .declined
  | .accepted    => a.markSending.awaitConfirmation
  | .unavailable => a.markSending
  | .unknown     => a.markSending.lose

theorem reflect_id (outcome : Authorize.Outcome) (a : PaymentAttempt PaymentAttemptId VisitId) :
    (reflect outcome a).id = a.id := by
  cases outcome <;> rfl

/-- 観測を受けて確定する。承認・拒否は確定、受付は通知待ち、送れなかったなら送れる状態のまま、答えが無ければ結果不明。 -/
def apply (outcome : Authorize.Outcome) (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (_a : PaymentAttempt PaymentAttemptId VisitId) :
    Except DomainError (State PaymentAttemptId VisitId) :=
  .ok ⟨before.attempts.update o.attempt (reflect outcome) (reflect_id outcome)⟩

def execute (outcome : Authorize.Outcome) (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) : Except DomainError (State PaymentAttemptId VisitId) :=
  (validate o before) >>= apply outcome o before

/-- 送る印を保存した状態（中断点の共通の観測）。 -/
def marked (o : Observation PaymentAttemptId) (before : State PaymentAttemptId VisitId) :
    State PaymentAttemptId VisitId :=
  ⟨before.attempts.update o.attempt PaymentAttempt.markSending (fun _ => rfl)⟩

/-- 送る印を保存した後、送る前に中断した: 印は残り、同じ鍵で送り直せる。外部は呼ばれていない。 -/
@[faultContract] def markedNotSent (o : Observation PaymentAttemptId) (before : State PaymentAttemptId VisitId) :
    State PaymentAttemptId VisitId :=
  marked o before

/-- 外部では成立したかもしれないが応答を失った: 印は残り、未成立と断定しない。外部は 1 回呼ばれた。 -/
@[faultContract] def sentNoAnswer (_outcome : Authorize.Outcome) (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) : State PaymentAttemptId VisitId :=
  marked o before

/-- 応答を得た後、反映の commit 前に中断した: 外部の効果は取り消されず、印の残る状態から回復する。 -/
@[faultContract] def appliedNotCommitted (_outcome : Authorize.Outcome) (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) : State PaymentAttemptId VisitId :=
  marked o before

/-! ### 契約定理 -/

/-- 試みが無ければ送らない（無関係な契機）。 -/
@[contract] theorem execute_unknown_attempt (outcome : Authorize.Outcome) (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (h : before.attempts.find? o.attempt = none) :
    execute outcome o before = .error .unknownAttempt := by
  simp [execute, validate, h, Bind.bind, Except.bind]

/-- 送れる状態でなければ送らない — 受付済み・確定済み・結果不明からは送り直さない。 -/
@[contract] theorem execute_not_dispatchable (outcome : Authorize.Outcome) (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : (a.phase == .pending) = false) :
    execute outcome o before = .error .attemptNotDispatchable := by
  simp [execute, validate, h, hp, Bind.bind, Except.bind]

/-- 承認されれば確定する（試行番号は進む）。 -/
@[contract] theorem execute_authorized (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : (a.phase == .pending) = true) :
    execute .authorized o before = .ok ⟨before.attempts.update o.attempt (reflect .authorized) (reflect_id .authorized)⟩ := by
  simp [execute, validate, apply, h, hp, Bind.bind, Except.bind]

/-- 拒否されれば確定する。 -/
@[contract] theorem execute_declined (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : (a.phase == .pending) = true) :
    execute .declined o before = .ok ⟨before.attempts.update o.attempt (reflect .declined) (reflect_id .declined)⟩ := by
  simp [execute, validate, apply, h, hp, Bind.bind, Except.bind]

/-- 受け付けられたら確定の通知を待つ（承認とはまだ言わない）。 -/
@[contract] theorem execute_accepted (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : (a.phase == .pending) = true) :
    execute .accepted o before = .ok ⟨before.attempts.update o.attempt (reflect .accepted) (reflect_id .accepted)⟩ := by
  simp [execute, validate, apply, h, hp, Bind.bind, Except.bind]

/-- 送れなかったら送れる状態のまま、試行番号だけ進む（同じ鍵で送り直す）。 -/
@[contract] theorem execute_unavailable (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : (a.phase == .pending) = true) :
    execute .unavailable o before = .ok ⟨before.attempts.update o.attempt (reflect .unavailable) (reflect_id .unavailable)⟩ := by
  simp [execute, validate, apply, h, hp, Bind.bind, Except.bind]

/-- 答えが無ければ結果不明として残す（送り直さない — 照会で解く）。 -/
@[contract] theorem execute_unknown (o : Observation PaymentAttemptId)
    (before : State PaymentAttemptId VisitId) (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : (a.phase == .pending) = true) :
    execute .unknown o before = .ok ⟨before.attempts.update o.attempt (reflect .unknown) (reflect_id .unknown)⟩ := by
  simp [execute, validate, apply, h, hp, Bind.bind, Except.bind]

/-- 要求は送れる試みにだけあり、同じ冪等キーと次の試行番号を運ぶ（中断後の再開も同じ要求になる）。@[contract] は付けない — 要求の値は execute の契約ケースがモックで検査する。 -/
theorem request_ok (o : Observation PaymentAttemptId) (before : State PaymentAttemptId VisitId)
    (a : PaymentAttempt PaymentAttemptId VisitId)
    (h : before.attempts.find? o.attempt = some a) (hp : (a.phase == .pending) = true) :
    request o before = .ok ⟨a.id, a.amount, a.tries + 1⟩ := by
  simp [request, validate, mkRequest, h, hp, Except.map]

/-- 成功したら、その結果は apply の形（境界の可到達性が使う）。 -/
theorem execute_ok_shape (outcome : Authorize.Outcome) (o : Observation PaymentAttemptId)
    (before after : State PaymentAttemptId VisitId)
    (h : execute outcome o before = .ok after) :
    ∃ a, apply outcome o before a = .ok after := by
  unfold execute at h
  cases hv : validate o before with
  | error e => rw [hv] at h; cases h
  | ok a => rw [hv] at h; exact ⟨a, h⟩

end Lobby.Application.DispatchPaymentUseCase
