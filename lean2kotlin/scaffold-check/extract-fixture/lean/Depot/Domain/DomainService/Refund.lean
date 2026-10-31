/-
  返金の見積り。1 つのファイルが 2 つの名前空間に同じ葉名 quote を持つ — RefundService のメソッドの並びは宣言の完全名で決まる。
-/
import Depot.Domain.Entity.Order

namespace Depot.Domain.DomainService.Refund

open Depot.Domain

/-- 通常の返金の見積り（数量のまま）。 -/
def quote (o : Order) : Nat := o.quantity.count

/-- その場の返金の見積り。名前の成分が inst で始まる。 -/
def instantQuote (o : Order) : Nat := o.quantity.count

/-- インスタンスの補助 def の形（成分 instToStringOrder は inst の次が大文字）。RefundService に写らない。 -/
def instToStringOrder.label (o : Order) : Nat := o.quantity.count

end Depot.Domain.DomainService.Refund

namespace Depot.Domain.DomainService.Refund.Express

open Depot.Domain

/-- 急ぎの返金の見積り（1 つ少ない）。 -/
def quote (o : Order) : Nat := o.quantity.count - 1

end Depot.Domain.DomainService.Refund.Express
