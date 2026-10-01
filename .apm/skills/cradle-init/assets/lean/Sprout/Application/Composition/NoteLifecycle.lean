/-
  UseCase の合成 — 書く → 閉じる を数珠つなぎにし、ひと続きの業務で成り立つことを言う保証の定理。
  UseCase は観測モデルを更新する純粋関数なので、前の手の結果の状態を次の手に渡すだけで合成できる。
  1 本の定理が複数の結論（書いた本人は閉じられる・他人は閉じられない）をまとめて言う — 実ドメインでは
  docstring に出典の HS を並べる。@[contract] は付けない（生成器には渡さない）。
-/
import Sprout.Application.UseCase.PostNoteUseCase.UseCase
import Sprout.Application.UseCase.CloseNoteUseCase.UseCase

set_option linter.unusedSectionVars false

namespace Sprout.Application.Composition

open Sprout Sprout.Domain Sprout.Application

variable {NoteId UserId G : Type} [DecidableEq NoteId] [DecidableEq UserId]

/-- 書いたメモは、書いた本人なら閉じられ、書いた本人でなければ閉じられない。 -/
theorem post_then_close (author other : ActorContext UserId) (fountain : Fountain G NoteId)
    (c : PostNoteUseCase.Command) (before mid : PostNoteUseCase.State NoteId UserId G)
    (hfresh : fountain.Fresh before.noteIds before.notes.ids)
    (hpost : PostNoteUseCase.execute author fountain c before hfresh = .ok mid)
    (hother : other.user ≠ author.user) :
    (∃ after, CloseNoteUseCase.execute author ⟨fountain.valueAt before.noteIds⟩ mid.notes = .ok after) ∧
      CloseNoteUseCase.execute other ⟨fountain.valueAt before.noteIds⟩ mid.notes = .error .notAuthor := by
  obtain ⟨free, rfl⟩ := PostNoteUseCase.execute_ok_shape _ _ _ _ _ _ hpost
  -- 書いたメモは末尾にあり、同じ同一性の先客は無い（泉の新鮮性）
  have hfind : (PostNoteUseCase.act author fountain c before hfresh free).notes.find?
      (fountain.valueAt before.noteIds) =
      some (Note.post (fountain.valueAt before.noteIds) author.user ⟨c.title, free.nonempty⟩) := by
    simp only [PostNoteUseCase.act, NoteRepositoryState.add, NoteRepositoryState.find?, List.find?_append]
    have hnone : before.notes.notes.find? (fun n => n.id == fountain.valueAt before.noteIds) = none := by
      rw [List.find?_eq_none]
      intro n hn heq
      exact hfresh (by
        simp only [beq_iff_eq] at heq
        exact heq ▸ List.mem_map.mpr ⟨n, hn, rfl⟩)
    simp [hnone, Note.post]
  constructor
  · simp [CloseNoteUseCase.execute, CloseNoteUseCase.validate, CloseNoteUseCase.act, hfind, Note.post,
      Note.close, bind, Except.bind, Except.map]
  · simp [CloseNoteUseCase.execute, CloseNoteUseCase.validate, hfind, Note.post, bind, Except.bind,
      Ne.symm hother]

end Sprout.Application.Composition
