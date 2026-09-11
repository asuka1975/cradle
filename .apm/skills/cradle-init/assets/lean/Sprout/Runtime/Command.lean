/-
  コマンドの輸送形式（合併型）。各 UseCase の Command を**そのまま**運ぶ。

  ## 操作する人（actor）はコマンドの中に**いない**
  名義は境界が外から受け取り（`Actor`）、ルーティング（`Snapshot.apply`）が各 UseCase に
  実行文脈として渡す。

  ## ここに**存在しない**操作（反機能の一覧）
  documents に裏付けのない操作をこの合併型に足してはならない。現時点で意図的に存在しないもの:
  - メモの削除: 閉じたメモも記録として残る。
  - 他人のメモを閉じる: 書いた本人だけが閉じる。
  - 閉じたメモを開き直す: 開き直す出来事は業務に無い。
-/
import Sprout.Runtime.Ids
import Sprout.Application.ActorContext
import Sprout.Application.UseCase.PostNoteUseCase.Command
import Sprout.Application.UseCase.CloseNoteUseCase.Command

namespace Sprout.Runtime

open Sprout Sprout.Application

/-- 名義（境界が受け取る実行文脈）。 -/
structure Actor where
  context : ActorContext UserId
deriving Repr, DecidableEq

inductive Command where
  /-- メモを書く。 -/
  | postNote  (c : PostNoteUseCase.Command)
  /-- メモを閉じる。 -/
  | closeNote (c : CloseNoteUseCase.Command NoteId)
deriving Repr, DecidableEq

end Sprout.Runtime
