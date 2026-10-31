/-
  注文 — 集約ルート。即時返金の def は名前の成分が inst で始まる（インスタンスではない）。
-/
import Depot.Domain.Annotations
import Depot.Domain.ValueObject

namespace Depot.Domain

open Depot

/-- 注文。 -/
@[aggregateRoot]
structure Order where
  id       : OrderId
  quantity : Quantity
  refunded : Bool
deriving Repr, DecidableEq

/-- 返金する。 -/
def Order.refund (o : Order) : Order := { o with refunded := true }

/-- その場で返金する。 -/
def Order.instantRefund (o : Order) : Order := { o with refunded := true }

/-- 即時返金したら返金済み。 -/
@[contract] theorem Order.instantRefund_refunded (o : Order) : o.instantRefund.refunded = true := rfl

/-- 受け付けた窓口。Entity に置いた構成子だけの帰納型は生成区分を持たない。 -/
inductive Channel where
  | web
  | store
deriving Repr, DecidableEq

/-- 受け付けた窓口。未分類の Channel を返す — 署名を写せないふるまい。 -/
def Order.channel (o : Order) : Channel := if o.refunded then .store else .web

/-- 返金済みなら店頭。主対象の channel が未分類の型の参照で除かれたあとの指名。 -/
@[contract] theorem Order.channel_refunded (o : Order) (h : o.refunded = true) : o.channel = .store := by
  simp [Order.channel, h]

/-- 窓口の表示。名前空間の Channel は未分類で、短い名前が Channel の分類済みの型も無い。 -/
def Channel.label (c : Channel) : String :=
  match c with
  | .web   => "web"
  | .store => "store"

/-- web の表示は web。主対象の label が主対象の型を決められずに除かれたあとの指名。 -/
@[contract] theorem Channel.label_web : Channel.label .web = "web" := rfl

/-- 品番の表示。名前空間 Depot.Domain.Sku は型ではなく、短い名前が Sku の型は VO と入力語彙の 2 つ。 -/
def Sku.label (s : Sku) : String := s.code

/-- 表示は品番そのもの。主対象の label が型を 1 つに決められずに除かれたあとの指名。 -/
@[contract] theorem Sku.label_code (s : Sku) : Sku.label s = s.code := rfl

/-- 注文の失敗。Entity に置いた *Error の帰納型は error 区分で、ふるまいの主対象にならない。 -/
inductive OrderError where
  | late
  | lost
deriving Repr, DecidableEq

/-- 失敗の符号。名前空間の OrderError は分類済みだが、区分がふるまいの主対象でない。 -/
def OrderError.code (e : OrderError) : Nat :=
  match e with
  | .late => 1
  | .lost => 2

/-- 遅れの符号は 1。主対象の code が区分で主対象の型から外れたあとの指名。 -/
@[contract] theorem OrderError.code_late : OrderError.code .late = 1 := rfl

end Depot.Domain
