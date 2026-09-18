package dev.cradle.lobby

import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.entity.PaymentAttemptEntityContractTest
import dev.cradle.lobby.domain.entity.PaymentAttemptFactory
import dev.cradle.lobby.domain.valueobject.PaymentAttemptId
import dev.cradle.lobby.domain.valueobject.VisitId

class PaymentAttemptEntityContractTestImpl : PaymentAttemptEntityContractTest() {
	override fun paymentAttempt(fixture: PaymentAttemptFixture): PaymentAttempt = fixture.materialize()
	/** ファクトリは `PaymentAttempt.start` の写し（PaymentAttemptImpl.start）に委ねる。 */
	override fun factory(): PaymentAttemptFactory = object : PaymentAttemptFactory {
		override fun start(id: PaymentAttemptId, visit: VisitId, amount: Long): PaymentAttempt = PaymentAttemptImpl.start(id, visit, amount)
	}
}
