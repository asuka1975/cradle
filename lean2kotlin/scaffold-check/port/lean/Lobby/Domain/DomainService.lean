/-
  来訪の領収の行数。単一ファイルの DomainService（生成される interface 名は DomainService）。
-/
import Lobby.Domain.Entity.Visit

namespace Lobby.Domain.DomainService

open Lobby.Domain

variable {VisitId EmployeeId : Type}

/-- 領収の行数: 退出済みなら 1 行、受付中なら 0 行。 -/
def receiptLines (v : Visit VisitId EmployeeId) : Nat := if v.phase == .left then 1 else 0

end Lobby.Domain.DomainService
