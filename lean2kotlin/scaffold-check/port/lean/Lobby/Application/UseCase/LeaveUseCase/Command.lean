/-
  退出するときの入力語彙。宛先（同一性）だけを運ぶ。
-/
namespace Lobby.Application.LeaveUseCase

structure Command (VisitId : Type) where
  visit : VisitId
deriving Repr, DecidableEq

end Lobby.Application.LeaveUseCase
