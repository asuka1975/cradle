/-
  内部入力の輸送形式（合併型）。提供元からの通知や worker / timer からの契機を、各 UseCase の Observation の**まま**運ぶ。
  利用者の操作（`Runtime/Command.lean`）とは混ぜない — 名義は無く、利用者のフォーム・反機能一覧・API の command とは別の入力種。
  内部入力を持つ UseCase（`Application/UseCase/<X>UseCase/` の `Observation.lean`）が無い間、構成子は無い。
-/
import Sprout.Runtime.Ids

namespace Sprout.Runtime

inductive Observation where
deriving Repr, DecidableEq

end Sprout.Runtime
