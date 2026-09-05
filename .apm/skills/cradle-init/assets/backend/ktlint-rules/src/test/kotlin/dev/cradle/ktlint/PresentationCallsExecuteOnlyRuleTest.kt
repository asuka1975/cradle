package dev.cradle.ktlint

import com.pinterest.ktlint.test.KtLintAssertThat.Companion.assertThatRule
import org.junit.jupiter.api.Test

class PresentationCallsExecuteOnlyRuleTest {
	private val assertThatCode = assertThatRule { PresentationCallsExecuteOnlyRule() }

	@Test
	fun `presentation の validate 呼び出しを検出する`() {
		val code =
			"""
			package com.example.presentation.notes

			class NotesController(private val useCase: SaveUseCase) {
				fun save(request: SaveRequest): String {
					val validated = useCase.validate(request.toCommand())
					return validated.toString()
				}
			}
			""".trimIndent()

		assertThatCode(code).hasLintViolationWithoutAutoCorrect(5, 27, MESSAGE)
	}

	@Test
	fun `execute の呼び出しは報告しない`() {
		val code =
			"""
			package com.example.presentation.notes

			class NotesController(private val useCase: SaveUseCase) {
				fun save(request: SaveRequest): String = useCase.execute(request.toCommand()).toString()
			}
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}

	@Test
	fun `レシーバの無い validate も検出する`() {
		val code =
			"""
			package com.example.presentation.authors

			class AuthorsController {
				fun patch(): Unit = validate()

				private fun validate() = Unit
			}
			""".trimIndent()

		assertThatCode(code).hasLintViolationWithoutAutoCorrect(4, 22, MESSAGE)
	}

	@Test
	fun `presentation の外の validate は見ない`() {
		val code =
			"""
			package com.example.application.usecase.postnoteusecase

			class SaveUseCaseImpl {
				fun execute(): Unit = validate()

				fun validate() = Unit
			}
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}

	@Test
	fun `対象のパッケージは editorconfig で変えられる`() {
		val code =
			"""
			package com.example.web.notes

			class NotesController(private val useCase: SaveUseCase) {
				fun save(): String = useCase.validate(null).toString()
			}
			""".trimIndent()

		assertThatCode(code)
			.withEditorConfigOverride(PresentationCallsExecuteOnlyRule.PACKAGES_PROPERTY to "com.example.web")
			.hasLintViolationWithoutAutoCorrect(4, 31, MESSAGE)
	}

	private companion object {
		const val MESSAGE =
			"presentation は UseCase の execute だけを呼ぶ — validate は公開のテストシームで、" +
				"単独で呼ぶのは生成された契約テストだけ(.claude/rules/backend-kotlin.md)。" +
				"検査は execute が validate を呼ぶ形で境界の中で走る(.claude/rules/backend-kotlin.md)"
	}
}
