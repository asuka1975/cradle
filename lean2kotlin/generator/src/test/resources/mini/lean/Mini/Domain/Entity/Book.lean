/-
  本 — 具体構造体 + ふるまいの def + @[contract] 定理群。
-/
import Mini.Domain.Annotations
import Mini.Domain.ValueObject
import Mini.Domain.Error

namespace Mini.Domain

open Mini

/-- 棚の本。貸出中なら貸した日を持つ。 -/
@[aggregateRoot]
structure Book (BookId : Type) where
  id        : BookId
  edition   : Edition
  place     : Place
  condition : Condition
  lentOn    : Option Date
deriving Repr, DecidableEq

variable {BookId : Type}

/-- 貸し出す。傷んだ本と貸出中の本は本自身が断る（傷みを先に見る — 貸出中でも傷んだ本は傷んだと言う）。 -/
def Book.lend (b : Book BookId) (today : Date) : Except DomainError (Book BookId) :=
  if !b.condition.lendable then .error .damaged
  else if b.lentOn.isSome then .error .alreadyLent
  else .ok { b with lentOn := some today }

/-- 傷んでいない棚の本は貸せ、その日に貸した本になる（同一性・版・置き場所・状態は変わらない）。 -/
@[contract] theorem Book.lend_ok (b : Book BookId) (today : Date) (hc : b.condition ≠ .damaged)
    (h : b.lentOn.isSome = false) : b.lend today = .ok { b with lentOn := some today } := by
  cases hd : b.condition <;> simp_all [Book.lend, Condition.lendable]

/-- 傷んだ本は貸せない。 -/
@[contract] theorem Book.lend_damaged (b : Book BookId) (today : Date) (hc : b.condition = .damaged) :
    b.lend today = .error .damaged := by
  simp [Book.lend, hc, Condition.lendable]

/-- 貸出中の本は貸せない。 -/
@[contract] theorem Book.lend_already_lent (b : Book BookId) (today : Date) (hc : b.condition ≠ .damaged)
    (h : b.lentOn.isSome = true) : b.lend today = .error .alreadyLent := by
  cases hd : b.condition <;> simp_all [Book.lend, Condition.lendable]

/-- 貸すを適用し、断られたらそのままにしても同一性は変わらない（観測モデルの点更新に渡す形）。
    @[contract] は付けない — 証明の分解装置。 -/
theorem Book.lend_getD_id (today : Date) (b : Book BookId) : ((b.lend today).toOption.getD b).id = b.id := by
  unfold Book.lend
  split
  · rfl
  · split <;> rfl

end Mini.Domain
