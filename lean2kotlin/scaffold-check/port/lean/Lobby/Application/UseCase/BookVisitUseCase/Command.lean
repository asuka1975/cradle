/-
  来訪を受け付けるときの入力語彙。名義はここに無い。
-/
import Lobby.Domain.ValueObject

namespace Lobby.Application.BookVisitUseCase

open Lobby

structure Command (EmployeeId : Type) where
  host    : EmployeeId
  visitor : VisitorName
deriving Repr, DecidableEq

end Lobby.Application.BookVisitUseCase
