/-
  決済の試み — 来訪の精算を決済ゲートウェイに送る、業務上の処理状態。
  要求（金額・冪等キー）はここに保存され、保存しただけでは承認にならない。
  冪等キーは id（同じ試みは同じ id で送り直す）、試行番号は tries（送るたびに進む）。
-/
import Lobby.Domain.Annotations
import Lobby.Domain.ValueObject

namespace Lobby.Domain

open Lobby

@[aggregateRoot]
structure PaymentAttempt (PaymentAttemptId VisitId : Type) where
  id     : PaymentAttemptId
  visit  : VisitId
  amount : Nat
  /-- 試行番号（送るたびに進む。冪等キー id とは別）。 -/
  tries  : Nat
  phase  : PaymentPhase
deriving Repr, DecidableEq

variable {PaymentAttemptId VisitId : Type}

/-- 始める: 送れる状態で保存する（まだ送っていない）。 -/
def PaymentAttempt.start (id : PaymentAttemptId) (visit : VisitId) (amount : Nat) :
    PaymentAttempt PaymentAttemptId VisitId :=
  { id, visit, amount, tries := 0, phase := .pending }

/-- 送る前に印を付ける: 試行番号を進め、送ったかどうか分からない状態（sending）にする（冪等キーは変えない）。 -/
def PaymentAttempt.markSending (a : PaymentAttempt PaymentAttemptId VisitId) :
    PaymentAttempt PaymentAttemptId VisitId :=
  { a with tries := a.tries + 1, phase := .sending }

/-- 送っている途中（印つき）か、答えを失ったか、通知待ちか — 照会で確かめる状態。 -/
def PaymentAttempt.isInquirable (a : PaymentAttempt PaymentAttemptId VisitId) : Bool :=
  a.phase == .sending || a.phase == .unknown || a.phase == .awaitingConfirmation

/-- 確定する。 -/
def PaymentAttempt.settle (a : PaymentAttempt PaymentAttemptId VisitId) (r : PaymentResult) :
    PaymentAttempt PaymentAttemptId VisitId :=
  { a with phase := match r with | .authorized => .authorized | .declined => .declined }

/-- 受け付けられ、確定の通知を待つ。 -/
def PaymentAttempt.awaitConfirmation (a : PaymentAttempt PaymentAttemptId VisitId) :
    PaymentAttempt PaymentAttemptId VisitId :=
  { a with phase := .awaitingConfirmation }

/-- 送ったが答えを失った（送り直さず照会する）。 -/
def PaymentAttempt.lose (a : PaymentAttempt PaymentAttemptId VisitId) :
    PaymentAttempt PaymentAttemptId VisitId :=
  { a with phase := .unknown }

/-- 提供元に届いていなかった: 送れる状態に戻す（同じ冪等キーで送り直す）。 -/
def PaymentAttempt.resetPending (a : PaymentAttempt PaymentAttemptId VisitId) :
    PaymentAttempt PaymentAttemptId VisitId :=
  { a with phase := .pending }

/-- 確定しているか。 -/
def PaymentAttempt.isSettled (a : PaymentAttempt PaymentAttemptId VisitId) : Bool :=
  a.phase == .authorized || a.phase == .declined

/-- その確定結果で決着しているか（同じ結果の通知の重複の判定）。 -/
def PaymentAttempt.settledAs (a : PaymentAttempt PaymentAttemptId VisitId) (r : PaymentResult) : Bool :=
  a.phase == (match r with | .authorized => PaymentPhase.authorized | .declined => .declined)

/-- 始めた直後は送れる状態。 -/
@[contract] theorem PaymentAttempt.start_pending (id : PaymentAttemptId) (v : VisitId) (n : Nat) :
    (PaymentAttempt.start id v n).phase = .pending := rfl

/-- 始めた直後は 1 度も送っていない。 -/
@[contract] theorem PaymentAttempt.start_tries (id : PaymentAttemptId) (v : VisitId) (n : Nat) :
    (PaymentAttempt.start id v n).tries = 0 := rfl

/-- 送る印は同一性（冪等キー）を変えない。 -/
@[contract] theorem PaymentAttempt.markSending_id (a : PaymentAttempt PaymentAttemptId VisitId) :
    a.markSending.id = a.id := rfl

/-- 送る印は試行番号を 1 進める。 -/
@[contract] theorem PaymentAttempt.markSending_tries (a : PaymentAttempt PaymentAttemptId VisitId) :
    a.markSending.tries = a.tries + 1 := rfl

/-- 送る印を付けた試みは、送ったかどうか分からない状態。 -/
@[contract] theorem PaymentAttempt.markSending_phase (a : PaymentAttempt PaymentAttemptId VisitId) :
    a.markSending.phase = .sending := rfl

/-- 受け付けられたら通知待ち。 -/
@[contract] theorem PaymentAttempt.awaitConfirmation_phase (a : PaymentAttempt PaymentAttemptId VisitId) :
    a.awaitConfirmation.phase = .awaitingConfirmation := rfl

/-- 送れる状態に戻せば送れる（試行番号は戻らない）。 -/
@[contract] theorem PaymentAttempt.resetPending_phase (a : PaymentAttempt PaymentAttemptId VisitId) :
    a.resetPending.phase = .pending := rfl

/-- 送れる状態に戻しても試行番号は戻らない。 -/
@[contract] theorem PaymentAttempt.resetPending_tries (a : PaymentAttempt PaymentAttemptId VisitId) :
    a.resetPending.tries = a.tries := rfl

/-- 確定は同一性を変えない。 -/
@[contract] theorem PaymentAttempt.settle_id (a : PaymentAttempt PaymentAttemptId VisitId) (r : PaymentResult) :
    (a.settle r).id = a.id := rfl

/-- 承認で確定すれば承認済み。 -/
@[contract] theorem PaymentAttempt.settle_authorized (a : PaymentAttempt PaymentAttemptId VisitId) :
    (a.settle .authorized).phase = .authorized := rfl

/-- 拒否で確定すれば拒否済み。 -/
@[contract] theorem PaymentAttempt.settle_declined (a : PaymentAttempt PaymentAttemptId VisitId) :
    (a.settle .declined).phase = .declined := rfl

/-- 答えを失えば結果不明。 -/
@[contract] theorem PaymentAttempt.lose_unknown (a : PaymentAttempt PaymentAttemptId VisitId) :
    a.lose.phase = .unknown := rfl

end Lobby.Domain
