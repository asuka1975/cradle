/-
  内部入力の輸送形式（合併型）。提供元からの通知や worker / timer からの契機を、各 UseCase の Observation の**まま**運ぶ。
  利用者の操作（`Runtime/Command.lean`）とは混ぜない — 名義は無い。
-/
import Lobby.Runtime.Ids
import Lobby.Application.UseCase.DispatchPaymentUseCase.Observation
import Lobby.Application.UseCase.ConfirmPaymentUseCase.Observation
import Lobby.Application.UseCase.InquirePaymentUseCase.Observation

namespace Lobby.Runtime

open Lobby Lobby.Application

inductive Observation where
  /-- 決済を送れ（worker の契機）。 -/
  | dispatchPayment (o : DispatchPaymentUseCase.Observation PaymentAttemptId)
  /-- 決済の確定の通知（提供元）。 -/
  | confirmPayment (o : ConfirmPaymentUseCase.Observation PaymentAttemptId)
  /-- 決済の結果を確かめよ（timer の契機）。 -/
  | inquirePayment (o : InquirePaymentUseCase.Observation PaymentAttemptId)
deriving Repr, DecidableEq

end Lobby.Runtime
