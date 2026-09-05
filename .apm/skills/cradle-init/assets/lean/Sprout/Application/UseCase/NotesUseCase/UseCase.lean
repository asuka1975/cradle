/-
  メモの一覧が見られた — 参照系 UseCase の固定形（validate / execute）。
-/
import Sprout.Application.ActorContext
import Sprout.Application.UseCase.NotesUseCase.QueryService

set_option linter.unusedSectionVars false

namespace Sprout.Application.NotesUseCase

open Sprout Sprout.Application

variable {NoteId UserId : Type}

/-- 検証対象が無いので常に成功（型の形が表明）。 -/
def validate (_actor : ActorContext UserId) (_q : Query) (_rm : ReadModel NoteId UserId) :
    Except QueryError Unit := .ok ()

def execute (actor : ActorContext UserId) (q : Query) (rm : ReadModel NoteId UserId) :
    Except QueryError (List (NoteView NoteId UserId)) :=
  (validate actor q rm).map (fun _ => query q rm)

@[contract] theorem execute_ok (actor : ActorContext UserId) (q : Query) (rm : ReadModel NoteId UserId) :
    execute actor q rm = .ok (query q rm) := rfl

end Sprout.Application.NotesUseCase
