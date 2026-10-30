/-
  観測モデル — 本の Repository の論理状態。同一性の一意性は Prop フィールド。
-/
import Mini.Prelude
import Mini.Domain.Entity.Book

namespace Mini.Application

open Mini Mini.Domain Mini.Prelude

@[repositoryState]
structure BookRepositoryState (BookId : Type) where
  books : List (Book BookId)
  /-- 同一性は重複しない。 -/
  uniqueIds : (books.map (·.id)).Nodup
deriving Repr, DecidableEq

variable {BookId : Type}

def BookRepositoryState.find? [DecidableEq BookId] (s : BookRepositoryState BookId) (id : BookId) :
    Option (Book BookId) :=
  s.books.find? (fun b => b.id == id)

def BookRepositoryState.ids (s : BookRepositoryState BookId) : List BookId :=
  s.books.map (·.id)

/-- 末尾に足す（棚に並べた順が並びに残る）。受け付けるのは新鮮な同一性だけ。 -/
def BookRepositoryState.add (s : BookRepositoryState BookId) (b : Book BookId) (hfresh : b.id ∉ s.ids) :
    BookRepositoryState BookId :=
  ⟨s.books ++ [b], by
    rw [List.map_append, List.map_cons, List.map_nil, nodup_append_one]
    exact ⟨s.uniqueIds, hfresh⟩⟩

/-- 1 件を差し替える。同一性を変えない操作にのみ使う。**消す操作は無い**。 -/
def BookRepositoryState.update [DecidableEq BookId] (s : BookRepositoryState BookId) (id : BookId)
    (f : Book BookId → Book BookId) (hf : ∀ b, (f b).id = b.id) : BookRepositoryState BookId :=
  ⟨updateWhere (fun b => b.id == id) f s.books, by
    rw [updateWhere_map_of_key (fun b => b.id == id) f (fun b => b.id) hf s.books]
    exact s.uniqueIds⟩

end Mini.Application
