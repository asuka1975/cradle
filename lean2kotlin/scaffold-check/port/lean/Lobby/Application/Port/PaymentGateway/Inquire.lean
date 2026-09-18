/-
  外部能力の Port「決済ゲートウェイ」の操作「結果を照会する」。
  答えを失った試み（結果不明）を、新しい決済を作らずに同じ冪等キーで確かめる。
-/
import Lobby.Domain.ValueObject

namespace Lobby.Application.Port.PaymentGateway.Inquire

/-- 要求: どの試みを確かめるか（冪等キー）。 -/
structure Request (PaymentAttemptId : Type) where
  attempt : PaymentAttemptId
deriving Repr, DecidableEq

/-- 観測: 確定している / 提供元に届いていない（送り直してよい）/ 答えない。 -/
inductive Outcome where
  | settled (result : PaymentResult)
  | notFound
  | unavailable
deriving Repr, DecidableEq

end Lobby.Application.Port.PaymentGateway.Inquire
