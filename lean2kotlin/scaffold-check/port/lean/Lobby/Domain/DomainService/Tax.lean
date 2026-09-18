/-
  来訪の課税判定。ファイル名が短い DomainService（生成される interface 名は TaxService）。
-/
import Lobby.Domain.Entity.Visit

namespace Lobby.Domain.DomainService.Tax

open Lobby.Domain

variable {VisitId EmployeeId : Type}

/-- 退出済みの来訪だけが課税の対象になる。 -/
def taxable (v : Visit VisitId EmployeeId) : Bool := v.phase == .left

end Lobby.Domain.DomainService.Tax
