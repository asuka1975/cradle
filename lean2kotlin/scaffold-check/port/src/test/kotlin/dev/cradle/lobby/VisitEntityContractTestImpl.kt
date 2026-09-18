package dev.cradle.lobby

import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.entity.VisitEntityContractTest

class VisitEntityContractTestImpl : VisitEntityContractTest() {
	override fun visit(fixture: VisitFixture): Visit = fixture.materialize()
}
