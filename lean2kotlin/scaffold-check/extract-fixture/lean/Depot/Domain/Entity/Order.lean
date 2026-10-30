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

end Depot.Domain
