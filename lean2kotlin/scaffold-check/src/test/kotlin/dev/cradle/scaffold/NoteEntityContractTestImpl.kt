package dev.cradle.scaffold

import dev.cradle.scaffold.domain.entity.Note
import dev.cradle.scaffold.domain.entity.NoteEntityContractTest
import dev.cradle.scaffold.domain.entity.NoteFactory
import dev.cradle.scaffold.domain.valueobject.Title

class NoteEntityContractTestImpl : NoteEntityContractTest() {
	override fun title(fixture: TitleFixture): Title = fixture.materialize()
	override fun note(fixture: NoteFixture): Note = fixture.materialize()
	override fun factory(): NoteFactory = NoteFactoryImpl
}
