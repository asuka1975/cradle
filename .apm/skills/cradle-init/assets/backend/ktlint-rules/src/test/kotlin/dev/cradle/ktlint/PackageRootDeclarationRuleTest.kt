package dev.cradle.ktlint

import com.pinterest.ktlint.test.KtLintAssertThat.Companion.assertThatRule
import com.pinterest.ktlint.test.LintViolation
import org.junit.jupiter.api.Test

class PackageRootDeclarationRuleTest {
	private val assertThatCode = assertThatRule { PackageRootDeclarationRule() }

	/** 本番の `.editorconfig` と同じ設定を当てる。 */
	private fun assertThatConfiguredCode(code: String) =
		assertThatCode(code)
			.withEditorConfigOverride(PackageRootDeclarationRule.PACKAGES_PROPERTY to "com.example.application")

	@Test
	fun `対象パッケージのサブパッケージは置いてよい`() {
		val code =
			"""
			package com.example.application.usecase.save

			fun interface IdBlockGenerator {
				fun nextIds(count: Int): List<Long>
			}
			""".trimIndent()

		assertThatConfiguredCode(code).hasNoLintViolations()
	}

	@Test
	fun `対象でないパッケージの直下は置いてよい`() {
		val code =
			"""
			package com.example.infrastructure

			class RowSeeding
			""".trimIndent()

		assertThatConfiguredCode(code).hasNoLintViolations()
	}

	@Test
	fun `対象パッケージ直下のクラスを検出する`() {
		val code =
			"""
			package com.example.application

			class NoteWithTags
			""".trimIndent()

		assertThatConfiguredCode(code).hasLintViolationWithoutAutoCorrect(3, 7, violationFor("NoteWithTags"))
	}

	@Test
	fun `トップレベル関数とプロパティも検出する`() {
		val code =
			"""
			package com.example.application

			fun fetchAllNotesWithTags() = Unit

			val createdOnDescending = 1
			""".trimIndent()

		assertThatConfiguredCode(code).hasLintViolationsWithoutAutoCorrect(
			LintViolation(3, 5, violationFor("fetchAllNotesWithTags")),
			LintViolation(5, 5, violationFor("createdOnDescending")),
		)
	}

	@Test
	fun `入れ子の宣言は数えない`() {
		val code =
			"""
			package com.example.application.usecase.recommended

			class RecommendedQueryServiceImpl {
				private data class Row(val id: Long)
			}
			""".trimIndent()

		assertThatConfiguredCode(code).hasNoLintViolations()
	}

	@Test
	fun `対象パッケージが未設定なら何も検出しない`() {
		val code =
			"""
			package com.example.application

			class NoteWithTags
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}

	private fun violationFor(name: String): String =
		"'$name' が com.example.application 直下にある。ここは .claude/rules/backend-kotlin.md が定義していない置き場で、" +
			"どの層にも属さない共有ヘルパの溜まり場になる。使う側の usecase/<ユースケース名>/ か、" +
			"層をまたぐものなら infrastructure/ など役割の決まった場所へ移す"
}
