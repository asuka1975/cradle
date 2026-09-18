/-
  来訪を受け付ける — 外部能力の Port（社員ディレクトリ）を使う更新系。固定形は lean-conventions §4b。
-/
import Lobby.Application.ActorContext
import Lobby.Application.RepositoryState
import Lobby.Application.Port.OrganizationDirectory.FindMember
import Lobby.Domain.Error
import Lobby.Application.UseCase.BookVisitUseCase.Command

set_option linter.unusedSectionVars false

namespace Lobby.Application.BookVisitUseCase

open Lobby Lobby.Domain Lobby.Application
open Lobby.Application.Port.OrganizationDirectory

variable {VisitId EmployeeId UserId G : Type}

structure State (VisitId EmployeeId G : Type) where
  visits   : VisitRepositoryState VisitId EmployeeId
  /-- 来訪の泉の生成器状態（表現は境界が決める）。 -/
  visitIds : G
deriving Repr, DecidableEq

/-- 解決の成果物: ロビーが空いている証拠（値は運ばない）。 -/
structure Vacant (before : State VisitId EmployeeId G) : Type where
  vacant : before.visits.vacant = true

/-- 始まる前の拒否: 来訪者の名前が空なら受け付けない、受付中の来訪があれば受け付けない。 -/
def validate (_actor : ActorContext UserId) (c : Command EmployeeId) (before : State VisitId EmployeeId G) :
    Except DomainError (Vacant before) :=
  if !c.visitor.valid then .error .emptyVisitor
  else if h : before.visits.vacant = true then .ok ⟨h⟩
  else .error .lobbyOccupied

/-- 要求の組み立て: 受入担当者をディレクトリで引く。 -/
def mkRequest (c : Command EmployeeId) (_before : State VisitId EmployeeId G) (_v : Vacant _before) :
    FindMember.Request EmployeeId :=
  ⟨c.host⟩

/-- 外部への要求を決める（validate が通ったときだけ要求がある）。 -/
def request (actor : ActorContext UserId) (c : Command EmployeeId) (before : State VisitId EmployeeId G) :
    Except DomainError (FindMember.Request EmployeeId) :=
  (validate actor c before).map (mkRequest c before)

/-- 観測を受けて確定する: 見つかって在籍なら受け付ける。いない・答えない・在籍でないは業務の拒否。 -/
def apply (_actor : ActorContext UserId) (fountain : Fountain G VisitId) (outcome : FindMember.Outcome)
    (c : Command EmployeeId) (before : State VisitId EmployeeId G)
    (hfresh : fountain.Fresh before.visitIds before.visits.ids) (v : Vacant before) :
    Except DomainError (State VisitId EmployeeId G) :=
  match outcome with
  | .missing => .error .hostMissing
  | .unavailable => .error .directoryUnavailable
  | .found m =>
    if m.active then
      .ok { visits   := before.visits.add (Visit.book (fountain.valueAt before.visitIds) c.host m.name c.visitor) hfresh v.vacant,
            visitIds := fountain.next before.visitIds }
    else .error .hostInactive

/-- execute は validate を通してから観測を適用する。 -/
def execute (actor : ActorContext UserId) (fountain : Fountain G VisitId) (outcome : FindMember.Outcome)
    (c : Command EmployeeId) (before : State VisitId EmployeeId G)
    (hfresh : fountain.Fresh before.visitIds before.visits.ids) :
    Except DomainError (State VisitId EmployeeId G) :=
  (validate actor c before) >>= apply actor fountain outcome c before hfresh

/-- 受入担当者を確認した後、来訪の保存で技術的障害が起きたら、来訪も採番も残らない（観測される状態は作用前のまま）。 -/
@[faultContract] def savingFailed (_actor : ActorContext UserId) (_fountain : Fountain G VisitId)
    (_outcome : FindMember.Outcome) (_c : Command EmployeeId) (before : State VisitId EmployeeId G)
    (_hfresh : _fountain.Fresh before.visitIds before.visits.ids) : State VisitId EmployeeId G :=
  before

/-! ### 契約定理 -/

/-- 来訪者の名前が空なら、どの観測でも受け付けない（外部は呼ばれない）。 -/
@[contract] theorem execute_empty_visitor (actor : ActorContext UserId) (fountain : Fountain G VisitId)
    (outcome : FindMember.Outcome) (c : Command EmployeeId) (before : State VisitId EmployeeId G)
    (hfresh : fountain.Fresh before.visitIds before.visits.ids) (h : c.visitor.valid = false) :
    execute actor fountain outcome c before hfresh = .error .emptyVisitor := by
  simp [execute, validate, h, Bind.bind, Except.bind]

/-- 受付中の来訪があれば、どの観測でも受け付けない。 -/
@[contract] theorem execute_occupied (actor : ActorContext UserId) (fountain : Fountain G VisitId)
    (outcome : FindMember.Outcome) (c : Command EmployeeId) (before : State VisitId EmployeeId G)
    (hfresh : fountain.Fresh before.visitIds before.visits.ids) (hv : c.visitor.valid = true)
    (ho : before.visits.vacant = false) :
    execute actor fountain outcome c before hfresh = .error .lobbyOccupied := by
  simp [execute, validate, hv, ho, Bind.bind, Except.bind]

/-- 受入担当者がいなければ受け付けない。 -/
@[contract] theorem execute_host_missing (actor : ActorContext UserId) (fountain : Fountain G VisitId)
    (c : Command EmployeeId) (before : State VisitId EmployeeId G)
    (hfresh : fountain.Fresh before.visitIds before.visits.ids) (hv : c.visitor.valid = true)
    (hvac : before.visits.vacant = true) :
    execute actor fountain .missing c before hfresh = .error .hostMissing := by
  simp [execute, validate, apply, hv, hvac, Bind.bind, Except.bind]

/-- ディレクトリが答えなければ受け付けない（いないのとは別の拒否）。 -/
@[contract] theorem execute_directory_unavailable (actor : ActorContext UserId) (fountain : Fountain G VisitId)
    (c : Command EmployeeId) (before : State VisitId EmployeeId G)
    (hfresh : fountain.Fresh before.visitIds before.visits.ids) (hv : c.visitor.valid = true)
    (hvac : before.visits.vacant = true) :
    execute actor fountain .unavailable c before hfresh = .error .directoryUnavailable := by
  simp [execute, validate, apply, hv, hvac, Bind.bind, Except.bind]

/-- 在籍していない受入担当者では受け付けない。 -/
@[contract] theorem execute_host_inactive (actor : ActorContext UserId) (fountain : Fountain G VisitId)
    (m : FindMember.Member) (c : Command EmployeeId) (before : State VisitId EmployeeId G)
    (hfresh : fountain.Fresh before.visitIds before.visits.ids) (hv : c.visitor.valid = true)
    (hvac : before.visits.vacant = true) (hm : m.active = false) :
    execute actor fountain (.found m) c before hfresh = .error .hostInactive := by
  simp [execute, validate, apply, hv, hvac, hm, Bind.bind, Except.bind]

/-- 見つかって在籍なら受け付ける。 -/
@[contract] theorem execute_ok (actor : ActorContext UserId) (fountain : Fountain G VisitId)
    (m : FindMember.Member) (c : Command EmployeeId) (before : State VisitId EmployeeId G)
    (hfresh : fountain.Fresh before.visitIds before.visits.ids) (hv : c.visitor.valid = true)
    (hvac : before.visits.vacant = true) (hm : m.active = true) :
    execute actor fountain (.found m) c before hfresh =
      .ok { visits   := before.visits.add (Visit.book (fountain.valueAt before.visitIds) c.host m.name c.visitor) hfresh hvac,
            visitIds := fountain.next before.visitIds } := by
  simp [execute, validate, apply, hv, hvac, hm, Bind.bind, Except.bind]

/-- 要求は validate が通ったときだけあり、受入担当者を指す。@[contract] は付けない — 要求の値は execute の契約ケースがモックで検査する。 -/
theorem request_ok (actor : ActorContext UserId) (c : Command EmployeeId)
    (before : State VisitId EmployeeId G) (hv : c.visitor.valid = true) (hvac : before.visits.vacant = true) :
    request actor c before = .ok ⟨c.host⟩ := by
  simp [request, validate, mkRequest, hv, hvac, Except.map]

/-- 成功したら、その結果は apply の形（境界の可到達性が使う）。 -/
theorem execute_ok_shape (actor : ActorContext UserId) (fountain : Fountain G VisitId)
    (outcome : FindMember.Outcome) (c : Command EmployeeId) (before after : State VisitId EmployeeId G)
    (hfresh : fountain.Fresh before.visitIds before.visits.ids)
    (h : execute actor fountain outcome c before hfresh = .ok after) :
    ∃ v, apply actor fountain outcome c before hfresh v = .ok after := by
  unfold execute at h
  cases hv : validate actor c before with
  | error e => rw [hv] at h; cases h
  | ok v => rw [hv] at h; exact ⟨v, h⟩

end Lobby.Application.BookVisitUseCase
