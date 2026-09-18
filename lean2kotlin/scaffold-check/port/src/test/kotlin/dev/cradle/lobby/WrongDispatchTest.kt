package dev.cradle.lobby

import dev.cradle.lobby.application.port.paymentgateway.PaymentGateway
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayAuthorizeOutcome
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayAuthorizeRequest
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentObservation
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentUseCase
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentUseCaseFaultContractTest
import dev.cradle.lobby.domain.DomainError
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository
import dev.cradle.lobby.domain.valueobject.PaymentResult
import java.lang.reflect.InvocationTargetException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * 配送の順序を誤った実装が、消費位置つきの障害契約テストで赤くなることの検査。
 * 送る印を保存してから送る、という順序は中断点の観測（印が残る）でしか捕まえられない — 通常の契約テストは
 * 中断しないので、印を後から付ける実装も通ってしまう。正しい実装は DispatchPaymentUseCaseFaultContractTestImpl が通す。
 */
class WrongDispatchTest {
	private fun failuresOf(t: DispatchPaymentUseCaseFaultContractTest): Map<String, Throwable> =
		t::class.java.methods.filter { it.isAnnotationPresent(Test::class.java) }.mapNotNull { m ->
			runCatching { m.invoke(t) }.exceptionOrNull()?.let { m.name to ((it as? InvocationTargetException)?.targetException ?: it) }
		}.toMap()

	/** 正しい具象と同じ仕掛けで、誤った実装を中断点に置く。 */
	private abstract class Harness(private val make: (PaymentAttemptRepository, PaymentGateway) -> DispatchPaymentUseCase) : DispatchPaymentUseCaseFaultContractTest() {
		override fun paymentAttemptRepository(): PaymentAttemptRepository = InMemoryPaymentAttemptRepository()
		override fun paymentAttempt(fixture: PaymentAttemptFixture): PaymentAttempt = fixture.materialize()
		override fun faultedMarkedNotSent(paymentAttemptRepository: PaymentAttemptRepository, paymentGateway: PaymentGateway) = make(paymentAttemptRepository, crashBeforeSending(paymentGateway))
		override fun faultedSentNoAnswer(paymentAttemptRepository: PaymentAttemptRepository, paymentGateway: PaymentGateway) = make(paymentAttemptRepository, loseResponse(paymentGateway))
		override fun faultedAppliedNotCommitted(paymentAttemptRepository: PaymentAttemptRepository, paymentGateway: PaymentGateway) = make(failSecondUpdate(paymentAttemptRepository), paymentGateway)
	}

	/** 先に送ってから印と結果を 1 回の update で保存する実装（印が commit される前に外部を呼ぶ）。 */
	private class SendsBeforeMarking(repository: PaymentAttemptRepository, gateway: PaymentGateway) : DispatchPaymentUseCase {
		private val real = DispatchPaymentUseCaseImpl(repository, gateway)
		private val repository = repository
		private val gateway = gateway
		override fun validate(o: DispatchPaymentObservation): DomainResult<DomainError, PaymentAttempt> = real.validate(o)
		override fun execute(o: DispatchPaymentObservation): DomainResult<DomainError, Unit> =
			when (val v = validate(o)) {
				is DomainResult.Err -> v
				is DomainResult.Ok -> {
					val a = v.value
					val marked = a.markSending()
					val reflected = when (gateway.authorize(PaymentGatewayAuthorizeRequest(attempt = a.id, amount = a.amount, attemptNo = marked.tries))) {
						PaymentGatewayAuthorizeOutcome.Authorized -> marked.settle(PaymentResult.Authorized)
						PaymentGatewayAuthorizeOutcome.Declined -> marked.settle(PaymentResult.Declined)
						PaymentGatewayAuthorizeOutcome.Accepted -> marked.awaitConfirmation()
						PaymentGatewayAuthorizeOutcome.Unavailable -> marked
						PaymentGatewayAuthorizeOutcome.Unknown -> marked.lose()
					}
					repository.update(reflected)
					DomainResult.Ok(Unit)
				}
			}
	}

	private class SendsBeforeMarkingHarness : Harness({ repo, gateway -> SendsBeforeMarking(repo, gateway) })

	private fun assertAllRed(failures: Map<String, Throwable>, expected: Int) {
		assertEquals(expected, failures.size, "赤くなるべきテストが通っている: " + failures.keys)
	}

	@Test
	fun `正しい実装は全部通る`() {
		assertEquals(emptyMap<String, Throwable>(), failuresOf(DispatchPaymentUseCaseFaultContractTestImpl()))
	}

	@Test
	fun `印を保存する前に送る実装は、3 つの中断点すべてで赤くなる`() {
		val failures = failuresOf(SendsBeforeMarkingHarness())
		// markedNotSent / sentNoAnswer: 印が残っていない。appliedNotCommitted: 2 回目の update が無いので障害が注入されない
		assertAllRed(failures, 12)
		assertTrue(failures.filterKeys { it.contains("appliedNotCommitted") }.values.all { it.message?.contains("技術的障害が注入されていない") == true }, failures.toString())
		assertTrue(failures.filterKeys { !it.contains("appliedNotCommitted") }.values.all { it is AssertionError && it.message?.contains("expected") == true }, failures.toString())
	}
}
