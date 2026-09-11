package dev.cradle.scaffold

import dev.cradle.scaffold.application.ActorContext
import dev.cradle.scaffold.application.usecase.closenoteusecase.CloseNoteUseCase
import dev.cradle.scaffold.application.usecase.closenoteusecase.CloseNoteUseCaseContractTest
import dev.cradle.scaffold.domain.entity.Note
import dev.cradle.scaffold.domain.repository.NoteRepository

class CloseNoteUseCaseContractTestImpl : CloseNoteUseCaseContractTest() {
	override fun noteRepository(): NoteRepository = InMemoryNoteRepository()
	override fun note(fixture: NoteFixture): Note = fixture.materialize()
	override fun useCase(noteRepository: NoteRepository, actor: ActorContext): CloseNoteUseCase =
		CloseNoteUseCaseImpl(noteRepository, actor)
}
