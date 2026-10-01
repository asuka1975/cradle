package dev.cradle.lobby

import dev.cradle.lobby.domain.domainservice.PricingService
import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.valueobject.Money
import dev.cradle.lobby.domain.valueobject.VisitPhase

/** `Lobby.Domain.DomainService.Pricing` の写し。受付中の来訪は無料、退出済みは 3/2（`fee`）。 */
object PricingServiceImpl : PricingService {
	override fun fee(v: Visit): Money = Money(if (v.phase == VisitPhase.Left) Rational.of(3L, 2L) else Rational.ZERO)
}
