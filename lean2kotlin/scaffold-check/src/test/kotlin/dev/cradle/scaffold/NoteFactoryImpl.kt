package dev.cradle.scaffold

import dev.cradle.scaffold.domain.entity.Note
import dev.cradle.scaffold.domain.entity.NoteFactory
import dev.cradle.scaffold.domain.valueobject.NoteId
import dev.cradle.scaffold.domain.valueobject.Title
import dev.cradle.scaffold.runtime.UserId

/** `Sprout.Domain.Note.post` の写し。 */
object NoteFactoryImpl : NoteFactory {
	override fun post(id: NoteId, author: UserId, title: Title): Note = NoteImpl(id, author, title, closed = false)
}
