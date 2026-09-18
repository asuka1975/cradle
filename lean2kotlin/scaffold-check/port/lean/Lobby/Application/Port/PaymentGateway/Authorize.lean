/-
  外部能力の Port「決済ゲートウェイ」の操作「承認を求める」。
  要求は保存した業務の処理状態（PaymentAttempt）から決まる: 冪等キー（attempt）・金額・試行番号。
  観測は 5 つ。承認・拒否は確定、受付は確定の通知が後で届く、送れなかったなら同じ鍵で送り直してよく、
  答えが無いなら送ったかもしれないので送り直さず照会する。
-/
namespace Lobby.Application.Port.PaymentGateway.Authorize

/-- 要求: どの試みを、いくらで、何度目として送るか。attempt が冪等キー。 -/
structure Request (PaymentAttemptId : Type) where
  attempt   : PaymentAttemptId
  amount    : Nat
  attemptNo : Nat
deriving Repr, DecidableEq

/-- 観測: 承認 / 拒否 / 受付（確定は後の通知）/ 送れなかった（送り直してよい）/ 答えが無い（送り直さない）。 -/
inductive Outcome where
  | authorized
  | declined
  | accepted
  | unavailable
  | unknown
deriving Repr, DecidableEq

end Lobby.Application.Port.PaymentGateway.Authorize
