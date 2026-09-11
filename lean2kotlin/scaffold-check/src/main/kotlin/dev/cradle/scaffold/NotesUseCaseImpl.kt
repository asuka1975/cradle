package dev.cradle.scaffold

import dev.cradle.scaffold.application.NoteView
import dev.cradle.scaffold.application.QueryError
import dev.cradle.scaffold.application.usecase.notesusecase.NotesQuery
import dev.cradle.scaffold.application.usecase.notesusecase.NotesQueryService
import dev.cradle.scaffold.application.usecase.notesusecase.NotesUseCase

/** `Sprout.Application.NotesUseCase` の validate / execute の写し。取得は `NotesQueryService` に委ねる。 */
class NotesUseCaseImpl(private val queryService: NotesQueryService) : NotesUseCase {
	override fun validate(`_q`: NotesQuery): DomainResult<QueryError, Unit> = DomainResult.Ok(Unit)

	override fun execute(q: NotesQuery): DomainResult<QueryError, List<NoteView>> =
		when (val v = validate(q)) {
			is DomainResult.Err -> v
			is DomainResult.Ok -> DomainResult.Ok(queryService.query(q))
		}
}
