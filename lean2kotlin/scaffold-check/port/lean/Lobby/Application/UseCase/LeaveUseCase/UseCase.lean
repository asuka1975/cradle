/-
  退出する — 既存の集約を変更する更新系（Port は使わない）。validate は宛先を解決し、作用対象を返す。
-/
import Lobby.Application.ActorContext
import Lobby.Application.RepositoryState
import Lobby.Domain.Error
import Lobby.Application.UseCase.LeaveUseCase.Command

set_option linter.unusedSectionVars false

namespace Lobby.Application.LeaveUseCase

open Lobby Lobby.Domain Lobby.Application

variable {VisitId EmployeeId UserId : Type} [DecidableEq VisitId]

/-- 始まる前の拒否: 宛先が無い / もう退出している。 -/
def validate (_actor : ActorContext UserId) (c : Command VisitId)
    (before : VisitRepositoryState VisitId EmployeeId) : Except DomainError (Visit VisitId EmployeeId) :=
  match before.find? c.visit with
  | none   => .error .unknownVisit
  | some v => if v.phase == .left then .error .alreadyLeft else .ok v

/-- 退出は受付中を増やさない。 -/
theorem leave_not_expected (v : Visit VisitId EmployeeId) :
    (v.leave.phase != .left) = true → (v.phase != .left) = true := by
  simp [Visit.leave]

def act (c : Command VisitId) (before : VisitRepositoryState VisitId EmployeeId) (_v : Visit VisitId EmployeeId) :
    VisitRepositoryState VisitId EmployeeId :=
  before.update c.visit Visit.leave (fun _ => rfl) leave_not_expected

def execute (actor : ActorContext UserId) (c : Command VisitId)
    (before : VisitRepositoryState VisitId EmployeeId) : Except DomainError (VisitRepositoryState VisitId EmployeeId) :=
  (validate actor c before).map (act c before)

@[contract] theorem execute_unknown (actor : ActorContext UserId) (c : Command VisitId)
    (before : VisitRepositoryState VisitId EmployeeId) (h : before.find? c.visit = none) :
    execute actor c before = .error .unknownVisit := by
  simp [execute, validate, h, Except.map]

@[contract] theorem execute_already_left (actor : ActorContext UserId) (c : Command VisitId)
    (before : VisitRepositoryState VisitId EmployeeId) (v : Visit VisitId EmployeeId)
    (h : before.find? c.visit = some v) (hl : (v.phase == .left) = true) :
    execute actor c before = .error .alreadyLeft := by
  simp [execute, validate, h, hl, Except.map]

@[contract] theorem execute_ok (actor : ActorContext UserId) (c : Command VisitId)
    (before : VisitRepositoryState VisitId EmployeeId) (v : Visit VisitId EmployeeId)
    (h : before.find? c.visit = some v) (hl : (v.phase == .left) = false) :
    execute actor c before = .ok (act c before v) := by
  simp [execute, validate, h, hl, Except.map]

end Lobby.Application.LeaveUseCase
