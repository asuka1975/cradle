package dev.cradle.lobby

import dev.cradle.lobby.application.port.paymentgateway.PaymentGateway
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayAdapterContractTest
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayAuthorizeOutcome
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayAuthorizeRequest
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayInquireOutcome
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayInquireRequest
import dev.cradle.lobby.domain.valueobject.PaymentAttemptId
import dev.cradle.lobby.domain.valueobject.PaymentResult

/** 決済ゲートウェイの stub: 冪等キーごとの承認の答えと確定した結果、「送れない」「答えが返らない」状態。実プロジェクトでは提供元の sandbox がこの位置に来る。 */
class StubPaymentGateway : PaymentGateway {
	private val decisions = mutableMapOf<PaymentAttemptId, PaymentGatewayAuthorizeOutcome>()
	private val settled = mutableMapOf<PaymentAttemptId, PaymentResult>()
	/** 接続できない（送れなかった）。 */
	var down = false
	/** 送れたが応答が返らない。 */
	var silent = false

	fun decide(attempt: PaymentAttemptId, outcome: PaymentGatewayAuthorizeOutcome) { decisions[attempt] = outcome }
	fun settle(attempt: PaymentAttemptId, result: PaymentResult) { settled[attempt] = result }

	override fun authorize(request: PaymentGatewayAuthorizeRequest): PaymentGatewayAuthorizeOutcome {
		if (down) return PaymentGatewayAuthorizeOutcome.Unavailable
		if (silent) return PaymentGatewayAuthorizeOutcome.Unknown
		return decisions.getValue(request.attempt)
	}

	override fun inquire(request: PaymentGatewayInquireRequest): PaymentGatewayInquireOutcome {
		if (down) return PaymentGatewayInquireOutcome.Unavailable
		val r = settled[request.attempt] ?: return PaymentGatewayInquireOutcome.NotFound
		return PaymentGatewayInquireOutcome.Settled(r)
	}
}

/** 生成された適合テストに stub 相手の Adapter を配線する。各 arrange で stub をその観測を返す状態にしてから要求を返す。 */
class PaymentGatewayAdapterContractTestImpl : PaymentGatewayAdapterContractTest() {
	private val stub = StubPaymentGateway()

	override fun adapter(): PaymentGateway = stub

	private fun reachable() {
		stub.down = false
		stub.silent = false
	}

	override fun arrangeAuthorizeAuthorized(): PaymentGatewayAuthorizeRequest {
		reachable()
		stub.decide(PaymentAttemptId(1L), PaymentGatewayAuthorizeOutcome.Authorized)
		return PaymentGatewayAuthorizeRequest(attempt = PaymentAttemptId(1L), amount = 1L, attemptNo = 1L)
	}

	override fun arrangeAuthorizeDeclined(): PaymentGatewayAuthorizeRequest {
		reachable()
		stub.decide(PaymentAttemptId(2L), PaymentGatewayAuthorizeOutcome.Declined)
		return PaymentGatewayAuthorizeRequest(attempt = PaymentAttemptId(2L), amount = 1L, attemptNo = 1L)
	}

	override fun arrangeAuthorizeAccepted(): PaymentGatewayAuthorizeRequest {
		reachable()
		stub.decide(PaymentAttemptId(3L), PaymentGatewayAuthorizeOutcome.Accepted)
		return PaymentGatewayAuthorizeRequest(attempt = PaymentAttemptId(3L), amount = 1L, attemptNo = 1L)
	}

	override fun arrangeAuthorizeUnavailable(): PaymentGatewayAuthorizeRequest {
		reachable()
		stub.down = true
		return PaymentGatewayAuthorizeRequest(attempt = PaymentAttemptId(1L), amount = 1L, attemptNo = 1L)
	}

	override fun arrangeAuthorizeUnknown(): PaymentGatewayAuthorizeRequest {
		reachable()
		stub.silent = true
		return PaymentGatewayAuthorizeRequest(attempt = PaymentAttemptId(1L), amount = 1L, attemptNo = 2L)
	}

	override fun arrangeInquireSettled(): PaymentGatewayInquireRequest {
		reachable()
		stub.settle(PaymentAttemptId(1L), PaymentResult.Authorized)
		return PaymentGatewayInquireRequest(attempt = PaymentAttemptId(1L))
	}

	override fun arrangeInquireNotFound(): PaymentGatewayInquireRequest {
		reachable()
		return PaymentGatewayInquireRequest(attempt = PaymentAttemptId(404L))
	}

	override fun arrangeInquireUnavailable(): PaymentGatewayInquireRequest {
		reachable()
		stub.down = true
		return PaymentGatewayInquireRequest(attempt = PaymentAttemptId(1L))
	}
}
