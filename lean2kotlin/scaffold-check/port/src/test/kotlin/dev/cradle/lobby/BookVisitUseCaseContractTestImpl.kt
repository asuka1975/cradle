package dev.cradle.lobby

import dev.cradle.lobby.application.ActorContext
import dev.cradle.lobby.application.VisitIdGenerator
import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectory
import dev.cradle.lobby.application.usecase.bookvisitusecase.BookVisitUseCase
import dev.cradle.lobby.application.usecase.bookvisitusecase.BookVisitUseCaseContractTest
import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.repository.VisitRepository
import dev.cradle.lobby.domain.valueobject.VisitorName

class BookVisitUseCaseContractTestImpl : BookVisitUseCaseContractTest() {
	override fun visitRepository(): VisitRepository = InMemoryVisitRepository()
	override fun visit(fixture: VisitFixture): Visit = fixture.materialize()
	override fun visitorName(fixture: VisitorNameFixture): VisitorName = fixture.materialize()
	override fun useCase(visitRepository: VisitRepository, organizationDirectory: OrganizationDirectory, visitIdGenerator: VisitIdGenerator, actor: ActorContext): BookVisitUseCase =
		BookVisitUseCaseImpl(visitRepository, organizationDirectory, visitIdGenerator)
}
