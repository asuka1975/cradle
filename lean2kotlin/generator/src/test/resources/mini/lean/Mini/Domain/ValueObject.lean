/-
  値の市民。題は自分が空でないかを言う（ふるまいを持つ）。本の状態は貸せるかを言う列挙。
  置き場所（sealed）と版（structure）はふるまいを持たず、題を運ぶ。
-/
import Mini.Domain.Annotations
import Std.Time

namespace Mini

/-- 暦の日付。表現は標準の `Std.Time.PlainDate`。境界のワイヤは ISO-8601 `"uuuu-MM-dd"`。 -/
abbrev Date := Std.Time.PlainDate

/-- 本の題。制約: 空でないこと。 -/
structure Title where
  text : String
deriving Repr, DecidableEq

def Title.valid (t : Title) : Bool := decide (0 < t.text.length)

@[contract] theorem Title.valid_iff (t : Title) : t.valid = true ↔ 0 < t.text.length := by
  simp [Title.valid]

/-- 本の状態。傷んだ本は貸さない。 -/
inductive Condition where
  | good
  | worn
  | damaged
deriving Repr, DecidableEq

/-- 貸せる状態か。 -/
def Condition.lendable (c : Condition) : Bool :=
  match c with
  | .damaged => false
  | _ => true

/-- 傷んだ本だけが貸せない。 -/
@[contract] theorem Condition.lendable_iff (c : Condition) : c.lendable = true ↔ c ≠ .damaged := by
  cases c <;> simp [Condition.lendable]

/-- 置き場所。棚にあるか、題を書いた箱に入っているか。 -/
inductive Place where
  | shelf
  | box (label : Title)
deriving Repr, DecidableEq

/-- 版。題と刷の番号。 -/
structure Edition where
  title  : Title
  number : Nat
deriving Repr, DecidableEq

end Mini
