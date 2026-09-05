/-
  操作の主体（名義）— 状態でもコマンドでもない第 3 の引数種（調達ポート）。
  UseCase はポート位置（先頭）で受け取る。コマンド（利用者の入力）に名義を混ぜない —
  混ぜた瞬間「他人の名前で操作する」が入口から生えてしまう。
  値の出どころ（認証済みトークンのクレーム等）は境界の関心で、組み立ててよいのは認証アダプタだけ。
-/
import Sprout.Domain.Annotations

namespace Sprout.Application

/-- いまその人自身として操作している利用者。 -/
@[actorContext]
structure ActorContext (UserId : Type) where
  user : UserId
deriving Repr, DecidableEq

end Sprout.Application
