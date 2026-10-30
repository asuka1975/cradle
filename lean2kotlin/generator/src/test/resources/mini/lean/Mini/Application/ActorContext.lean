/-
  操作の主体（名義）。
-/
import Mini.Domain.Annotations

namespace Mini.Application

/-- いま貸出の窓口に立っている係。 -/
@[actorContext]
structure ActorContext (UserId : Type) where
  user : UserId
deriving Repr, DecidableEq

end Mini.Application
