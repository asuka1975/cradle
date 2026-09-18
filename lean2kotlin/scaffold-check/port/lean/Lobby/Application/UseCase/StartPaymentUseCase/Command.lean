/-
  精算を始めるときの入力語彙。宛先の来訪（同一性）だけを運ぶ。
-/
namespace Lobby.Application.StartPaymentUseCase

structure Command (VisitId : Type) where
  visit : VisitId
deriving Repr, DecidableEq

end Lobby.Application.StartPaymentUseCase
