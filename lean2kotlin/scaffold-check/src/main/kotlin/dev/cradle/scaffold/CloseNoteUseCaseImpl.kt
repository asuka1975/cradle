package dev.cradle.scaffold

import dev.cradle.scaffold.application.ActorContext
import dev.cradle.scaffold.application.usecase.closenoteusecase.CloseNoteCommand
import dev.cradle.scaffold.application.usecase.closenoteusecase.CloseNoteUseCase
import dev.cradle.scaffold.domain.DomainError
import dev.cradle.scaffold.domain.entity.Note
import dev.cradle.scaffold.domain.repository.NoteRepository

/** `Sprout.Application.CloseNoteUseCase` の validate / execute の写し（拒否の順は宛先が無い → 本人でない → 閉じている）。 */
class CloseNoteUseCaseImpl(
	private val noteRepository: NoteRepository,
	private val actor: ActorContext,
) : CloseNoteUseCase {
	override fun validate(c: CloseNoteCommand): DomainResult<DomainError, Note> {
		val n = noteRepository.findById(c.note) ?: return DomainResult.Err(DomainError.UnknownNote)
		if (n.author != actor.user) return DomainResult.Err(DomainError.NotAuthor)
		if (n.closed) return DomainResult.Err(DomainError.AlreadyClosed)
		return DomainResult.Ok(n)
	}

	override fun execute(c: CloseNoteCommand): DomainResult<DomainError, Unit> =
		when (val v = validate(c)) {
			is DomainResult.Err -> v
			is DomainResult.Ok -> {
				noteRepository.update(v.value.close())
				DomainResult.Ok(Unit)
			}
		}
}
