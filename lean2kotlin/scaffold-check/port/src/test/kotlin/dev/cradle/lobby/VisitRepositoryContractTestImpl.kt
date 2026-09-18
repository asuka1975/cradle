package dev.cradle.lobby

import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.repository.VisitRepository
import dev.cradle.lobby.domain.repository.VisitRepositoryContractTest

class VisitRepositoryContractTestImpl : VisitRepositoryContractTest() {
	override fun repository(): VisitRepository = InMemoryVisitRepository()
	override fun entity(fixture: VisitFixture): Visit = fixture.materialize()
}
