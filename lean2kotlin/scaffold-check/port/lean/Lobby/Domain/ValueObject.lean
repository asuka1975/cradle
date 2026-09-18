/-
  値の市民。来訪者の名前は空でない。来訪の段階は受付中か退出済みか。
-/
import Lobby.Domain.Annotations

namespace Lobby

/-- 来訪者の名前。制約: 空でないこと。 -/
structure VisitorName where
  text : String
deriving Repr, DecidableEq, Inhabited

def VisitorName.valid (n : VisitorName) : Bool := decide (0 < n.text.length)

@[contract] theorem VisitorName.valid_iff (n : VisitorName) : n.valid = true ↔ 0 < n.text.length := by
  simp [VisitorName.valid]

/-- 来訪の段階。受付中（expected）か退出済み（left）か。 -/
inductive VisitPhase where
  | expected
  | left
deriving Repr, DecidableEq

end Lobby
