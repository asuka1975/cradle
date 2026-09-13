/-
  メモを書く — 更新系 UseCase の固定形（validate / execute）。
  State はこの UseCase が観測できる世界の最小射影（Effect Set）。
  泉の新鮮性（ポートの契約）は Prop 引数で受け、題が空いている証拠は validate が解決の成果物として返す。
-/
import Sprout.Application.ActorContext
import Sprout.Application.RepositoryState
import Sprout.Domain.Error
import Sprout.Application.UseCase.PostNoteUseCase.Command

set_option linter.unusedSectionVars false

namespace Sprout.Application.PostNoteUseCase

open Sprout Sprout.Domain Sprout.Application

variable {NoteId UserId G : Type}

structure State (NoteId UserId G : Type) where
  notes   : NoteRepositoryState NoteId UserId
  /-- メモの泉の生成器状態（表現は境界が決める）。 -/
  noteIds : G
deriving Repr, DecidableEq

/-- 解決の成果物: 題が空いている証拠（値は運ばない）。 -/
structure FreeTitle (c : Command) (before : State NoteId UserId G) : Type where
  free : c.title ∉ before.notes.titles

/-- 始まる前の拒否: 題が空なら書けない、同じ題がもうあるなら書けない。成功なら題が空いている証拠を返す。 -/
def validate (_actor : ActorContext UserId) (c : Command) (before : State NoteId UserId G) :
    Except DomainError (FreeTitle c before) :=
  if !c.title.valid then .error .emptyTitle
  else if h : c.title ∈ before.notes.titles then .error .titleTaken
  else .ok ⟨h⟩

/-- 解釈: 泉から同一性を汲んで末尾に足す。 -/
def act (actor : ActorContext UserId) (fountain : Fountain G NoteId) (c : Command)
    (before : State NoteId UserId G) (hfresh : fountain.Fresh before.noteIds before.notes.ids)
    (free : FreeTitle c before) : State NoteId UserId G :=
  { notes   := before.notes.add (Note.post (fountain.valueAt before.noteIds) actor.user c.title) hfresh free.free,
    noteIds := fountain.next before.noteIds }

/-- execute は validate を呼ぶ定義（入り口の一致は定義の系）。 -/
def execute (actor : ActorContext UserId) (fountain : Fountain G NoteId) (c : Command)
    (before : State NoteId UserId G) (hfresh : fountain.Fresh before.noteIds before.notes.ids) :
    Except DomainError (State NoteId UserId G) :=
  (validate actor c before).map (act actor fountain c before hfresh)

/-! ### 契約定理 -/

@[contract] theorem execute_invalid (actor : ActorContext UserId) (fountain : Fountain G NoteId)
    (c : Command) (before : State NoteId UserId G)
    (hfresh : fountain.Fresh before.noteIds before.notes.ids) (h : c.title.valid = false) :
    execute actor fountain c before hfresh = .error .emptyTitle := by
  simp [execute, validate, h, Except.map]

/-- 同じ題のメモがもうあれば書けない。 -/
@[contract] theorem execute_title_taken (actor : ActorContext UserId) (fountain : Fountain G NoteId)
    (c : Command) (before : State NoteId UserId G)
    (hfresh : fountain.Fresh before.noteIds before.notes.ids) (hv : c.title.valid = true)
    (ht : c.title ∈ before.notes.titles) :
    execute actor fountain c before hfresh = .error .titleTaken := by
  simp [execute, validate, hv, ht, Except.map]

@[contract] theorem execute_ok (actor : ActorContext UserId) (fountain : Fountain G NoteId)
    (c : Command) (before : State NoteId UserId G)
    (hfresh : fountain.Fresh before.noteIds before.notes.ids) (hv : c.title.valid = true)
    (ht : c.title ∉ before.notes.titles) :
    execute actor fountain c before hfresh = .ok (act actor fountain c before hfresh ⟨ht⟩) := by
  simp [execute, validate, hv, ht, Except.map]

/-- 成功したら、その結果は act の形（境界の可到達性が使う）。 -/
theorem execute_ok_shape (actor : ActorContext UserId) (fountain : Fountain G NoteId)
    (c : Command) (before after : State NoteId UserId G)
    (hfresh : fountain.Fresh before.noteIds before.notes.ids)
    (h : execute actor fountain c before hfresh = .ok after) :
    ∃ free, after = act actor fountain c before hfresh free := by
  unfold execute at h
  cases hv : validate actor c before with
  | error e => rw [hv] at h; cases h
  | ok free => rw [hv] at h; injection h with h; exact ⟨free, h.symm⟩

/-- メモは末尾に足される（書かれた順 = コレクションの並び）。 -/
@[contract] theorem act_appends (actor : ActorContext UserId) (fountain : Fountain G NoteId)
    (c : Command) (before : State NoteId UserId G)
    (hfresh : fountain.Fresh before.noteIds before.notes.ids) (free : FreeTitle c before) :
    (act actor fountain c before hfresh free).notes.notes =
      before.notes.notes ++ [Note.post (fountain.valueAt before.noteIds) actor.user c.title] := rfl

/-- 泉を 1 つ消費する（採番の消費は契約 — golden が守る）。 -/
@[contract] theorem act_consumes_fountain (actor : ActorContext UserId) (fountain : Fountain G NoteId)
    (c : Command) (before : State NoteId UserId G)
    (hfresh : fountain.Fresh before.noteIds before.notes.ids) (free : FreeTitle c before) :
    (act actor fountain c before hfresh free).noteIds = fountain.next before.noteIds := rfl

end Sprout.Application.PostNoteUseCase
