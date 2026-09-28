package dev.cradle.lobby

import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayAuthorizeOutcome
import dev.cradle.lobby.application.usecase.dispatchpaymentusecase.DispatchPaymentRules
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.valueobject.PaymentResult

/** `Lobby.Application.DispatchPaymentUseCase.reflect` の写し。どの観測でも送る印を付け（試行番号が進む）、観測ごとに確定・通知待ち・送れる状態・結果不明にする。 */
object DispatchPaymentRulesImpl : DispatchPaymentRules {
	override fun reflect(outcome: PaymentGatewayAuthorizeOutcome, a: PaymentAttempt): PaymentAttempt {
		val marked = a.markSending()
		return when (outcome) {
			PaymentGatewayAuthorizeOutcome.Authorized -> marked.settle(PaymentResult.Authorized)
			PaymentGatewayAuthorizeOutcome.Declined -> marked.settle(PaymentResult.Declined)
			PaymentGatewayAuthorizeOutcome.Accepted -> marked.awaitConfirmation()
			PaymentGatewayAuthorizeOutcome.Unavailable -> marked.resetPending()
			PaymentGatewayAuthorizeOutcome.Unknown -> marked.lose()
		}
	}
}
