/-
  棚の一覧の取得と射影。読むのは Row だけ（Entity を見ない）。本番契約は固定名 `query`。
-/
import Mini.Application.UseCase.ShelfUseCase.ReadModel
import Mini.Application.View

namespace Mini.Application.ShelfUseCase

open Mini Mini.Application

variable {BookId : Type}

/-- 問い合わせ。運ぶ値は無い。 -/
structure Query where
deriving Repr, DecidableEq, Inhabited

def toView (r : BookRow BookId) : BookView BookId :=
  { id := r.id, lendable := r.condition.lendable, lent := r.lentOn.isSome }

/-- 本番の取得契約（固定名）。棚の本はすべて、並べた順のまま見える。 -/
def query (_q : Query) (rm : ReadModel BookId) : List (BookView BookId) :=
  rm.books.map toView

end Mini.Application.ShelfUseCase
