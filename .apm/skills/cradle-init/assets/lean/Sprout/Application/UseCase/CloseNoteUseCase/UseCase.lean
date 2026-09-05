/-
  メモを閉じる — 既存の集約を変更する更新系。validate は宛先を解決し、作用対象（メモ）を返す。
-/
import Sprout.Application.ActorContext
import Sprout.Application.RepositoryState
import Sprout.Domain.Error
import Sprout.Application.UseCase.CloseNoteUseCase.Command

set_option linter.unusedSectionVars false

namespace Sprout.Application.CloseNoteUseCase

open Sprout Sprout.Domain Sprout.Application

variable {NoteId UserId : Type} [DecidableEq NoteId] [DecidableEq UserId]

/-- 始まる前の拒否: 宛先が無い / 書いた本人でない / もう閉じている。成功なら作用対象を返す。 -/
def validate (actor : ActorContext UserId) (c : Command NoteId)
    (before : NoteRepositoryState NoteId UserId) : Except DomainError (Note NoteId UserId) :=
  match before.find? c.note with
  | none   => .error .unknownNote
  | some n =>
    if n.author == actor.user then
      (if n.closed then .error .alreadyClosed else .ok n)
    else .error .notAuthor

/-- 解釈: Entity のふるまいの適用一発。 -/
def act (c : Command NoteId) (before : NoteRepositoryState NoteId UserId) (_n : Note NoteId UserId) :
    NoteRepositoryState NoteId UserId :=
  before.update c.note Note.close

def execute (actor : ActorContext UserId) (c : Command NoteId)
    (before : NoteRepositoryState NoteId UserId) : Except DomainError (NoteRepositoryState NoteId UserId) :=
  (validate actor c before).map (act c before)

/-! ### 契約定理（エラー枝 1 本 = 定理 1 本） -/

@[contract] theorem execute_unknown (actor : ActorContext UserId) (c : Command NoteId)
    (before : NoteRepositoryState NoteId UserId) (h : before.find? c.note = none) :
    execute actor c before = .error .unknownNote := by
  simp [execute, validate, h, Except.map]

@[contract] theorem execute_not_author (actor : ActorContext UserId) (c : Command NoteId)
    (before : NoteRepositoryState NoteId UserId) (n : Note NoteId UserId)
    (h : before.find? c.note = some n) (ha : (n.author == actor.user) = false) :
    execute actor c before = .error .notAuthor := by
  simp [execute, validate, h, ha, Except.map]

@[contract] theorem execute_already_closed (actor : ActorContext UserId) (c : Command NoteId)
    (before : NoteRepositoryState NoteId UserId) (n : Note NoteId UserId)
    (h : before.find? c.note = some n) (ha : (n.author == actor.user) = true) (hc : n.closed = true) :
    execute actor c before = .error .alreadyClosed := by
  simp [execute, validate, h, ha, hc, Except.map]

@[contract] theorem execute_ok (actor : ActorContext UserId) (c : Command NoteId)
    (before : NoteRepositoryState NoteId UserId) (n : Note NoteId UserId)
    (h : before.find? c.note = some n) (ha : (n.author == actor.user) = true) (hc : n.closed = false) :
    execute actor c before = .ok (act c before n) := by
  simp [execute, validate, h, ha, hc, Except.map]

/-- 成功したら、その結果は act の形。 -/
theorem execute_ok_shape (actor : ActorContext UserId) (c : Command NoteId)
    (before after : NoteRepositoryState NoteId UserId) (h : execute actor c before = .ok after) :
    ∃ n, after = act c before n := by
  unfold execute at h
  cases hv : validate actor c before with
  | error e => rw [hv] at h; cases h
  | ok n => rw [hv] at h; injection h with h; exact ⟨n, h.symm⟩

/-- 同一性列は変わらない（フレーム — 消えない・増えない・入れ替わらない）。 -/
@[contract] theorem act_ids (c : Command NoteId) (before : NoteRepositoryState NoteId UserId)
    (n : Note NoteId UserId) : (act c before n).ids = before.ids :=
  NoteRepositoryState.update_ids before c.note Note.close (fun _ => rfl)

theorem act_preserves_valid (c : Command NoteId) (before : NoteRepositoryState NoteId UserId)
    (n : Note NoteId UserId) (hv : before.valid = true) : (act c before n).valid = true :=
  NoteRepositoryState.update_valid before c.note Note.close (fun _ => rfl) hv

end Sprout.Application.CloseNoteUseCase
