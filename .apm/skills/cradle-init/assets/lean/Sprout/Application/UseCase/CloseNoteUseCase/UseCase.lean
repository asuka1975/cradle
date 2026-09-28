/-
  メモを閉じる — 既存の集約を変更する更新系。validate は宛先を解決して名義を確かめ、作用対象（メモ）を返す。
  閉じられるか（もう閉じていないか）はメモ自身のふるまいが決める。
-/
import Sprout.Application.ActorContext
import Sprout.Application.RepositoryState
import Sprout.Domain.Error
import Sprout.Application.UseCase.CloseNoteUseCase.Command

set_option linter.unusedSectionVars false

namespace Sprout.Application.CloseNoteUseCase

open Sprout Sprout.Domain Sprout.Application

variable {NoteId UserId : Type} [DecidableEq NoteId] [DecidableEq UserId]

/-- 始まる前の拒否: 宛先が無い / 書いた本人でない。成功なら作用対象を返す。 -/
def validate (actor : ActorContext UserId) (c : Command NoteId)
    (before : NoteRepositoryState NoteId UserId) : Except DomainError (Note NoteId UserId) :=
  match before.find? c.note with
  | none   => .error .unknownNote
  | some n => if n.author == actor.user then .ok n else .error .notAuthor

/-- 閉じた後の観測モデル: 宛先のメモに閉じるを適用する（閉じても同一性と題は変わらないので点更新できる）。 -/
def closed (c : Command NoteId) (before : NoteRepositoryState NoteId UserId) : NoteRepositoryState NoteId UserId :=
  before.update c.note (fun m => m.close.toOption.getD m) Note.close_getD_id Note.close_getD_title

/-- 解釈: Entity のふるまいの適用一発。メモが断れば（もう閉じている）その拒否、受け入れれば点更新する。 -/
def act (c : Command NoteId) (before : NoteRepositoryState NoteId UserId) (n : Note NoteId UserId) :
    Except DomainError (NoteRepositoryState NoteId UserId) :=
  n.close.map fun _ => closed c before

def execute (actor : ActorContext UserId) (c : Command NoteId)
    (before : NoteRepositoryState NoteId UserId) : Except DomainError (NoteRepositoryState NoteId UserId) :=
  validate actor c before >>= act c before

/-! ### 契約定理（エラー枝 1 本 = 定理 1 本） -/

@[contract] theorem execute_unknown (actor : ActorContext UserId) (c : Command NoteId)
    (before : NoteRepositoryState NoteId UserId) (h : before.find? c.note = none) :
    execute actor c before = .error .unknownNote := by
  simp [execute, validate, h, bind, Except.bind]

@[contract] theorem execute_not_author (actor : ActorContext UserId) (c : Command NoteId)
    (before : NoteRepositoryState NoteId UserId) (n : Note NoteId UserId)
    (h : before.find? c.note = some n) (ha : (n.author == actor.user) = false) :
    execute actor c before = .error .notAuthor := by
  simp [execute, validate, h, ha, bind, Except.bind]

@[contract] theorem execute_already_closed (actor : ActorContext UserId) (c : Command NoteId)
    (before : NoteRepositoryState NoteId UserId) (n : Note NoteId UserId)
    (h : before.find? c.note = some n) (ha : (n.author == actor.user) = true) (hc : n.closed = true) :
    execute actor c before = .error .alreadyClosed := by
  simp [execute, validate, act, h, ha, hc, Note.close, bind, Except.bind, Except.map]

@[contract] theorem execute_ok (actor : ActorContext UserId) (c : Command NoteId)
    (before : NoteRepositoryState NoteId UserId) (n : Note NoteId UserId)
    (h : before.find? c.note = some n) (ha : (n.author == actor.user) = true) (hc : n.closed = false) :
    execute actor c before = .ok (closed c before) := by
  simp [execute, validate, act, h, ha, hc, Note.close, bind, Except.bind, Except.map]

/-- 成功したら、その結果は閉じた後の観測モデル。 -/
theorem execute_ok_shape (actor : ActorContext UserId) (c : Command NoteId)
    (before after : NoteRepositoryState NoteId UserId) (h : execute actor c before = .ok after) :
    after = closed c before := by
  unfold execute at h
  cases hv : validate actor c before with
  | error e => rw [hv] at h; cases h
  | ok n =>
    rw [hv] at h
    simp only [bind, Except.bind, act] at h
    cases hc : n.close with
    | error e => rw [hc] at h; cases h
    | ok n' => rw [hc] at h; injection h with h; exact h.symm

/-- 保証（成功の向き）: 閉じられたなら、宛先のメモがあり、名義は書いた本人で、閉じる前は開いていた。
    @[contract] は付けない — 保証の定理（生成器には渡さない）。 -/
theorem execute_ok_only_by_author (actor : ActorContext UserId) (c : Command NoteId)
    (before after : NoteRepositoryState NoteId UserId) (h : execute actor c before = .ok after) :
    ∃ n, before.find? c.note = some n ∧ n.author = actor.user ∧ n.closed = false := by
  simp only [execute, validate, act, bind, Except.bind] at h
  cases hf : before.find? c.note with
  | none => simp [hf] at h
  | some n =>
    refine ⟨n, rfl, ?_⟩
    by_cases ha : n.author = actor.user <;> by_cases hc : n.closed <;> simp_all [Note.close, Except.map]

/-- 同一性列は変わらない（フレーム — 消えない・増えない・入れ替わらない）。@[contract] は付けない — execute_ok の系。 -/
theorem closed_ids (c : Command NoteId) (before : NoteRepositoryState NoteId UserId) :
    (closed c before).ids = before.ids :=
  NoteRepositoryState.update_ids before c.note _ Note.close_getD_id Note.close_getD_title

end Sprout.Application.CloseNoteUseCase
