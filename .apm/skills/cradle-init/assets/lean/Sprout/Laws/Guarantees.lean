/-
  保証の定理 — resolved HS の結論を ∀ で言う。生成器には渡さない（@[contract] を付けない）ので、
  サンプルから演繹できる形に縛られない。向きは 2 つ: 成功したなら前提が成り立っていた（成功の向き）、
  どの手でもこの性質は崩れない（不変の向き）。docstring に出典の HS と結論の全文を書く。
-/
import Sprout.Application.UseCase.CloseNoteUseCase.UseCase

set_option linter.unusedSectionVars false

namespace Sprout.Laws

open Sprout Sprout.Domain Sprout.Application

variable {NoteId UserId : Type} [DecidableEq NoteId] [DecidableEq UserId]

/-- メモを閉じられるのは書いた本人だけで、閉じる前のメモは開いていた（成功の向き）。 -/
theorem close_only_by_author (actor : ActorContext UserId) (c : CloseNoteUseCase.Command NoteId)
    (before after : NoteRepositoryState NoteId UserId)
    (h : CloseNoteUseCase.execute actor c before = .ok after) :
    ∃ n, before.find? c.note = some n ∧ n.author = actor.user ∧ n.closed = false := by
  unfold CloseNoteUseCase.execute CloseNoteUseCase.validate at h
  cases hf : before.find? c.note with
  | none => simp [hf, Except.map] at h
  | some n =>
    refine ⟨n, rfl, ?_⟩
    by_cases ha : n.author = actor.user <;> by_cases hc : n.closed <;> simp_all [Except.map]

end Sprout.Laws
