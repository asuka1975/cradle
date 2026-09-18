/-
  同一性の表現の仮置き（生成器の binder 規約 `<Root>.Runtime.<binder>` の解決先）。
-/
import Lobby.Application.RepositoryState

namespace Lobby.Runtime

open Lobby

structure VisitId where id : Nat
deriving Repr, DecidableEq, Inhabited

/-- 社員の同一性（発行者はディレクトリ側 — 泉を持たない）。 -/
@[valueObject]
structure EmployeeId where id : Nat
deriving Repr, DecidableEq, Inhabited

/-- 受付担当者の同一性（発行者は認証基盤 — 泉を持たない）。 -/
@[valueObject]
structure UserId where id : Nat
deriving Repr, DecidableEq, Inhabited

/-- 来訪の泉の具体化（連番）。 -/
def visitFountain : Application.Fountain Application.VisitIdGeneratorState VisitId :=
  { step := fun s => (⟨s.next⟩, ⟨s.next + 1⟩) }

end Lobby.Runtime
