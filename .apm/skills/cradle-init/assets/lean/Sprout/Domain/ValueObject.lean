/-
  値の市民（ドメイン状態が運ぶ値だけ）。1 VO = フィールド + 制約 + @[contract] 定理群のユニット。
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

/-- メモの題。制約: 空でないこと。 -/
structure Title where
  text : String
deriving Repr, DecidableEq, Inhabited

/-- 妥当性（Bool の検証関数 — 実行できる制約）。 -/
def Title.valid (t : Title) : Bool := decide (0 < t.text.length)

/-- 制約の特徴付け（境界値テストの生成源）。 -/
@[contract] theorem Title.valid_iff (t : Title) : t.valid = true ↔ 0 < t.text.length := by
  simp [Title.valid]

end Sprout
