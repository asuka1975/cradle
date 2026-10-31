/-
  失敗の語彙（1 分岐 1 構成子）。
-/
import Mini.Domain.Annotations

namespace Mini

/-- 業務としての失敗。技術的障害はこの語彙に含めない。 -/
inductive DomainError where
  /-- 宛先の本が無い。 -/
  | unknownBook
  /-- もう貸出中。 -/
  | alreadyLent
  /-- 傷んでいて貸せない。 -/
  | damaged
deriving Repr, DecidableEq

end Mini
