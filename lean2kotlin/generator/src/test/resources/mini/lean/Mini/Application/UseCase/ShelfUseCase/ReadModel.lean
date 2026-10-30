/-
  棚の一覧が観測する Row の集合（観測の Set）。
-/
import Mini.Application.ReadModel

namespace Mini.Application.ShelfUseCase

open Mini.Application

structure ReadModel (BookId : Type) where
  books : List (BookRow BookId)
deriving Repr, DecidableEq

end Mini.Application.ShelfUseCase
