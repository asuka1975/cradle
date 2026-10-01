/-
  値の市民（ドメイン状態が運ぶ値だけ）。1 VO = フィールド + 制約（Prop フィールド。状態に不正な値は入らない）+ ふるまいと @[contract] 定理群。
  入力専用の語彙（コマンドのペイロード）はここではなく各 UseCase の Command.lean の持ち物。
  仕様層では ToJson / FromJson を deriving しない（境界 Runtime/Json.lean が後付けする）。
-/
import Sprout.Domain.Annotations
import Std.Time

namespace Sprout

/-- 暦の日付。表現は標準の `Std.Time.PlainDate` — 暦として実在する日付だけが構築できる。
    リテラルは `date("2026-01-01")`。境界のワイヤは ISO-8601 `"uuuu-MM-dd"`。 -/
abbrev Date := Std.Time.PlainDate

/-- 暦の前後（`abbrev` 越しのドット記法は効かないため前置形 `Date.le a b` で使う）。 -/
def Date.le (a b : Date) : Bool := decide (a.toEpochDay.val ≤ b.toEpochDay.val)
def Date.lt (a b : Date) : Bool := decide (a.toEpochDay.val < b.toEpochDay.val)

/-! ### 題（メモの見出し） -/

/-- メモの題。空でないことは型が持つ — 空の題は構築できない（入力の検査は構築する側の validate）。 -/
structure Title where
  text : String
  nonempty : 0 < text.length
deriving Repr, DecidableEq

end Sprout
