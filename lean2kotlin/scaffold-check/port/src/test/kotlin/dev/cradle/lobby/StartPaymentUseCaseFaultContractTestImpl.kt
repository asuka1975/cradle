package dev.cradle.lobby

import dev.cradle.lobby.application.ActorContext
import dev.cradle.lobby.application.PaymentAttemptIdGenerator
import dev.cradle.lobby.application.usecase.startpaymentusecase.StartPaymentUseCase
import dev.cradle.lobby.application.usecase.startpaymentusecase.StartPaymentUseCaseFaultContractTest
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository
import dev.cradle.lobby.domain.repository.VisitRepository

/** 開始の commit 前の中断: 試みの add を例外にする Repository の包み。 */
class StartPaymentUseCaseFaultContractTestImpl : StartPaymentUseCaseFaultContractTest() {
	override fun paymentAttemptRepository(): PaymentAttemptRepository = InMemoryPaymentAttemptRepository()
	override fun visitRepository(): VisitRepository = InMemoryVisitRepository()
	override fun paymentAttempt(fixture: PaymentAttemptFixture): PaymentAttempt = fixture.materialize()
	override fun visit(fixture: VisitFixture): Visit = fixture.materialize()

	override fun faultedBeforeCommit(paymentAttemptRepository: PaymentAttemptRepository, visitRepository: VisitRepository, paymentAttemptIdGenerator: PaymentAttemptIdGenerator, actor: ActorContext): StartPaymentUseCase =
		StartPaymentUseCaseImpl(visitRepository, object : PaymentAttemptRepository by paymentAttemptRepository {
			override fun add(paymentAttempt: PaymentAttempt): Unit = throw IllegalStateException("storage failure")
		}, paymentAttemptIdGenerator)
}
