package dev.cradle.lobby

import dev.cradle.lobby.application.port.paymentgateway.PaymentGateway
import dev.cradle.lobby.application.usecase.inquirepaymentusecase.InquirePaymentUseCase
import dev.cradle.lobby.application.usecase.inquirepaymentusecase.InquirePaymentUseCaseContractTest
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository

class InquirePaymentUseCaseContractTestImpl : InquirePaymentUseCaseContractTest() {
	override fun paymentAttemptRepository(): PaymentAttemptRepository = InMemoryPaymentAttemptRepository()
	override fun paymentAttempt(fixture: PaymentAttemptFixture): PaymentAttempt = fixture.materialize()
	override fun useCase(paymentAttemptRepository: PaymentAttemptRepository, paymentGateway: PaymentGateway): InquirePaymentUseCase =
		InquirePaymentUseCaseImpl(paymentAttemptRepository, paymentGateway)
}
