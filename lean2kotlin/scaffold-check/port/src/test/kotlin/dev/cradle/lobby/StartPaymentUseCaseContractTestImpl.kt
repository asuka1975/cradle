package dev.cradle.lobby

import dev.cradle.lobby.application.ActorContext
import dev.cradle.lobby.application.PaymentAttemptIdGenerator
import dev.cradle.lobby.application.usecase.startpaymentusecase.StartPaymentUseCase
import dev.cradle.lobby.application.usecase.startpaymentusecase.StartPaymentUseCaseContractTest
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository
import dev.cradle.lobby.domain.repository.VisitRepository

class StartPaymentUseCaseContractTestImpl : StartPaymentUseCaseContractTest() {
	override fun paymentAttemptRepository(): PaymentAttemptRepository = InMemoryPaymentAttemptRepository()
	override fun visitRepository(): VisitRepository = InMemoryVisitRepository()
	override fun paymentAttempt(fixture: PaymentAttemptFixture): PaymentAttempt = fixture.materialize()
	override fun visit(fixture: VisitFixture): Visit = fixture.materialize()
	override fun useCase(paymentAttemptRepository: PaymentAttemptRepository, visitRepository: VisitRepository, paymentAttemptIdGenerator: PaymentAttemptIdGenerator, actor: ActorContext): StartPaymentUseCase =
		StartPaymentUseCaseImpl(visitRepository, paymentAttemptRepository, paymentAttemptIdGenerator)
}
