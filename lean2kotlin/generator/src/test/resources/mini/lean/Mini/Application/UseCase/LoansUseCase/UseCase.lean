/-
  今日の貸出が見られた — 時計を受ける参照系 UseCase の固定形（validate / execute）。名義を受けない。
-/
import Mini.Application.UseCase.LoansUseCase.QueryService

namespace Mini.Application.LoansUseCase

open Mini Mini.Application

variable {BookId : Type}

/-- 検証対象が無いので常に成功（型の形が表明）。 -/
def validate (_clock : Clock) (_q : Query) (_rm : ReadModel BookId) : Except QueryError Unit := .ok ()

def execute (clock : Clock) (q : Query) (rm : ReadModel BookId) : Except QueryError (List (BookView BookId)) :=
  (validate clock q rm).map (fun _ => query clock q rm)

/-- 今日の貸出は、時計の今日に貸した本だけを見せる。 -/
@[contract] theorem execute_ok (clock : Clock) (q : Query) (rm : ReadModel BookId) :
    execute clock q rm = .ok (query clock q rm) := rfl

end Mini.Application.LoansUseCase
