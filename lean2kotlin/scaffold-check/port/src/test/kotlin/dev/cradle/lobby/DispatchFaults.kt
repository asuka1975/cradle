package dev.cradle.lobby

import dev.cradle.lobby.application.port.paymentgateway.PaymentGateway
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayAuthorizeOutcome
import dev.cradle.lobby.application.port.paymentgateway.PaymentGatewayAuthorizeRequest
import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository

/*
 * 配送の中断点を仕込む包み。障害契約テストの具象と、誤実装が赤くなる検査（WrongDispatchTest）が同じ仕掛けを使う。
 * 消費位置はモックが数えるので、包みは「Port へ届ける前に落ちる」「届けてから落ちる」を忠実に分ける。
 */

/** 送る前に落ちる: Port へは届けない（消費 0）。 */
fun crashBeforeSending(gateway: PaymentGateway): PaymentGateway = object : PaymentGateway by gateway {
	override fun authorize(request: PaymentGatewayAuthorizeRequest): PaymentGatewayAuthorizeOutcome =
		throw IllegalStateException("crash before sending")
}

/** 送ったが応答を失う: Port へ届けてから落ちる（消費 1）。 */
fun loseResponse(gateway: PaymentGateway): PaymentGateway = object : PaymentGateway by gateway {
	override fun authorize(request: PaymentGatewayAuthorizeRequest): PaymentGatewayAuthorizeOutcome {
		gateway.authorize(request)
		throw IllegalStateException("response lost")
	}
}

/** 反映の保存で落ちる: 2 回目の update（観測の反映）だけを例外にする。1 回目（送る印）は通す。 */
fun failSecondUpdate(repository: PaymentAttemptRepository): PaymentAttemptRepository = object : PaymentAttemptRepository by repository {
	private var updates = 0
	override fun update(paymentAttempt: PaymentAttempt) {
		if (++updates == 2) throw IllegalStateException("commit failure after the answer")
		repository.update(paymentAttempt)
	}
}
