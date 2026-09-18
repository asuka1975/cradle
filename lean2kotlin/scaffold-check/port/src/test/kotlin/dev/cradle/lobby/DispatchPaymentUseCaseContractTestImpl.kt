package dev.cradle.lobby

import dev.cradle.lobby.application.port.paymentgateway.PaymentGateway
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentUseCase
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentUseCaseContractTest
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository

class DispatchPaymentUseCaseContractTestImpl : DispatchPaymentUseCaseContractTest() {
	override fun paymentAttemptRepository(): PaymentAttemptRepository = InMemoryPaymentAttemptRepository()
	override fun paymentAttempt(fixture: PaymentAttemptFixture): PaymentAttempt = fixture.materialize()
	override fun useCase(paymentAttemptRepository: PaymentAttemptRepository, paymentGateway: PaymentGateway): DispatchPaymentUseCase =
		DispatchPaymentUseCaseImpl(paymentAttemptRepository, paymentGateway)
}
