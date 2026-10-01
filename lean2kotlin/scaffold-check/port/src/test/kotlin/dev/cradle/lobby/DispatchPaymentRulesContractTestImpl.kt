package dev.cradle.lobby

import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentRules
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentRulesContractTest
import dev.cradle.lobby.domain.entity.PaymentAttempt

class DispatchPaymentRulesContractTestImpl : DispatchPaymentRulesContractTest() {
	override fun rules(): DispatchPaymentRules = DispatchPaymentRulesImpl
	override fun paymentAttempt(fixture: PaymentAttemptFixture): PaymentAttempt = fixture.materialize()
}
