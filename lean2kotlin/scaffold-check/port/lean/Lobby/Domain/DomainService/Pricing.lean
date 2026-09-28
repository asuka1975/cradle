/-
  来訪の料金。ファイル名が 7 文字の DomainService（生成される interface 名は PricingService）。
-/
import Lobby.Domain.Entity.Visit

namespace Lobby.Domain.DomainService.Pricing

open Lobby Lobby.Domain

variable {VisitId EmployeeId : Type}

/-- 受付中の来訪は無料、退出済みは 3/2（端数のある料金）。 -/
def fee (v : Visit VisitId EmployeeId) : Money :=
  if v.phase == .left then ⟨3 / 2, by grind⟩ else ⟨0, by grind⟩

/-- 退出済みの来訪の料金は 3/2。@[contract] は付けない — DomainService の def は生成テストの主対象ではない。 -/
theorem fee_left (v : Visit VisitId EmployeeId) (h : v.phase = .left) :
    fee v = ⟨3 / 2, by grind⟩ := by
  simp [fee, h]

end Lobby.Domain.DomainService.Pricing
