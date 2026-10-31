/-
  今日の貸出が観測する Row の集合（観測の Set）。
-/
import Mini.Application.ReadModel

namespace Mini.Application.LoansUseCase

open Mini.Application

structure ReadModel (BookId : Type) where
  books : List (BookRow BookId)
deriving Repr, DecidableEq

end Mini.Application.LoansUseCase
