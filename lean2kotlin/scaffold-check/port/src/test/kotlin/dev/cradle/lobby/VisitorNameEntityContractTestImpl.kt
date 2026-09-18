package dev.cradle.lobby

import dev.cradle.lobby.domain.valueobject.VisitorName
import dev.cradle.lobby.domain.valueobject.VisitorNameEntityContractTest

class VisitorNameEntityContractTestImpl : VisitorNameEntityContractTest() {
	override fun visitorName(fixture: VisitorNameFixture): VisitorName = fixture.materialize()
}
