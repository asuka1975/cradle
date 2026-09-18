/-
  書き込みモデル → 見え方の射影（Entity を読んでよい読み側）。この素材は参照系 UseCase を持たず、画面の口は射影そのもの。
  ここに @[contract] は付けない — 読取モデル（Row の structure）が無いので射影として抽出されず、付けた契約は未 emit となって生成が失敗する。
-/
import Lobby.Application.View
import Lobby.Application.RepositoryState

namespace Lobby.Application

open Lobby Lobby.Domain

variable {VisitId EmployeeId PaymentAttemptId : Type}

def toVisitView (v : Visit VisitId EmployeeId) : VisitView VisitId EmployeeId :=
  { id := v.id, host := v.host, hostName := v.hostName, visitor := v.visitor.text, phase := v.phase }

/-- 来訪の一覧（受け付けた順のまま）。 -/
def visitViews (s : VisitRepositoryState VisitId EmployeeId) : List (VisitView VisitId EmployeeId) :=
  s.visits.map toVisitView

def toPaymentView (a : PaymentAttempt PaymentAttemptId VisitId) : PaymentView PaymentAttemptId VisitId :=
  { id := a.id, visit := a.visit, amount := a.amount, tries := a.tries, phase := a.phase }

/-- 決済の試みの一覧（始めた順のまま）。 -/
def paymentViews (s : PaymentAttemptRepositoryState PaymentAttemptId VisitId) :
    List (PaymentView PaymentAttemptId VisitId) :=
  s.attempts.map toPaymentView

end Lobby.Application
