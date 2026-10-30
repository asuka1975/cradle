/-
  値の市民。数量のふるまいと契約定理は、抽出器が生成に渡せない形（診断に残る指名）も持つ。
-/
import Depot.Domain.Annotations
import Depot.Domain.Error

namespace Depot

/-- 揃えた品番。入力語彙の PlaceOrderUseCase.Sku と短い名前が同じ。 -/
structure Sku where
  code : String
deriving Repr, DecidableEq

/-- 注文の同一性。 -/
structure OrderId where
  value : Nat
deriving Repr, DecidableEq

/-- 数量。 -/
structure Quantity where
  count : Nat
deriving Repr, DecidableEq

/-- 在庫 stock から引き当てる。足りなければ要った数を運ぶ失敗。 -/
def Quantity.reserve (q : Quantity) (stock : Nat) : Except DomainError Quantity :=
  if q.count ≤ stock then .ok q else .error (.outOfStock q.count)

/-- 足りなければ断る。オラクルが名前の無い引数の構成子（outOfStock）を運ぶ。 -/
@[contract] theorem Quantity.reserve_short (q : Quantity) (stock : Nat) (h : stock < q.count) :
    q.reserve stock = .error (.outOfStock q.count) := by
  simp [Quantity.reserve, Nat.not_le.mpr h]

/-- 数量のサンプル（4〜10）は仮定 100 < count を満たさない — ケースを演繹できない指名。 -/
@[contract] theorem Quantity.reserve_huge (q : Quantity) (stock : Nat) (h : stock < q.count)
    (_ : 100 < q.count) : q.reserve stock = .error (.outOfStock q.count) :=
  Quantity.reserve_short q stock h

/-- 符号つきで増減する。Int は契約面の語彙に無い — 署名を写像できないふるまい。 -/
def Quantity.adjust (q : Quantity) (delta : Int) : Quantity := ⟨(q.count + delta).toNat⟩

/-- 0 の増減は変えない。主対象の adjust が署名で除かれたあとの指名。 -/
@[contract] theorem Quantity.adjust_zero (q : Quantity) : q.adjust 0 = q := by
  cases q; simp [Quantity.adjust]

/-- 数え直す。関数の引数はサンプルを組めない。 -/
def Quantity.recount (q : Quantity) (f : Nat → Nat) : Quantity := ⟨f q.count⟩

/-- 数え直した数は f の値。f を量化するので翻訳できない指名。 -/
@[contract] theorem Quantity.recount_count (q : Quantity) (f : Nat → Nat) :
    (q.recount f).count = f q.count := rfl

end Depot
