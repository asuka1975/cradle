/-
  注文する — 更新系 UseCase の固定形。validate は Int の引数を持ち、写像できない固定形の署名として診断に残る。
-/
import Depot.Domain.Error
import Depot.Domain.ValueObject
import Depot.Application.UseCase.PlaceOrderUseCase.Command

namespace Depot.Application.PlaceOrderUseCase

structure State where
  skus : List Depot.Sku
deriving Repr, DecidableEq

/-- 始まる前の拒否: 数量が 0 か上限が負なら注文できない。上限は Int（契約面の語彙に無い）。 -/
def validate (c : Command) (limit : Int) : Except DomainError Unit :=
  if c.quantity = 0 ∨ limit < 0 then .error .emptyOrder else .ok ()

/-- 揃えた品番を足す。 -/
def execute (c : Command) (before : State) : Except DomainError State :=
  if c.quantity = 0 then .error .emptyOrder
  else .ok { before with skus := before.skus ++ [⟨c.sku.normalized⟩] }

end Depot.Application.PlaceOrderUseCase
