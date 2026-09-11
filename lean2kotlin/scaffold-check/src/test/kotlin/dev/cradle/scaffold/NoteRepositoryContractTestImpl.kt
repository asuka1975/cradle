package dev.cradle.scaffold

import dev.cradle.scaffold.domain.entity.Note
import dev.cradle.scaffold.domain.repository.NoteRepository
import dev.cradle.scaffold.domain.repository.NoteRepositoryContractTest

class NoteRepositoryContractTestImpl : NoteRepositoryContractTest() {
	override fun repository(): NoteRepository = InMemoryNoteRepository()
	override fun entity(fixture: NoteFixture): Note = fixture.materialize()
}
