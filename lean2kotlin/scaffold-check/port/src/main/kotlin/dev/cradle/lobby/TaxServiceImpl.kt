package dev.cradle.lobby

import dev.cradle.lobby.domain.domainservice.TaxService
import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.valueobject.VisitPhase

/** `Lobby.Domain.DomainService.Tax` の写し。退出済みの来訪だけが課税の対象（`taxable`）。 */
object TaxServiceImpl : TaxService {
	override fun taxable(v: Visit): Boolean = v.phase == VisitPhase.Left
}
