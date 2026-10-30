/-
  今日の貸出の取得と射影。読むのは Row だけ（Entity を見ない）。本番契約は固定名 `query`。
  今日は時計が配る — 時計はポート位置で受け、本番の署名には現れない。
-/
import Mini.Application.Clock
import Mini.Application.UseCase.LoansUseCase.ReadModel
import Mini.Application.View

namespace Mini.Application.LoansUseCase

open Mini Mini.Application

variable {BookId : Type}

/-- 問い合わせ。運ぶ値は無い。 -/
structure Query where
deriving Repr, DecidableEq, Inhabited

def toView (r : BookRow BookId) : BookView BookId :=
  { id := r.id, lendable := r.condition.lendable, lent := r.lentOn.isSome }

/-- 本番の取得契約（固定名）。今日貸した本だけが、並べた順のまま見える。 -/
def query (clock : Clock) (_q : Query) (rm : ReadModel BookId) : List (BookView BookId) :=
  (rm.books.filter fun r => decide (r.lentOn = some clock.today)).map toView

end Mini.Application.LoansUseCase
