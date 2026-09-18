/-
  提供元からの確定の通知 — 受信境界（Adapter）が署名と相関を確かめてから渡す内部入力。名義は無い。
  相関は冪等キー（attempt）で取る。
-/
import Lobby.Domain.ValueObject

namespace Lobby.Application.ConfirmPaymentUseCase

structure Observation (PaymentAttemptId : Type) where
  attempt : PaymentAttemptId
  result  : PaymentResult
deriving Repr, DecidableEq

end Lobby.Application.ConfirmPaymentUseCase
