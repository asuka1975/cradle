package dev.cradle.scaffold

import dev.cradle.scaffold.domain.entity.Note
import dev.cradle.scaffold.domain.entity.NoteEntityContractTest

class NoteEntityContractTestImpl : NoteEntityContractTest() {
	override fun note(fixture: NoteFixture): Note = fixture.materialize()
}
