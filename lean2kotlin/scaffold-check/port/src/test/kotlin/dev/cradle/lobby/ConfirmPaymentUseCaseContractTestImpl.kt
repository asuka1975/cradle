package dev.cradle.lobby

import dev.cradle.lobby.application.usecase.confirmpaymentusecase.ConfirmPaymentUseCase
import dev.cradle.lobby.application.usecase.confirmpaymentusecase.ConfirmPaymentUseCaseContractTest
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository

class ConfirmPaymentUseCaseContractTestImpl : ConfirmPaymentUseCaseContractTest() {
	override fun paymentAttemptRepository(): PaymentAttemptRepository = InMemoryPaymentAttemptRepository()
	override fun paymentAttempt(fixture: PaymentAttemptFixture): PaymentAttempt = fixture.materialize()
	override fun useCase(paymentAttemptRepository: PaymentAttemptRepository): ConfirmPaymentUseCase = ConfirmPaymentUseCaseImpl(paymentAttemptRepository)
}
