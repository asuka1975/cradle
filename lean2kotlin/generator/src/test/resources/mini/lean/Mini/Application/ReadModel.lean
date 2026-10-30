/-
  Row = Semantic Read Model（業務事実だけを運ぶ。DB スキーマではない）。読み取り側は Entity を見ない（CQRS）。
-/
import Mini.Domain.ValueObject

namespace Mini.Application

open Mini

/-- 本の行（棚の一覧が読む）。 -/
structure BookRow (BookId : Type) where
  id        : BookId
  condition : Condition
  lentOn    : Option Date
deriving Repr, DecidableEq

/-- 題の行（目録が読む）。 -/
structure TitleRow (BookId : Type) where
  book  : BookId
  title : Title
deriving Repr, DecidableEq

end Mini.Application
