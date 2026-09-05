/-
  メモを書くときの入力語彙（コマンドの持ち物 — VO ではない）。名義はここに無い。
-/
import Sprout.Domain.ValueObject

namespace Sprout.Application.PostNoteUseCase

open Sprout

structure Command where
  title : Title
deriving Repr, DecidableEq

end Sprout.Application.PostNoteUseCase
