/-
  境界の時計。名義と同じく状態でも入力でもない引数種で、UseCase はポート位置で受ける。
-/
import Mini.Domain.ValueObject

namespace Mini.Application

open Mini

/-- 今日を配る調達。 -/
structure Clock where
  today : Date
deriving Repr, DecidableEq

end Mini.Application
