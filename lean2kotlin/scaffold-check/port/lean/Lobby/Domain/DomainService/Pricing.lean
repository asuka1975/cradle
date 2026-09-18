/-
  来訪の料金。ファイル名が 7 文字の DomainService（生成される interface 名は PricingService）。
-/
import Lobby.Domain.Entity.Visit

namespace Lobby.Domain.DomainService.Pricing

open Lobby.Domain

variable {VisitId EmployeeId : Type}

/-- 受付中の来訪は無料、退出済みは 1。 -/
def fee (v : Visit VisitId EmployeeId) : Nat := if v.phase == .left then 1 else 0

end Lobby.Domain.DomainService.Pricing
