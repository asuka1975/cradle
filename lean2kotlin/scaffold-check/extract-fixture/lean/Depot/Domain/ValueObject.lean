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

/-- 足りない数の失敗。irreducible なので期待値は簡約で ctor 正規形にならず、合成したシリアライザのコンパイル実行で直列化する。 -/
@[irreducible] def Quantity.shortage (q : Quantity) (stock : Nat) : DomainError :=
  .outOfStock (q.count - stock)

/-- 足りない数は数量から在庫を引いた数。オラクルが名前の無い引数の構成子をシリアライザ経由で運ぶ。 -/
@[contract] theorem Quantity.shortage_eq (q : Quantity) (stock : Nat) :
    q.shortage stock = .outOfStock (q.count - stock) := by
  unfold Quantity.shortage; rfl

/-- 預かり場所。名前の無い引数の構成子に ToJson を derive する（Runtime/Json.lean）— 引数が 1 つなら裸の値、2 つ以上なら（名前のある引数が混ざっても）配列で書かれるのを固定する。 -/
inductive Hold where
  | onDock : Nat → Hold
  | atBay : Nat → Nat → Hold
  | mixed (row : Nat) : Nat → Hold
deriving Repr, DecidableEq

/-- 岸壁で預かる。irreducible なので期待値は ToJson インスタンスで直列化する。 -/
@[irreducible] def Quantity.dockHold (q : Quantity) : Hold := .onDock q.count

@[contract] theorem Quantity.dockHold_eq (q : Quantity) : q.dockHold = .onDock q.count := by
  unfold Quantity.dockHold; rfl

/-- 区画で預かる。 -/
@[irreducible] def Quantity.bayHold (q : Quantity) (bay : Nat) : Hold := .atBay bay q.count

@[contract] theorem Quantity.bayHold_eq (q : Quantity) (bay : Nat) : q.bayHold bay = .atBay bay q.count := by
  unfold Quantity.bayHold; rfl

/-- 列で預かる。 -/
@[irreducible] def Quantity.mixedHold (q : Quantity) (row : Nat) : Hold := .mixed row q.count

@[contract] theorem Quantity.mixedHold_eq (q : Quantity) (row : Nat) : q.mixedHold row = .mixed row q.count := by
  unfold Quantity.mixedHold; rfl

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
