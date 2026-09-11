package dev.cradle.scaffold

import dev.cradle.scaffold.application.ActorContext
import dev.cradle.scaffold.application.NoteIdGenerator
import dev.cradle.scaffold.application.usecase.postnoteusecase.PostNoteUseCase
import dev.cradle.scaffold.application.usecase.postnoteusecase.PostNoteUseCaseContractTest
import dev.cradle.scaffold.domain.entity.Note
import dev.cradle.scaffold.domain.repository.NoteRepository
import dev.cradle.scaffold.domain.valueobject.Title

class PostNoteUseCaseContractTestImpl : PostNoteUseCaseContractTest() {
	override fun noteRepository(): NoteRepository = InMemoryNoteRepository()
	override fun note(fixture: NoteFixture): Note = fixture.materialize()
	override fun title(fixture: TitleFixture): Title = fixture.materialize()
	override fun useCase(noteRepository: NoteRepository, noteIdGenerator: NoteIdGenerator, actor: ActorContext): PostNoteUseCase =
		PostNoteUseCaseImpl(noteRepository, noteIdGenerator, actor)
}
