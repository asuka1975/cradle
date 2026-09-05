/-
  メモを閉じるときの入力語彙。宛先（同一性）だけを運ぶ。名義はここに無い。
-/
namespace Sprout.Application.CloseNoteUseCase

structure Command (NoteId : Type) where
  note : NoteId
deriving Repr, DecidableEq

end Sprout.Application.CloseNoteUseCase
