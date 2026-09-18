/-
  提供元からの確定の通知 — 検証済みの受信境界（Adapter）が渡す内部入力。名義は無い。
  相関は冪等キー（attempt）で取る。
-/
import Lobby.Domain.ValueObject

namespace Lobby.Application.ConfirmPaymentUseCase

structure Observation (PaymentAttemptId : Type) where
  attempt : PaymentAttemptId
  result  : PaymentResult
deriving Repr, DecidableEq

end Lobby.Application.ConfirmPaymentUseCase
