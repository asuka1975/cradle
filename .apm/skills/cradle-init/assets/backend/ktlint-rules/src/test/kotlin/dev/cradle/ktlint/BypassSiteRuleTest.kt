package dev.cradle.ktlint

import com.pinterest.ktlint.test.KtLintAssertThat.Companion.assertThatRule
import org.junit.jupiter.api.Test

class BypassSiteRuleTest {
	private val assertThatCode = assertThatRule { BypassSiteRule() }

	@Test
	fun `Bypass の宣言は消費する UseCase のディレクトリに置ける`() {
		val code =
			"""
			package com.example.application.usecase.postnoteusecase

			interface NoteBulkAddBypass {
				fun bulkAdd(count: Int)
			}
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}

	@Test
	fun `UseCase のディレクトリ以外の宣言を検出する`() {
		val code =
			"""
			package com.example.domain.repository

			interface NoteBulkAddBypass
			""".trimIndent()

		assertThatCode(code).hasLintViolationWithoutAutoCorrect(
			3,
			11,
			"'NoteBulkAddBypass' の宣言が com.example.domain.repository にある。" +
				"バイパスの宣言は消費する UseCase のディレクトリ(com.example.application.usecase 配下)に置き、" +
				"複数の UseCase から共有しない(.claude/rules/backend-kotlin.md「性能バイパス」)",
		)
	}

	@Test
	fun `実装と import は infrastructure に置ける`() {
		val code =
			"""
			package com.example.infrastructure

			import com.example.application.usecase.postnoteusecase.NoteBulkAddBypass

			class JooqNoteBulkAddBypass : NoteBulkAddBypass
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}

	@Test
	fun `infrastructure 以外の実装を検出する`() {
		val code =
			"""
			package com.example.application.usecase.postnoteusecase

			class LocalNoteBulkAddBypass : NoteBulkAddBypass
			""".trimIndent()

		assertThatCode(code).hasLintViolationWithoutAutoCorrect(
			3,
			7,
			"'LocalNoteBulkAddBypass' は NoteBulkAddBypass の実装だが com.example.application.usecase.postnoteusecase にある。" +
				"バイパスの実装は com.example.infrastructure 配下に置く(.claude/rules/backend-kotlin.md「性能バイパス」)",
		)
	}

	@Test
	fun `object 式で作ったフェイク実装も検出する`() {
		val code =
			"""
			package com.example.application.usecase.postnoteusecase

			val fake = object : NoteBulkAddBypass {}
			""".trimIndent()

		assertThatCode(code).hasLintViolationWithoutAutoCorrect(
			3,
			12,
			"'(匿名)' は NoteBulkAddBypass の実装だが com.example.application.usecase.postnoteusecase にある。" +
				"バイパスの実装は com.example.infrastructure 配下に置く(.claude/rules/backend-kotlin.md「性能バイパス」)",
		)
	}

	@Test
	fun `実装パッケージ以外の import を検出する`() {
		val code =
			"""
			package com.example.presentation.notes

			import com.example.application.usecase.postnoteusecase.NoteBulkAddBypass

			class NotesController(private val bypass: NoteBulkAddBypass)
			""".trimIndent()

		assertThatCode(code).hasLintViolationWithoutAutoCorrect(
			3,
			1,
			"com.example.application.usecase.postnoteusecase.NoteBulkAddBypass を import している。" +
				"*Bypass を import してよいのは実装側(com.example.infrastructure 配下)だけ — " +
				"消費する UseCaseImpl は宣言と同じパッケージに置くので import は要らない(.claude/rules/backend-kotlin.md「性能バイパス」)",
		)
	}

	@Test
	fun `宣言と同じパッケージの UseCaseImpl は import 不要なので通る`() {
		val code =
			"""
			package com.example.application.usecase.postnoteusecase

			class SaveUseCaseImpl(private val bypass: NoteBulkAddBypass)
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}

	@Test
	fun `対象のパッケージは editorconfig で変えられる`() {
		val code =
			"""
			package com.example.app.usecase.bulk

			interface NoteBulkAddBypass
			""".trimIndent()

		assertThatCode(code)
			.withEditorConfigOverride(
				BypassSiteRule.DECLARATION_PACKAGE_PREFIX_PROPERTY to "com.example.app.usecase",
				BypassSiteRule.IMPLEMENTATION_PACKAGE_PREFIX_PROPERTY to "com.example.infra",
			).hasNoLintViolations()
	}

	@Test
	fun `宣言に付けた Suppress で抑止できる`() {
		val code =
			"""
			package com.example.domain.repository

			// 移行中の暫定置き場(次のセッションで usecase 配下へ移す)
			@Suppress("ktlint:cradle:bypass-site")
			interface NoteBulkAddBypass
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}
}
