/-
  画面の束（非規範 — golden の都合）。束は「誰が見るか」を要求する。`none`（そこに無い）と `some []`（見えたうえで空）は別の事実。
-/
import Lobby.Runtime.Machine
import Lobby.Application.Projection

namespace Lobby.Runtime

open Lobby Lobby.Application

/-- 画面の束。口は集約ごとの一覧。 -/
structure Views where
  visits   : Option (List (VisitView VisitId EmployeeId))
  payments : Option (List (PaymentView PaymentAttemptId VisitId))
deriving Repr, DecidableEq

/-- 束を作る。viewer が無ければどの画面もそこに無い。受付に立つ担当者は全部を見る。 -/
def views (_today : Date) (s : Snapshot) (viewer : Option UserId) : Views :=
  match viewer with
  | none   => ⟨none, none⟩
  | some _ => ⟨some (visitViews s.visits), some (paymentViews s.attempts)⟩

end Lobby.Runtime
