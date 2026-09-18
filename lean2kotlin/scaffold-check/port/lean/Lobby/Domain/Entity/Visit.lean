/-
  来訪 — 具体構造体 + ふるまいの def + @[contract] 定理群。
-/
import Lobby.Domain.Annotations
import Lobby.Domain.ValueObject

namespace Lobby.Domain

open Lobby

/-- 来訪。受入担当者の名前はディレクトリで確認した時点の写し。 -/
@[aggregateRoot]
structure Visit (VisitId EmployeeId : Type) where
  id       : VisitId
  host     : EmployeeId
  hostName : String
  visitor  : VisitorName
  phase    : VisitPhase
deriving Repr, DecidableEq

variable {VisitId EmployeeId : Type}

/-- 受け付ける（採番は呼び出し側の関心）。 -/
def Visit.book (id : VisitId) (host : EmployeeId) (hostName : String) (visitor : VisitorName) :
    Visit VisitId EmployeeId :=
  { id, host, hostName, visitor, phase := .expected }

/-- 退出する。 -/
def Visit.leave (v : Visit VisitId EmployeeId) : Visit VisitId EmployeeId := { v with phase := .left }

def Visit.isExpected (v : Visit VisitId EmployeeId) : Bool := v.phase == .expected

/-- 受け付けた直後は受付中。 -/
@[contract] theorem Visit.book_expected (id : VisitId) (h : EmployeeId) (hn : String) (n : VisitorName) :
    (Visit.book id h hn n).isExpected = true := rfl

/-- 退出しても同一性は変わらない。 -/
@[contract] theorem Visit.leave_id (v : Visit VisitId EmployeeId) : v.leave.id = v.id := rfl

/-- 退出したら退出済み。 -/
@[contract] theorem Visit.leave_phase (v : Visit VisitId EmployeeId) : v.leave.phase = .left := rfl

/-- 退出は冪等。 -/
@[contract] theorem Visit.leave_idem (v : Visit VisitId EmployeeId) : v.leave.leave = v.leave := rfl

end Lobby.Domain
