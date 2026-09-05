/-
  閲覧の共有語彙（View と参照系の失敗）。UseCase ではない。
  View→Row の壁: View のメンバーに Row を使わない。
  View→ドメイン語彙の壁: ふるまいを持つ VO（Title）もそのまま載せず、View 自身の語彙（String）で写す。
-/
import Sprout.Domain.ValueObject

namespace Sprout.Application

open Sprout

/-- メモの見え方。 -/
structure NoteView (NoteId UserId : Type) where
  id     : NoteId
  author : UserId
  title  : String
  closed : Bool
deriving Repr, DecidableEq

/-- 参照系の失敗。 -/
inductive QueryError where
  /-- 見る立場に無い。 -/
  | forbidden
deriving Repr, DecidableEq

end Sprout.Application
