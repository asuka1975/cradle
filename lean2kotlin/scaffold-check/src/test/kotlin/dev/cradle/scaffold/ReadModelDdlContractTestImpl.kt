package dev.cradle.scaffold

import dev.cradle.scaffold.application.NoteRow
import dev.cradle.scaffold.application.ReadModelDdlContractTest
import dev.cradle.scaffold.application.usecase.notesusecase.NotesReadModel

/** `Sprout.Application.noteRows` の写し。集約をそのまま行に写す（インメモリではスキーマ = 集約の形）。 */
class ReadModelDdlContractTestImpl : ReadModelDdlContractTest() {
	override fun retrieveNotesReadModel(notes: List<NoteFixture>): NotesReadModel =
		NotesReadModel(notes.map { NoteRow(id = it.id, author = it.author, title = it.title, closed = it.closed) })
}
