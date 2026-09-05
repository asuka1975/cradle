package dev.cradle.ktlint

import com.pinterest.ktlint.test.KtLintAssertThat.Companion.assertThatRule
import com.pinterest.ktlint.test.LintViolation
import org.junit.jupiter.api.Test

class JooqAccessSiteRuleTest {
	private val assertThatCode = assertThatRule { JooqAccessSiteRule() }

	/** 本番の `.editorconfig` と同じ設定を当てる。 */
	private fun assertThatConfiguredCode(code: String) =
		assertThatCode(code)
			.withEditorConfigOverride(JooqAccessSiteRule.ALLOWED_PACKAGES_PROPERTY to ALLOWED_PACKAGES)

	@Test
	fun `jOOQ を import しなければ場所を問わない`() {
		val code =
			"""
			package com.example.application

			class NoteTagSupport
			""".trimIndent()

		assertThatConfiguredCode(code).hasNoLintViolations()
	}

	@Test
	fun `infrastructure は jOOQ に触ってよい`() {
		val code =
			"""
			package com.example.infrastructure

			import org.jooq.DSLContext

			class JooqAlbumRepository(private val dsl: DSLContext)
			""".trimIndent()

		assertThatConfiguredCode(code).hasNoLintViolations()
	}

	@Test
	fun `許したパッケージのサブパッケージも触ってよい`() {
		val code =
			"""
			package com.example.infra.jooq

			import org.jooq.conf.Settings

			object JooqSettings {
				fun settings(): Settings = Settings()
			}
			""".trimIndent()

		assertThatConfiguredCode(code).hasNoLintViolations()
	}

	@Test
	fun `QueryServiceImpl は場所によらず触ってよい`() {
		val code =
			"""
			package com.example.application.usecase.timeline

			import org.jooq.DSLContext

			class TimelineQueryServiceImpl(private val dsl: DSLContext)
			""".trimIndent()

		assertThatConfiguredCode(code).hasNoLintViolations()
	}

	@Test
	fun `共有のクエリヘルパは DSLContext の拡張関数でも検出する`() {
		val code =
			"""
			package com.example.application

			import org.jooq.DSLContext

			fun DSLContext.fetchAllNotesWithTags(): List<String> = emptyList()
			""".trimIndent()

		assertThatConfiguredCode(code)
			.hasLintViolationWithoutAutoCorrect(3, 1, violationFor("com.example.application", "org.jooq.DSLContext"))
	}

	@Test
	fun `QueryServiceImpl でない画面のクラスは検出する`() {
		val code =
			"""
			package com.example.application.usecase.timeline

			import org.jooq.DSLContext

			class TimelineUseCaseImpl(private val dsl: DSLContext)
			""".trimIndent()

		assertThatConfiguredCode(code)
			.hasLintViolationWithoutAutoCorrect(
				3,
				1,
				violationFor("com.example.application.usecase.timeline", "org.jooq.DSLContext"),
			)
	}

	@Test
	fun `presentation から jOOQ を触るのも検出する`() {
		val code =
			"""
			package com.example.presentation.notes

			import org.jooq.DSLContext

			class NotesController(private val dsl: DSLContext)
			""".trimIndent()

		assertThatConfiguredCode(code)
			.hasLintViolationWithoutAutoCorrect(3, 1, violationFor("com.example.presentation.notes", "org.jooq.DSLContext"))
	}

	@Test
	fun `import が複数あっても報告は 1 回だけ`() {
		val code =
			"""
			package com.example.application

			import org.jooq.DSLContext
			import org.jooq.Record

			fun DSLContext.fetch(): Record? = null
			""".trimIndent()

		assertThatConfiguredCode(code).hasLintViolationsWithoutAutoCorrect(
			LintViolation(3, 1, violationFor("com.example.application", "org.jooq.DSLContext")),
		)
	}

	@Test
	fun `監視する接頭辞は editorconfig で足せる`() {
		val code =
			"""
			package com.example.application

			import com.example.infra.jooq.generated.Tables

			val tables = Tables
			""".trimIndent()

		assertThatCode(code)
			.withEditorConfigOverride(
				JooqAccessSiteRule.ALLOWED_PACKAGES_PROPERTY to ALLOWED_PACKAGES,
				JooqAccessSiteRule.IMPORT_PREFIXES_PROPERTY to "org.jooq,com.example.infra.jooq.generated",
			).hasLintViolationWithoutAutoCorrect(
				3,
				1,
				violationFor("com.example.application", "com.example.infra.jooq.generated.Tables"),
			)
	}

	@Test
	fun `完全修飾の参照は import が無くても検出する`() {
		val code =
			"""
			package com.example.application

			val albumCount = org.jooq.impl.DSL.field("count")
			""".trimIndent()

		assertThatConfiguredCode(code)
			.hasLintViolationWithoutAutoCorrect(
				3,
				18,
				qualifiedViolationFor("com.example.application", "org.jooq.impl.DSL.field"),
			)
	}

	@Test
	fun `完全修飾でも QueryServiceImpl のファイルなら触ってよい`() {
		val code =
			"""
			package com.example.application.usecase.timeline

			class TimelineQueryServiceImpl {
				fun countField(): Any = org.jooq.impl.DSL.field("count")
			}
			""".trimIndent()

		assertThatConfiguredCode(code).hasNoLintViolations()
	}

	@Test
	fun `QueryServiceImpl のファイルの private なトップレベル宣言は同居してよい`() {
		val code =
			"""
			package com.example.application.usecase.recommended

			import org.jooq.DSLContext

			private const val MIX_MODULUS = 65521L

			private fun mix(seed: Long): Long = seed % MIX_MODULUS

			class RecommendedQueryServiceImpl(private val dsl: DSLContext)
			""".trimIndent()

		assertThatConfiguredCode(code).hasNoLintViolations()
	}

	@Test
	fun `QueryServiceImpl のファイルに非 private のトップレベル宣言が同居したら検出する`() {
		val code =
			"""
			package com.example.application.usecase.timeline

			import org.jooq.DSLContext

			fun sharedOrdering(): Long = 1L

			internal val sharedLimit = 10

			class TimelineQueryServiceImpl(private val dsl: DSLContext)
			""".trimIndent()

		assertThatConfiguredCode(code).hasLintViolationsWithoutAutoCorrect(
			LintViolation(5, 5, cohabitationViolationFor("sharedOrdering")),
			LintViolation(7, 14, cohabitationViolationFor("sharedLimit")),
		)
	}

	@Test
	fun `許可パッケージのファイルでは非 private の同居も見ない`() {
		val code =
			"""
			package com.example.infrastructure

			import org.jooq.DSLContext

			fun seedRows(dsl: DSLContext) = Unit

			class MaintenanceQueryServiceImpl(private val dsl: DSLContext)
			""".trimIndent()

		assertThatConfiguredCode(code).hasNoLintViolations()
	}

	private fun violationFor(
		packageName: String,
		imported: String,
	): String = disallowedSiteViolationFor(packageName, "$imported を import している")

	private fun qualifiedViolationFor(
		packageName: String,
		reference: String,
	): String = disallowedSiteViolationFor(packageName, "$reference を完全修飾で参照している")

	private fun disallowedSiteViolationFor(
		packageName: String,
		offence: String,
	): String = "$packageName は jOOQ に触ってよい場所ではない($offence)。" +
		"許されるのは com.example.infrastructure・com.example.infra と *QueryServiceImpl を宣言するファイルだけ。" +
		"画面をまたぐクエリヘルパを作らず、各 QueryServiceImpl に直接書く(.claude/rules/backend-kotlin.md)。" +
		"DSLContext の拡張関数にしても、共有すれば同じ抽象化層である"

	private fun cohabitationViolationFor(name: String): String =
		"'$name' が *QueryServiceImpl のファイルに private でない形で同居している。" +
			"接尾辞の許可は jOOQ の接点を 1 ファイルに閉じるためのもので、公開のトップレベル宣言は共有クエリヘルパの再来になる。" +
			"private にするか、役割の決まった場所へ移す(.claude/rules/backend-kotlin.md)"

	private companion object {
		const val ALLOWED_PACKAGES = "com.example.infrastructure,com.example.infra"
	}
}
