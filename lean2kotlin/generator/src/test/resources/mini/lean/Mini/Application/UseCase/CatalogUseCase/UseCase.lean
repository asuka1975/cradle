/-
  目録が見られた — 参照系 UseCase の固定形（validate / execute）。名義を受けない。
-/
import Mini.Application.UseCase.CatalogUseCase.QueryService

namespace Mini.Application.CatalogUseCase

open Mini Mini.Application

variable {BookId : Type}

/-- 検証対象が無いので常に成功（型の形が表明）。 -/
def validate (_q : Query) (_rm : ReadModel BookId) : Except QueryError Unit := .ok ()

def execute (q : Query) (rm : ReadModel BookId) : Except QueryError (List (CatalogEntry BookId)) :=
  (validate q rm).map (fun _ => query q rm)

end Mini.Application.CatalogUseCase
