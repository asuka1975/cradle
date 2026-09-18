package dev.cradle.lobby

import dev.cradle.lobby.application.ActorContext
import dev.cradle.lobby.application.usecase.leaveusecase.LeaveUseCase
import dev.cradle.lobby.application.usecase.leaveusecase.LeaveUseCaseContractTest
import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.repository.VisitRepository

class LeaveUseCaseContractTestImpl : LeaveUseCaseContractTest() {
	override fun visitRepository(): VisitRepository = InMemoryVisitRepository()
	override fun visit(fixture: VisitFixture): Visit = fixture.materialize()
	override fun useCase(visitRepository: VisitRepository, actor: ActorContext): LeaveUseCase = LeaveUseCaseImpl(visitRepository)
}
