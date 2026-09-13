/-
  更新系の観測モデル — Repository の論理状態（observable semantics）と ID の泉。
  表現はリスト（並びが業務の情報）。集約ルートが大域的に満たす制約は構造体の Prop フィールド（構築時に保証される）。
-/
import Sprout.Prelude
import Sprout.Domain.Entity.Note

namespace Sprout.Application

open Sprout Sprout.Domain Sprout.Prelude

/-! ### メモのコレクション -/

@[repositoryState]
structure NoteRepositoryState (NoteId UserId : Type) where
  notes : List (Note NoteId UserId)
  /-- 同一性は重複しない。 -/
  uniqueIds : (notes.map (·.id)).Nodup
  /-- 題は重複しない。 -/
  uniqueTitles : (notes.map (·.title)).Nodup
deriving Repr, DecidableEq

variable {NoteId UserId : Type}

def NoteRepositoryState.find? [DecidableEq NoteId] (s : NoteRepositoryState NoteId UserId)
    (id : NoteId) : Option (Note NoteId UserId) :=
  s.notes.find? (fun n => n.id == id)

def NoteRepositoryState.ids (s : NoteRepositoryState NoteId UserId) : List NoteId :=
  s.notes.map (·.id)

def NoteRepositoryState.titles (s : NoteRepositoryState NoteId UserId) : List Title :=
  s.notes.map (·.title)

/-- 末尾に足す（書かれた順が並びに残る）。受け付けるのは新鮮な同一性と空いている題だけ。 -/
def NoteRepositoryState.add (s : NoteRepositoryState NoteId UserId) (n : Note NoteId UserId)
    (hfresh : n.id ∉ s.ids) (hfree : n.title ∉ s.titles) : NoteRepositoryState NoteId UserId :=
  ⟨s.notes ++ [n], by
    rw [List.map_append, List.map_cons, List.map_nil, nodup_append_one]
    exact ⟨s.uniqueIds, hfresh⟩, by
    rw [List.map_append, List.map_cons, List.map_nil, nodup_append_one]
    exact ⟨s.uniqueTitles, hfree⟩⟩

/-- 1 件を差し替える（同一性も題も変えない操作にのみ使う）。**消す操作は無い**。 -/
def NoteRepositoryState.update [DecidableEq NoteId] (s : NoteRepositoryState NoteId UserId)
    (id : NoteId) (f : Note NoteId UserId → Note NoteId UserId) (hf : ∀ n, (f n).id = n.id)
    (ht : ∀ n, (f n).title = n.title) : NoteRepositoryState NoteId UserId :=
  ⟨updateWhere (fun n => n.id == id) f s.notes, by
    rw [updateWhere_map_of_key (fun n => n.id == id) f (fun n => n.id) hf s.notes]
    exact s.uniqueIds, by
    rw [updateWhere_map_of_key (fun n => n.id == id) f (fun n => n.title) ht s.notes]
    exact s.uniqueTitles⟩

theorem NoteRepositoryState.update_ids [DecidableEq NoteId] (s : NoteRepositoryState NoteId UserId)
    (id : NoteId) (f : Note NoteId UserId → Note NoteId UserId) (hf : ∀ n, (f n).id = n.id)
    (ht : ∀ n, (f n).title = n.title) : (s.update id f hf ht).ids = s.ids :=
  updateWhere_map_of_key _ _ _ hf _

/-! ### ID の泉（採番ポートの抽象） -/

/-- 泉: 生成器状態 σ から値 α を汲み、次の状態へ進める。具体化は境界（Runtime/Ids.lean）。 -/
structure Fountain (σ α : Type) where
  step : σ → α × σ

def Fountain.valueAt {σ α : Type} (f : Fountain σ α) (s : σ) : α := (f.step s).1
def Fountain.next {σ α : Type} (f : Fountain σ α) (s : σ) : σ := (f.step s).2

/-- 新鮮性: 汲んだ値は既に使われている同一性と衝突しない。泉ポートの契約で、
    汲む UseCase は証明として受け取る（境界は `Snapshot.check` から作る）。
    abbrev なのは定義が透けて `Decidable` が付き、`decide` と境界の証明がそれに依るため。 -/
abbrev Fountain.Fresh {σ α : Type} (f : Fountain σ α) (s : σ) (used : List α) : Prop :=
  f.valueAt s ∉ used

/-- メモの採番（NoteIdGenerator ポート）のカウンタ具体化の論理状態: 次に配る値。 -/
@[repositoryState]
structure NoteIdGeneratorState where
  next : Nat
deriving Repr, DecidableEq, Inhabited

end Sprout.Application
