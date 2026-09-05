/-
  失敗の語彙（1 分岐 1 構成子）。集約のふるまいも UseCase も同じ語彙で失敗する。
-/
import Sprout.Domain.Annotations

namespace Sprout

/-- 業務としての失敗。技術的障害（DB 例外など）はこの語彙に含めない。 -/
inductive DomainError where
  /-- 宛先のメモが無い。 -/
  | unknownNote
  /-- 書いた本人でない（他人のメモは閉じられない）。 -/
  | notAuthor
  /-- もう閉じている。 -/
  | alreadyClosed
  /-- 題が空。 -/
  | emptyTitle
deriving Repr, DecidableEq

end Sprout
