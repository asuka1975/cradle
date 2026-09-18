/-
  コマンドの輸送形式（合併型）。各 UseCase の Command を**そのまま**運ぶ。名義（actor）はコマンドの中にいない。

  ## ここに**存在しない**操作（反機能の一覧）
  - 決済の結果を利用者が確定する操作: 結果は提供元の通知（内部入力 `Runtime/Observation.lean`）が運ぶ。
  - 決済を送る・照会する操作: 内部の配送（worker / timer の契機）であって利用者の操作ではない。
-/
import Lobby.Runtime.Ids
import Lobby.Application.ActorContext
import Lobby.Application.UseCase.BookVisitUseCase.Command
import Lobby.Application.UseCase.LeaveUseCase.Command
import Lobby.Application.UseCase.StartPaymentUseCase.Command

namespace Lobby.Runtime

open Lobby Lobby.Application

/-- 名義（境界が受け取る実行文脈）。 -/
structure Actor where
  context : ActorContext UserId
deriving Repr, DecidableEq

inductive Command where
  /-- 来訪を受け付ける（社員ディレクトリを引く）。 -/
  | bookVisit (c : BookVisitUseCase.Command EmployeeId)
  /-- 退出する。 -/
  | leave (c : LeaveUseCase.Command VisitId)
  /-- 精算を始める。 -/
  | startPayment (c : StartPaymentUseCase.Command VisitId)
deriving Repr, DecidableEq

end Lobby.Runtime
