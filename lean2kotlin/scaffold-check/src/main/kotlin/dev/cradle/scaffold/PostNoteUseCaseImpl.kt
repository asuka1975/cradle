package dev.cradle.scaffold

import dev.cradle.scaffold.application.ActorContext
import dev.cradle.scaffold.application.NoteIdGenerator
import dev.cradle.scaffold.application.usecase.postnoteusecase.PostNoteCommand
import dev.cradle.scaffold.application.usecase.postnoteusecase.PostNoteUseCase
import dev.cradle.scaffold.domain.DomainError
import dev.cradle.scaffold.domain.repository.NoteRepository

/** `Sprout.Application.PostNoteUseCase` の validate / execute の写し。採番は validate が通ってから（`act_consumes_fountain`）。 */
class PostNoteUseCaseImpl(
	private val noteRepository: NoteRepository,
	private val noteIdGenerator: NoteIdGenerator,
	private val actor: ActorContext,
) : PostNoteUseCase {
	override fun validate(c: PostNoteCommand): DomainResult<DomainError, Unit> =
		if (c.title.valid()) DomainResult.Ok(Unit) else DomainResult.Err(DomainError.EmptyTitle)

	override fun execute(c: PostNoteCommand): DomainResult<DomainError, Unit> =
		when (val v = validate(c)) {
			is DomainResult.Err -> v
			is DomainResult.Ok -> {
				noteRepository.add(NoteImpl(noteIdGenerator.nextId(), actor.user, c.title, closed = false))
				DomainResult.Ok(Unit)
			}
		}
}
