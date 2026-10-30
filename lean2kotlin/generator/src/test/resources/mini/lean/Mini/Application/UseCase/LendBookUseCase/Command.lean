/-
  本を貸すときの入力語彙。宛先（同一性）だけを運ぶ。
-/
namespace Mini.Application.LendBookUseCase

structure Command (BookId : Type) where
  book : BookId
deriving Repr, DecidableEq

end Mini.Application.LendBookUseCase
