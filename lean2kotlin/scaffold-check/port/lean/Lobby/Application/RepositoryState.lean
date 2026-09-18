/-
  観測モデル — 来訪の Repository の論理状態と ID の泉。
  集約ルートが大域的に満たす制約は Prop フィールド: 同一性の一意性と「受付中の来訪は高々 1 件」（ロビーはひと組ずつ）。
-/
import Lobby.Prelude
import Lobby.Domain.Entity.Visit

namespace Lobby.Application

open Lobby Lobby.Domain Lobby.Prelude

@[repositoryState]
structure VisitRepositoryState (VisitId EmployeeId : Type) where
  visits : List (Visit VisitId EmployeeId)
  /-- 同一性は重複しない。 -/
  uniqueIds : (visits.map (·.id)).Nodup
  /-- ロビーはひと組ずつ受け入れる。 -/
  atMostOneExpected : (visits.filter (fun v => v.phase != .left)).length ≤ 1
deriving Repr, DecidableEq

variable {VisitId EmployeeId : Type}

def VisitRepositoryState.find? [DecidableEq VisitId] (s : VisitRepositoryState VisitId EmployeeId)
    (id : VisitId) : Option (Visit VisitId EmployeeId) :=
  s.visits.find? (fun v => v.id == id)

def VisitRepositoryState.ids (s : VisitRepositoryState VisitId EmployeeId) : List VisitId :=
  s.visits.map (·.id)

/-- 受付中の来訪が無い（ひと組を受け入れられる）。 -/
def VisitRepositoryState.vacant (s : VisitRepositoryState VisitId EmployeeId) : Bool :=
  decide ((s.visits.filter (fun v => v.phase != .left)).length = 0)

/-- 末尾に足す。受け付けるのは新鮮な同一性と、ロビーが空いているときだけ。 -/
def VisitRepositoryState.add (s : VisitRepositoryState VisitId EmployeeId) (v : Visit VisitId EmployeeId)
    (hfresh : v.id ∉ s.ids) (hvacant : s.vacant = true) : VisitRepositoryState VisitId EmployeeId :=
  ⟨s.visits ++ [v], by
    rw [List.map_append, List.map_cons, List.map_nil, nodup_append_one]
    exact ⟨s.uniqueIds, hfresh⟩, by
    simp only [VisitRepositoryState.vacant, decide_eq_true_eq] at hvacant
    exact filter_length_append_one_le _ _ _ hvacant⟩

/-- 1 件を差し替える。同一性を変えず、受付中を増やさない操作にのみ使う。**消す操作は無い**。 -/
def VisitRepositoryState.update [DecidableEq VisitId] (s : VisitRepositoryState VisitId EmployeeId)
    (id : VisitId) (f : Visit VisitId EmployeeId → Visit VisitId EmployeeId)
    (hf : ∀ v, (f v).id = v.id)
    (hp : ∀ v, ((f v).phase != .left) = true → (v.phase != .left) = true) :
    VisitRepositoryState VisitId EmployeeId :=
  ⟨updateWhere (fun v => v.id == id) f s.visits, by
    rw [updateWhere_map_of_key (fun v => v.id == id) f (fun v => v.id) hf s.visits]
    exact s.uniqueIds, by
    exact Nat.le_trans (filter_length_updateWhere_le _ _ f s.visits hp) s.atMostOneExpected⟩

theorem VisitRepositoryState.update_ids [DecidableEq VisitId] (s : VisitRepositoryState VisitId EmployeeId)
    (id : VisitId) (f : Visit VisitId EmployeeId → Visit VisitId EmployeeId) (hf : ∀ v, (f v).id = v.id)
    (hp : ∀ v, ((f v).phase != .left) = true → (v.phase != .left) = true) :
    (s.update id f hf hp).ids = s.ids :=
  updateWhere_map_of_key _ _ _ hf _

/-! ### ID の泉 -/

structure Fountain (σ α : Type) where
  step : σ → α × σ

def Fountain.valueAt {σ α : Type} (f : Fountain σ α) (s : σ) : α := (f.step s).1
def Fountain.next {σ α : Type} (f : Fountain σ α) (s : σ) : σ := (f.step s).2

abbrev Fountain.Fresh {σ α : Type} (f : Fountain σ α) (s : σ) (used : List α) : Prop :=
  f.valueAt s ∉ used

/-- 来訪の採番（VisitIdGenerator ポート）のカウンタ具体化の論理状態: 次に配る値。 -/
@[repositoryState]
structure VisitIdGeneratorState where
  next : Nat
deriving Repr, DecidableEq, Inhabited

end Lobby.Application
