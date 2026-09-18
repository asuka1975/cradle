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

/-- 決済の試みの段階。送れる（pending）・承認（authorized）・送ったが答えが無い（unknown）・
    送る印を付けた（sending。送ったかどうかは分からない）・拒否（declined）・受け付けられて確定の通知待ち（awaitingConfirmation）。
    sending / unknown / awaitingConfirmation からは送り直さず、照会で確かめる。 -/
inductive PaymentPhase where
  | pending
  | authorized
  | unknown
  | sending
  | declined
  | awaitingConfirmation
deriving Repr, DecidableEq

/-- 決済の確定結果（提供元の通知と照会が運ぶ）。 -/
inductive PaymentResult where
  | authorized
  | declined
deriving Repr, DecidableEq

end Lobby
