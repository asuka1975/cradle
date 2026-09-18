package dev.cradle.lobby

import dev.cradle.lobby.application.port.paymentgateway.PaymentGateway
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentUseCase
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentUseCaseFaultContractTest
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository

/** 配送の 3 つの中断点を、Port と Repository の包みで仕込む（仕掛けは DispatchFaults.kt）。 */
class DispatchPaymentUseCaseFaultContractTestImpl : DispatchPaymentUseCaseFaultContractTest() {
	override fun paymentAttemptRepository(): PaymentAttemptRepository = InMemoryPaymentAttemptRepository()
	override fun paymentAttempt(fixture: PaymentAttemptFixture): PaymentAttempt = fixture.materialize()

	override fun faultedMarkedNotSent(paymentAttemptRepository: PaymentAttemptRepository, paymentGateway: PaymentGateway): DispatchPaymentUseCase =
		DispatchPaymentUseCaseImpl(paymentAttemptRepository, crashBeforeSending(paymentGateway))

	override fun faultedSentNoAnswer(paymentAttemptRepository: PaymentAttemptRepository, paymentGateway: PaymentGateway): DispatchPaymentUseCase =
		DispatchPaymentUseCaseImpl(paymentAttemptRepository, loseResponse(paymentGateway))

	override fun faultedAppliedNotCommitted(paymentAttemptRepository: PaymentAttemptRepository, paymentGateway: PaymentGateway): DispatchPaymentUseCase =
		DispatchPaymentUseCaseImpl(failSecondUpdate(paymentAttemptRepository), paymentGateway)
}
