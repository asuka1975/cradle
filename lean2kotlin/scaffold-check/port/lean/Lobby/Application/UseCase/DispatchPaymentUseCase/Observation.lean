/-
  配送の契機 — worker / timer からの「この試みを送れ」。利用者の操作ではなく名義は無い。
  契機は成功の事実ではない: 送れる状態かどうかは UseCase が保存状態で確かめる。
-/
namespace Lobby.Application.DispatchPaymentUseCase

structure Observation (PaymentAttemptId : Type) where
  attempt : PaymentAttemptId
deriving Repr, DecidableEq

end Lobby.Application.DispatchPaymentUseCase
