package dev.cradle.scaffold

import dev.cradle.scaffold.domain.entity.Note
import dev.cradle.scaffold.domain.valueobject.NoteId
import dev.cradle.scaffold.domain.valueobject.Title
import dev.cradle.scaffold.runtime.UserId

/** `Sprout.Domain.Note` の写し。`close` は閉じた写しを返す（`Note.close`）。 */
data class NoteImpl(
	override val id: NoteId,
	override val author: UserId,
	override val title: Title,
	override val closed: Boolean,
) : Note {
	override fun isOpen(): Boolean = !closed
	override fun close(): Note = copy(closed = true)
}
