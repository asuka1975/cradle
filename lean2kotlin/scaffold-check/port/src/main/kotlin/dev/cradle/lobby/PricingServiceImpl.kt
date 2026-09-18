package dev.cradle.lobby

import dev.cradle.lobby.domain.domainservice.PricingService
import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.valueobject.VisitPhase

/** `Lobby.Domain.DomainService.Pricing` の写し。受付中の来訪は無料、退出済みは 1（`fee`）。 */
object PricingServiceImpl : PricingService {
	override fun fee(v: Visit): Long = if (v.phase == VisitPhase.Left) 1L else 0L
}
