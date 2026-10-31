/-
  語彙型への JSON の後付け（境界の関心）。derive した ToJson は名前の無い引数を鍵なしで書く。
-/
import Lean
import Depot.Domain.ValueObject

deriving instance Lean.ToJson for Depot.Hold
