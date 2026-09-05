/-
  メモを書く — 更新系 UseCase の固定形（validate / execute）。
  State はこの UseCase が観測できる世界の最小射影（Effect Set）。
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

def State.valid [DecidableEq NoteId] (s : State NoteId UserId G) : Bool := s.notes.valid

/-- 始まる前の拒否: 題が空なら書けない。新規追加なので解決の成果物は無い（Unit）。 -/
def validate (_actor : ActorContext UserId) (c : Command) (_before : State NoteId UserId G) :
    Except DomainError Unit :=
  if c.title.valid then .ok () else .error .emptyTitle

/-- 解釈: 泉から同一性を汲んで末尾に足す。 -/
def act (actor : ActorContext UserId) (fountain : Fountain G NoteId) (c : Command)
    (before : State NoteId UserId G) (_ : Unit) : State NoteId UserId G :=
  { notes   := before.notes.add (Note.post (fountain.valueAt before.noteIds) actor.user c.title),
    noteIds := fountain.next before.noteIds }

/-- execute は validate を呼ぶ定義（入り口の一致は定義の系）。 -/
def execute (actor : ActorContext UserId) (fountain : Fountain G NoteId) (c : Command)
    (before : State NoteId UserId G) : Except DomainError (State NoteId UserId G) :=
  (validate actor c before).map (act actor fountain c before)

/-! ### 契約定理 -/

@[contract] theorem execute_invalid (actor : ActorContext UserId) (fountain : Fountain G NoteId)
    (c : Command) (before : State NoteId UserId G) (h : c.title.valid = false) :
    execute actor fountain c before = .error .emptyTitle := by
  simp [execute, validate, h, Except.map]

@[contract] theorem execute_ok (actor : ActorContext UserId) (fountain : Fountain G NoteId)
    (c : Command) (before : State NoteId UserId G) (h : c.title.valid = true) :
    execute actor fountain c before = .ok (act actor fountain c before ()) := by
  simp [execute, validate, h, Except.map]

/-- 成功したら、その結果は act の形（境界の可到達性が使う）。 -/
theorem execute_ok_shape (actor : ActorContext UserId) (fountain : Fountain G NoteId)
    (c : Command) (before after : State NoteId UserId G)
    (h : execute actor fountain c before = .ok after) : after = act actor fountain c before () := by
  by_cases hv : c.title.valid = true
  · rw [execute_ok actor fountain c before hv] at h
    injection h with h
    exact h.symm
  · rw [Bool.not_eq_true] at hv
    rw [execute_invalid actor fountain c before hv] at h
    cases h

/-- メモは末尾に足される（書かれた順 = コレクションの並び）。 -/
@[contract] theorem act_appends (actor : ActorContext UserId) (fountain : Fountain G NoteId)
    (c : Command) (before : State NoteId UserId G) :
    (act actor fountain c before ()).notes.notes =
      before.notes.notes ++ [Note.post (fountain.valueAt before.noteIds) actor.user c.title] := rfl

/-- 泉を 1 つ消費する（採番の消費は契約 — golden が守る）。 -/
@[contract] theorem act_consumes_fountain (actor : ActorContext UserId) (fountain : Fountain G NoteId)
    (c : Command) (before : State NoteId UserId G) :
    (act actor fountain c before ()).noteIds = fountain.next before.noteIds := rfl

/-- 妥当性の保存: 泉が新鮮なら同一性の一意性は保たれる。 -/
theorem act_preserves_valid [DecidableEq NoteId] (actor : ActorContext UserId)
    (fountain : Fountain G NoteId) (c : Command) (before : State NoteId UserId G)
    (hf : fountain.Fresh before.noteIds before.notes.ids) (hv : before.valid = true) :
    (act actor fountain c before ()).valid = true :=
  NoteRepositoryState.add_valid before.notes _ hf hv

end Sprout.Application.PostNoteUseCase
