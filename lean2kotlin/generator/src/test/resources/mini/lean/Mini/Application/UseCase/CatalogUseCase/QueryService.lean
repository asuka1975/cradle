/-
  目録の取得と射影。読むのは Row だけ（Entity を見ない）。本番契約は固定名 `query`。
-/
import Mini.Application.UseCase.CatalogUseCase.ReadModel
import Mini.Application.View

namespace Mini.Application.CatalogUseCase

open Mini Mini.Application

variable {BookId : Type}

/-- 問い合わせ。運ぶ値は無い。 -/
structure Query where
deriving Repr, DecidableEq, Inhabited

def toEntry (r : TitleRow BookId) : CatalogEntry BookId :=
  { book := r.book, title := r.title }

/-- 本番の取得契約（固定名）。棚の本の題がすべて、並べた順のまま見える。 -/
def query (_q : Query) (rm : ReadModel BookId) : List (CatalogEntry BookId) :=
  rm.titles.map toEntry

end Mini.Application.CatalogUseCase
