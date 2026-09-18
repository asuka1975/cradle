package dev.cradle.lobby

import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.valueobject.VisitId
import dev.cradle.lobby.domain.valueobject.VisitPhase
import dev.cradle.lobby.domain.valueobject.VisitorName
import dev.cradle.lobby.runtime.EmployeeId

/** `Lobby.Domain.Visit` の写し。`leave` は退出済みの写しを返す（`Visit.leave`）。 */
data class VisitImpl(
	override val id: VisitId,
	override val host: EmployeeId,
	override val hostName: String,
	override val visitor: VisitorName,
	override val phase: VisitPhase,
) : Visit {
	override fun isExpected(): Boolean = phase == VisitPhase.Expected
	override fun leave(): Visit = copy(phase = VisitPhase.Left)
}
