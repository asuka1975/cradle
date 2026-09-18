/-
  閲覧の共有語彙（View）。View→ドメイン語彙の壁: ふるまいを持つ VO（VisitorName）は View 自身の語彙（String）で写す。
-/
import Lobby.Domain.ValueObject

namespace Lobby.Application

open Lobby

/-- 来訪の見え方。 -/
structure VisitView (VisitId EmployeeId : Type) where
  id       : VisitId
  host     : EmployeeId
  hostName : String
  visitor  : String
  phase    : VisitPhase
deriving Repr, DecidableEq

/-- 決済の試みの見え方。 -/
structure PaymentView (PaymentAttemptId VisitId : Type) where
  id     : PaymentAttemptId
  visit  : VisitId
  amount : Nat
  tries  : Nat
  phase  : PaymentPhase
deriving Repr, DecidableEq

end Lobby.Application
