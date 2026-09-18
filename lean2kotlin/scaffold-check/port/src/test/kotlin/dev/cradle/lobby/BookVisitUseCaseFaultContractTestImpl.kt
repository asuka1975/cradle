package dev.cradle.lobby

import dev.cradle.lobby.application.ActorContext
import dev.cradle.lobby.application.VisitIdGenerator
import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectory
import dev.cradle.lobby.application.usecase.bookvisitusecase.BookVisitUseCase
import dev.cradle.lobby.application.usecase.bookvisitusecase.BookVisitUseCaseFaultContractTest
import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.repository.VisitRepository
import dev.cradle.lobby.domain.valueobject.VisitorName

class BookVisitUseCaseFaultContractTestImpl : BookVisitUseCaseFaultContractTest() {
	override fun visitRepository(): VisitRepository = InMemoryVisitRepository()
	override fun visit(fixture: VisitFixture): Visit = fixture.materialize()
	override fun visitorName(fixture: VisitorNameFixture): VisitorName = fixture.materialize()
	/** 保存の途中で技術的障害が起きる仕掛け: 渡された Repository の add だけを例外で止める（観測はその Repository で行う）。 */
	override fun faultedUseCase(visitRepository: VisitRepository, organizationDirectory: OrganizationDirectory, visitIdGenerator: VisitIdGenerator, actor: ActorContext): BookVisitUseCase =
		BookVisitUseCaseImpl(object : VisitRepository by visitRepository {
			override fun add(visit: Visit): Unit = throw IllegalStateException("storage failure")
		}, organizationDirectory, visitIdGenerator)
}
