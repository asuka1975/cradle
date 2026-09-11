package dev.cradle.scaffold

import dev.cradle.scaffold.domain.valueobject.Title

/** `Sprout.Title` の写し。制約は空でないこと（`Title.valid`）。 */
data class TitleImpl(override val text: String) : Title {
	override fun valid(): Boolean = text.isNotEmpty()
}
