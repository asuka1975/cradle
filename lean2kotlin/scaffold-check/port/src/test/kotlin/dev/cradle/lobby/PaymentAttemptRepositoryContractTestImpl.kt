package dev.cradle.lobby

import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository
import dev.cradle.lobby.domain.repository.PaymentAttemptRepositoryContractTest

class PaymentAttemptRepositoryContractTestImpl : PaymentAttemptRepositoryContractTest() {
	override fun repository(): PaymentAttemptRepository = InMemoryPaymentAttemptRepository()
	override fun entity(fixture: PaymentAttemptFixture): PaymentAttempt = fixture.materialize()
}
