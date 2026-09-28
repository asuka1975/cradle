/-
  メモを書くときの入力語彙（コマンドの持ち物 — VO ではない）。名義はここに無い。
-/

namespace Sprout.Application.PostNoteUseCase


structure Command where
  /-- 題の入力（空かもしれない。題にできるかは validate が決める）。 -/
  title : String
deriving Repr, DecidableEq

end Sprout.Application.PostNoteUseCase
