package dev.cradle.ktlint

import com.pinterest.ktlint.test.KtLintAssertThat.Companion.assertThatRule
import org.junit.jupiter.api.Test

class NoRepositoryFakeRuleTest {
	private val assertThatCode = assertThatRule { NoRepositoryFakeRule() }

	/** 本番ソース向けの `.editorconfig` と同じ設定を当てる(テストソースは許可なし = 上書きしない)。 */
	private fun assertThatMainSourceCode(code: String) =
		assertThatCode(code)
			.withEditorConfigOverride(NoRepositoryFakeRule.ALLOWED_PACKAGES_PROPERTY to "com.example.infrastructure")

	@Test
	fun `許可パッケージの本番実装は報告しない`() {
		val code =
			"""
			package com.example.infrastructure

			class JooqAlbumRepository(private val dsl: DSLContext) : AlbumRepository
			""".trimIndent()

		assertThatMainSourceCode(code).hasNoLintViolations()
	}

	@Test
	fun `許可パッケージ以外の実装を検出する`() {
		val code =
			"""
			package com.example.application.usecase.postnoteusecase

			class InMemoryAlbumRepository : AlbumRepository
			""".trimIndent()

		assertThatMainSourceCode(code).hasLintViolationWithoutAutoCorrect(
			3,
			7,
			violationFor("InMemoryAlbumRepository", "Repository の実装を置いてよいのは com.example.infrastructure だけ"),
		)
	}

	@Test
	fun `許可が空(テストソースの設定)ならどこでも検出する`() {
		val code =
			"""
			package com.example.infrastructure

			class InMemoryAlbumRepository : AlbumRepository
			""".trimIndent()

		assertThatCode(code).hasLintViolationWithoutAutoCorrect(
			3,
			7,
			violationFor("InMemoryAlbumRepository", "このソースセットに Repository の実装を置いてよい場所はない"),
		)
	}

	@Test
	fun `object 式のフェイクも検出する`() {
		val code =
			"""
			package com.example.application.usecase.postnoteusecase

			class SaveUseCaseImplContractTest {
				fun albumRepository(): AlbumRepository = object : AlbumRepository {}
			}
			""".trimIndent()

		assertThatCode(code).hasLintViolationWithoutAutoCorrect(
			4,
			43,
			violationFor("(匿名)", "このソースセットに Repository の実装を置いてよい場所はない"),
		)
	}

	@Test
	fun `supertype が Repository で終わらなければ見ない`() {
		val code =
			"""
			package com.example.domain.entity

			class AlbumFactoryImpl : AlbumFactory
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}

	@Test
	fun `契約テストの継承は supertype が ContractTest なので見ない`() {
		val code =
			"""
			package com.example.domain.repository

			class JooqAlbumRepositoryContractTest : AlbumRepositoryContractTest()
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}

	@Test
	fun `interface の拡張は実装ではないので見ない`() {
		val code =
			"""
			package com.example.domain.repository

			interface CachedAlbumRepository : AlbumRepository
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}

	private fun violationFor(
		name: String,
		where: String,
	): String = "'$name' が AlbumRepository を実装している。$where。" +
		"テストダミー(InMemory 実装)は本番コードを一切通らないテストを作る — 本番実装を実 DB 相手にそのまま使う(.claude/rules/backend-kotlin.md)"
}
