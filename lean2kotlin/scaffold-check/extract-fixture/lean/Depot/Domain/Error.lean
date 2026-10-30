/-
  失敗の語彙。outOfStock の引数は名前を持たない（矢印の binder は衛生化された名前になる）—
  形の欄名とオラクルの値の鍵がどう付くかを固定する。
-/

namespace Depot

inductive DomainError where
  /-- 在庫が足りない（要った数を運ぶ）。 -/
  | outOfStock : Nat → DomainError
  /-- 数量が 0 の注文。 -/
  | emptyOrder
deriving Repr, DecidableEq

end Depot
