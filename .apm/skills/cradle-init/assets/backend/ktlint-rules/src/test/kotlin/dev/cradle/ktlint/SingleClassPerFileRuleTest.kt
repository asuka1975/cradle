package dev.cradle.ktlint

import com.pinterest.ktlint.test.KtLintAssertThat.Companion.assertThatRule
import com.pinterest.ktlint.test.LintViolation
import org.junit.jupiter.api.Test

class SingleClassPerFileRuleTest {
	private val assertThatCode = assertThatRule { SingleClassPerFileRule() }

	@Test
	fun `トップレベルの型が 1 つなら違反ではない`() {
		val code =
			"""
			package com.example.app

			class Note {
				class Nested

				companion object
			}

			fun topLevelHelper() = Unit
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}

	@Test
	fun `トップレベルの型が複数あれば 2 つ目以降を報告する`() {
		val code =
			"""
			package com.example.app

			class Note

			interface Tag

			object Attachment
			""".trimIndent()

		assertThatCode(code).hasLintViolationsWithoutAutoCorrect(
			LintViolation(
				5,
				11,
				"トップレベルの型が 1 ファイルに 3 個ある。'Tag' は Tag.kt に分ける(このファイルに残すのは 'Note' だけ)",
			),
			LintViolation(
				7,
				8,
				"トップレベルの型が 1 ファイルに 3 個ある。'Attachment' は Attachment.kt に分ける(このファイルに残すのは 'Note' だけ)",
			),
		)
	}

	@Test
	fun `sealed 型とその直接のサブタイプは同居してよい`() {
		val code =
			"""
			package com.example.app

			sealed interface DomainError {
				val message: String
			}

			data class UnknownNote(val id: Long) : DomainError {
				override val message = "unknownNote"
			}

			object NoFolders : DomainError {
				override val message = "noFolders"
			}
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}

	@Test
	fun `sealed 型と無関係な型の同居は報告する`() {
		val code =
			"""
			package com.example.app

			sealed interface DomainError

			object NoFolders : DomainError

			class ApiErrorHandler
			""".trimIndent()

		assertThatCode(code).hasLintViolationsWithoutAutoCorrect(
			LintViolation(
				7,
				7,
				"トップレベルの型が 1 ファイルに 2 個ある。'ApiErrorHandler' は ApiErrorHandler.kt に分ける" +
					"(このファイルに残すのは 'DomainError' だけ)",
			),
		)
	}

	@Test
	fun `sealed の同居を許さない設定なら報告する`() {
		val code =
			"""
			package com.example.app

			sealed interface DomainError

			object NoFolders : DomainError
			""".trimIndent()

		assertThatCode(code)
			.withEditorConfigOverride(SingleClassPerFileRule.ALLOW_SEALED_SUBTYPES_PROPERTY to false)
			.hasLintViolationsWithoutAutoCorrect(
				LintViolation(
					5,
					8,
					"トップレベルの型が 1 ファイルに 2 個ある。'NoFolders' は NoFolders.kt に分ける" +
						"(このファイルに残すのは 'DomainError' だけ)",
				),
			)
	}

	@Test
	fun `宣言に付けた Suppress で抑止できる`() {
		val code =
			"""
			package com.example.app

			class Note

			@Suppress("ktlint:cradle:single-class-per-file")
			class Tag
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}
}
