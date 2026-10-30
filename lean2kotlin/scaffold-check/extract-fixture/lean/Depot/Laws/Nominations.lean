/-
  検査に至らない印。抽出器はどれも diagnostics.dropped に理由つきで残す。
-/
import Depot.Domain.ValueObject

namespace Depot.Laws

open Depot

/-- 定理でない宣言に付いた契約の印。 -/
@[contract] def zeroQuantity : Quantity := ⟨0⟩

/-- 主対象（UseCase・ふるまい・判断・射影）のどの適用にも触れない契約定理 — フィールドの射影だけを語る。 -/
@[contract] theorem count_le_succ (q : Quantity) : q.count ≤ q.count + 1 := Nat.le_succ _

/-- def でない宣言に付いた障害契約の印。 -/
@[faultContract] theorem quantity_refl (q : Quantity) : q = q := rfl

/-- UseCase ディレクトリの外に置いた障害契約。 -/
@[faultContract] def afterCrash (q : Quantity) : Quantity := q

end Depot.Laws
