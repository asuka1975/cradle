package dev.cradle.scaffold

import dev.cradle.scaffold.application.NoteRow
import dev.cradle.scaffold.application.NoteView
import dev.cradle.scaffold.application.usecase.notesusecase.NotesQuery
import dev.cradle.scaffold.application.usecase.notesusecase.NotesQueryService

/** `Sprout.Application.NotesUseCase.query` の写し。行（`NoteRow` は生成 test 側の語彙）から開いているメモだけを View に写す。 */
class InMemoryNotesQueryService(private val rows: List<NoteRow>) : NotesQueryService {
	override fun query(`_q`: NotesQuery): List<NoteView> =
		rows.filter { !it.closed }.map { NoteView(id = it.id, author = it.author, title = it.title.text, closed = it.closed) }
}
