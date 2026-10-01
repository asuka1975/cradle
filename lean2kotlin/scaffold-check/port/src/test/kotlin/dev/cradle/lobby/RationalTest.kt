package dev.cradle.lobby

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.math.BigInteger

/** 生成型 `Rational` が Lean の `Rat` と同じ正規形・同じ意味を持つこと（値の等しさが等値になる前提）。 */
class RationalTest {
	@Test
	fun `構築は既約にし、符号を分子に寄せる`() {
		val r = Rational.of(2L, -4L)
		assertEquals(BigInteger.valueOf(-1L), r.numerator)
		assertEquals(BigInteger.valueOf(2L), r.denominator)
		assertEquals(Rational.of(-1L, 2L), r)
		assertEquals(Rational.of(-1L, 2L).hashCode(), r.hashCode())
	}

	@Test
	fun `演算は Lean と同じ — 5 割る 6 引く 1 割る 3 は 1 割る 2、0 で割ると 0、分母 0 は 0`() {
		assertEquals(Rational.of(1L, 2L), Rational.of(5L, 6L) - Rational.of(1L, 3L))
		assertEquals(Rational.of(3L, 2L), Rational.of(1L, 2L) + Rational.of(1L, 1L))
		assertEquals(Rational.of(1L, 3L), Rational.of(2L, 3L) * Rational.of(1L, 2L))
		assertEquals(Rational.ZERO, Rational.of(1L, 2L) / Rational.ZERO)
		assertEquals(Rational.ZERO, Rational.of(3L, 0L))
	}

	@Test
	fun `順序は値の大小`() {
		assertTrue(Rational.of(1L, 3L) < Rational.of(1L, 2L))
		assertTrue(Rational.of(-1L, 2L) < Rational.ZERO)
		assertEquals(0, Rational.of(2L, 4L).compareTo(Rational.of(1L, 2L)))
	}
}
