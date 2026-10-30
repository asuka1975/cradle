/-
  注文するときの入力語彙。入力のままの Sku は VO の Sku と短い名前が同じ —
  ふるまいの主対象と UseCase の input を短い名前で探すと、どちらの Sku・どちらの入力語彙にも当たり得る。
-/

namespace Depot.Application.PlaceOrderUseCase

/-- 入力のままの品番（揃える前）。 -/
structure Sku where
  raw : String
deriving Repr, DecidableEq

/-- 揃えた品番の文字列。 -/
def Sku.normalized (s : Sku) : String := s.raw.toUpper

structure Command where
  sku      : Sku
  quantity : Nat
deriving Repr, DecidableEq

end Depot.Application.PlaceOrderUseCase
