/-
  操作の主体（名義）。
-/
import Lobby.Domain.Annotations

namespace Lobby.Application

/-- いま受付に立っている担当者。 -/
@[actorContext]
structure ActorContext (UserId : Type) where
  user : UserId
deriving Repr, DecidableEq

end Lobby.Application
