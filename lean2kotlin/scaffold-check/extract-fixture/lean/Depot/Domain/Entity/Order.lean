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

/-- 品番の表示。名前空間 Depot.Domain.Sku は型ではなく、短い名前が Sku の型は VO と入力語彙の 2 つ。 -/
def Sku.label (s : Sku) : String := s.code

end Depot.Domain
