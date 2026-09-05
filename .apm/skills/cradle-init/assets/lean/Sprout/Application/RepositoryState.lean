/-
  更新系の観測モデル — Repository の論理状態（observable semantics）と ID の泉。
  表現はリスト（並びが業務の情報）。不変条件は per-Root の valid。
-/
import Sprout.Prelude
import Sprout.Domain.Entity.Note

namespace Sprout.Application

open Sprout Sprout.Domain Sprout.Prelude

/-! ### メモのコレクション -/

@[repositoryState]
structure NoteRepositoryState (NoteId UserId : Type) where
  notes : List (Note NoteId UserId)
deriving Repr, DecidableEq

variable {NoteId UserId : Type}

def NoteRepositoryState.find? [DecidableEq NoteId] (s : NoteRepositoryState NoteId UserId)
    (id : NoteId) : Option (Note NoteId UserId) :=
  s.notes.find? (fun n => n.id == id)

def NoteRepositoryState.ids (s : NoteRepositoryState NoteId UserId) : List NoteId :=
  s.notes.map (·.id)

/-- 同一性は重複しない。 -/
def NoteRepositoryState.valid [DecidableEq NoteId] (s : NoteRepositoryState NoteId UserId) : Bool :=
  decide s.ids.Nodup

/-- 末尾に足す（書かれた順が並びに残る）。 -/
def NoteRepositoryState.add (s : NoteRepositoryState NoteId UserId) (n : Note NoteId UserId) :
    NoteRepositoryState NoteId UserId := ⟨s.notes ++ [n]⟩

/-- 1 件を差し替える（同一性を変えない操作にのみ使う）。**消す操作は無い**。 -/
def NoteRepositoryState.update [DecidableEq NoteId] (s : NoteRepositoryState NoteId UserId)
    (id : NoteId) (f : Note NoteId UserId → Note NoteId UserId) : NoteRepositoryState NoteId UserId :=
  ⟨updateWhere (fun n => n.id == id) f s.notes⟩

@[simp] theorem NoteRepositoryState.add_ids (s : NoteRepositoryState NoteId UserId)
    (n : Note NoteId UserId) : (s.add n).ids = s.ids ++ [n.id] := by
  simp [NoteRepositoryState.add, NoteRepositoryState.ids]

theorem NoteRepositoryState.add_valid [DecidableEq NoteId] (s : NoteRepositoryState NoteId UserId)
    (n : Note NoteId UserId) (hfresh : n.id ∉ s.ids) (h : s.valid = true) : (s.add n).valid = true := by
  simp only [NoteRepositoryState.valid, decide_eq_true_eq] at h ⊢
  rw [NoteRepositoryState.add_ids, nodup_append_one]
  exact ⟨h, hfresh⟩

theorem NoteRepositoryState.update_ids [DecidableEq NoteId] (s : NoteRepositoryState NoteId UserId)
    (id : NoteId) (f : Note NoteId UserId → Note NoteId UserId) (hf : ∀ n, (f n).id = n.id) :
    (s.update id f).ids = s.ids :=
  updateWhere_map_of_key _ _ _ hf _

theorem NoteRepositoryState.update_valid [DecidableEq NoteId] (s : NoteRepositoryState NoteId UserId)
    (id : NoteId) (f : Note NoteId UserId → Note NoteId UserId) (hf : ∀ n, (f n).id = n.id)
    (h : s.valid = true) : (s.update id f).valid = true := by
  simp only [NoteRepositoryState.valid, NoteRepositoryState.update_ids s id f hf]
  exact h

/-! ### ID の泉（採番ポートの抽象） -/

/-- 泉: 生成器状態 σ から値 α を汲み、次の状態へ進める。具体化は境界（Runtime/Ids.lean）。 -/
structure Fountain (σ α : Type) where
  step : σ → α × σ

def Fountain.valueAt {σ α : Type} (f : Fountain σ α) (s : σ) : α := (f.step s).1
def Fountain.next {σ α : Type} (f : Fountain σ α) (s : σ) : σ := (f.step s).2

/-- 新鮮性: 汲んだ値は既に使われている同一性と衝突しない（fixture の構築義務）。 -/
def Fountain.Fresh {σ α : Type} (f : Fountain σ α) (s : σ) (used : List α) : Prop :=
  f.valueAt s ∉ used

/-- メモの採番（NoteIdGenerator ポート）のカウンタ具体化の論理状態: 次に配る値。 -/
@[repositoryState]
structure NoteIdGeneratorState where
  next : Nat
deriving Repr, DecidableEq, Inhabited

end Sprout.Application
