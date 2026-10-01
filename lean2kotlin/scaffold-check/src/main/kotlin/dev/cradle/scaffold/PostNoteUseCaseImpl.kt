package dev.cradle.scaffold

import dev.cradle.scaffold.application.ActorContext
import dev.cradle.scaffold.application.NoteIdGenerator
import dev.cradle.scaffold.application.usecase.postnoteusecase.PostNoteCommand
import dev.cradle.scaffold.application.usecase.postnoteusecase.PostNoteFreeTitle
import dev.cradle.scaffold.application.usecase.postnoteusecase.PostNoteUseCase
import dev.cradle.scaffold.domain.DomainError
import dev.cradle.scaffold.domain.repository.NoteRepository
import dev.cradle.scaffold.domain.valueobject.Title

/** `Sprout.Application.PostNoteUseCase` の validate / execute の写し。採番は validate が通ってから（`act_consumes_fountain`）。
    題（`Title`）を作るのは validate が空でないと決めた後だけ（`Title` の型は制約を検査しない）。 */
class PostNoteUseCaseImpl(
	private val noteRepository: NoteRepository,
	private val noteIdGenerator: NoteIdGenerator,
	private val actor: ActorContext,
) : PostNoteUseCase {
	override fun validate(c: PostNoteCommand): DomainResult<DomainError, PostNoteFreeTitle> =
		if (c.title.isEmpty()) DomainResult.Err(DomainError.EmptyTitle)
		else if (noteRepository.findAll().any { it.title.text == c.title }) DomainResult.Err(DomainError.TitleTaken)
		else DomainResult.Ok(PostNoteFreeTitle)

	override fun execute(c: PostNoteCommand): DomainResult<DomainError, Unit> =
		when (val v = validate(c)) {
			is DomainResult.Err -> v
			is DomainResult.Ok -> {
				noteRepository.add(NoteImpl(noteIdGenerator.nextId(), actor.user, Title(c.title), closed = false))
				DomainResult.Ok(Unit)
			}
		}
}
