/-
  同一性の表現の仮置き（binder 規約 `<Root>.Runtime.<binder>` の解決先）。
-/
import Mini.Domain.Annotations

namespace Mini.Runtime

structure BookId where id : Nat
deriving Repr, DecidableEq, Inhabited

/-- 窓口の係の同一性（発行者は認証基盤 — 泉を持たない）。 -/
@[valueObject]
structure UserId where id : Nat
deriving Repr, DecidableEq, Inhabited

end Mini.Runtime
