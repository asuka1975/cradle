/-
  照会の契機 — timer からの「この試みの結果を確かめよ」。名義は無い。
-/
namespace Lobby.Application.InquirePaymentUseCase

structure Observation (PaymentAttemptId : Type) where
  attempt : PaymentAttemptId
deriving Repr, DecidableEq

end Lobby.Application.InquirePaymentUseCase
