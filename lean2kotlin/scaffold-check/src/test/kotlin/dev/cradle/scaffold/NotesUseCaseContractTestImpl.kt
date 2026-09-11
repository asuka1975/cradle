package dev.cradle.scaffold

import dev.cradle.scaffold.application.ActorContext
import dev.cradle.scaffold.application.NoteRow
import dev.cradle.scaffold.application.usecase.notesusecase.NotesUseCase
import dev.cradle.scaffold.application.usecase.notesusecase.NotesUseCaseContractTest

class NotesUseCaseContractTestImpl : NotesUseCaseContractTest() {
	override fun useCase(actor: ActorContext, notes: List<NoteRow>): NotesUseCase =
		NotesUseCaseImpl(InMemoryNotesQueryService(notes))
}
