package dev.cradle.lobby

import dev.cradle.lobby.domain.valueobject.VisitorName

/** `Lobby.VisitorName` の写し。制約は空でないこと（`VisitorName.valid`）。 */
data class VisitorNameImpl(override val text: String) : VisitorName {
	override fun valid(): Boolean = text.isNotEmpty()
}
