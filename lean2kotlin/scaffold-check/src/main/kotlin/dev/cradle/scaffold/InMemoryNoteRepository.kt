package dev.cradle.scaffold

import dev.cradle.scaffold.domain.entity.Note
import dev.cradle.scaffold.domain.repository.NoteRepository
import dev.cradle.scaffold.domain.valueobject.NoteId

/** `Sprout.Application.NoteRepositoryState` の写し。並びは追加順、`update` は同一性で差し替えて並びを保つ。 */
class InMemoryNoteRepository : NoteRepository {
	private val notes = mutableListOf<Note>()

	override fun findById(id: NoteId): Note? = notes.find { it.id == id }

	override fun findAll(): List<Note> = notes.toList()

	override fun add(note: Note) {
		notes += note
	}

	override fun update(note: Note) {
		val i = notes.indexOfFirst { it.id == note.id }
		if (i >= 0) notes[i] = note
	}
}
