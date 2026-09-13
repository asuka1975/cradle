package dev.cradle.scaffold

import dev.cradle.scaffold.domain.entity.Note
import dev.cradle.scaffold.domain.repository.NoteRepository
import dev.cradle.scaffold.domain.valueobject.NoteId

/** `Sprout.Application.NoteRepositoryState` の写し。並びは追加順、`update` は同一性で差し替えて並びを保つ。
    観測モデルの制約 `uniqueIds` / `uniqueTitles` は実 DB の一意制約と同じく例外で守る — 生成 fixture が制約を破れば赤くなる。 */
class InMemoryNoteRepository : NoteRepository {
	private val notes = mutableListOf<Note>()

	override fun findById(id: NoteId): Note? = notes.find { it.id == id }

	override fun findAll(): List<Note> = notes.toList()

	override fun add(note: Note) {
		check(notes.none { it.id == note.id }) { "duplicate id: ${note.id}" }
		check(notes.none { it.title == note.title }) { "duplicate title: ${note.title}" }
		notes += note
	}

	override fun update(note: Note) {
		val i = notes.indexOfFirst { it.id == note.id }
		check(notes.none { it.id != note.id && it.title == note.title }) { "duplicate title: ${note.title}" }
		if (i >= 0) notes[i] = note
	}
}
