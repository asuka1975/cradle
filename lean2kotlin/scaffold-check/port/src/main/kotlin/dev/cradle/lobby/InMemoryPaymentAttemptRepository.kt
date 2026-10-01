package dev.cradle.lobby

import dev.cradle.lobby.domain.entity.PaymentAttempt
import dev.cradle.lobby.domain.repository.PaymentAttemptRepository
import dev.cradle.lobby.domain.valueobject.PaymentAttemptId

/** `Lobby.Application.PaymentAttemptRepositoryState` の写し。並びは追加順、`update` は同一性で差し替えて並びを保つ。
    観測モデルの制約 `uniqueIds` は実 DB の制約と同じく例外で守る — 生成 fixture が制約を破れば赤くなる。
    金額の制約 `Money.nonneg` も実 DB の CHECK 制約と同じく守る — 生成された Arb が負の金額を作れば赤くなる。 */
class InMemoryPaymentAttemptRepository : PaymentAttemptRepository {
	private val attempts = mutableListOf<PaymentAttempt>()

	override fun findById(id: PaymentAttemptId): PaymentAttempt? = attempts.find { it.id == id }

	override fun findAll(): List<PaymentAttempt> = attempts.toList()

	override fun add(paymentAttempt: PaymentAttempt) {
		check(paymentAttempt.amount.value >= Rational.ZERO) { "negative amount: ${paymentAttempt.amount.value}" }
		check(attempts.none { it.id == paymentAttempt.id }) { "duplicate id: ${paymentAttempt.id}" }
		attempts += paymentAttempt
	}

	override fun update(paymentAttempt: PaymentAttempt) {
		check(paymentAttempt.amount.value >= Rational.ZERO) { "negative amount: ${paymentAttempt.amount.value}" }
		val i = attempts.indexOfFirst { it.id == paymentAttempt.id }
		if (i >= 0) attempts[i] = paymentAttempt
	}
}
