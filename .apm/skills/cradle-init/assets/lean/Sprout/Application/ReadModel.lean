/-
  Row = Semantic Read Model（業務事実だけを運ぶ。DB スキーマではない）。読み取り側は Entity を見ない（CQRS）。
-/
import Sprout.Domain.ValueObject

namespace Sprout.Application

open Sprout

/-- メモの行。 -/
structure NoteRow (NoteId UserId : Type) where
  id     : NoteId
  author : UserId
  title  : Title
  closed : Bool
deriving Repr, DecidableEq

end Sprout.Application
