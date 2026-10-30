/-
  目録が観測する Row の集合（観測の Set）。
-/
import Mini.Application.ReadModel

namespace Mini.Application.CatalogUseCase

open Mini.Application

structure ReadModel (BookId : Type) where
  titles : List (TitleRow BookId)
deriving Repr, DecidableEq

end Mini.Application.CatalogUseCase
