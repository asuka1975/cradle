/-
  在庫の参照の判断。発注点の def は Int の引数を持つ — 署名を写せない判断は判断の候補から外れる。
-/
import Depot.Domain.Annotations

namespace Depot.Application.StockUseCase

/-- 発注点: 調達の日数の 2 倍。日数は Int（契約面の語彙に無い）。 -/
def reorderPoint (leadDays : Int) : Nat := (leadDays * 2).toNat

/-- 日数 0 なら発注点も 0。主対象の reorderPoint が署名で除かれたあとの指名。 -/
@[contract] theorem reorderPoint_zero : reorderPoint 0 = 0 := rfl

end Depot.Application.StockUseCase
