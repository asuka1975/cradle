package dev.cradle.ktlint

import com.pinterest.ktlint.test.KtLintAssertThat.Companion.assertThatRule
import com.pinterest.ktlint.test.LintViolation
import org.junit.jupiter.api.Test

class JavaConfigBeanRuleTest {
	private val assertThatCode = assertThatRule { JavaConfigBeanRule() }

	@Test
	fun `自前クラスを組み立てるだけの Bean を報告する`() {
		val code =
			"""
			package com.example.config

			import com.example.infra.jooq.JooqAlbumRepository
			import org.springframework.context.annotation.Bean
			import org.springframework.context.annotation.Configuration

			@Configuration(proxyBeanMethods = false)
			class CradleConfiguration {
				@Bean
				fun albumRepository(dsl: DSLContext): AlbumRepository = JooqAlbumRepository(dsl)

				@Bean
				fun idGenerator(dsl: DSLContext): IdGenerator {
					return SequenceIdGenerator(dsl)
				}
			}
			""".trimIndent()

		assertThatCode(code)
			.withEditorConfigOverride(JavaConfigBeanRule.PROJECT_PACKAGE_PREFIX_PROPERTY to "com.example")
			.hasLintViolationsWithoutAutoCorrect(
				LintViolation(
					10,
					6,
					"@Bean fun albumRepository() は JooqAlbumRepository を組み立てるだけの配線。" +
						"JooqAlbumRepository に @Component(@Service / @Repository)を付けてコンポーネントスキャンさせる",
				),
				LintViolation(
					13,
					6,
					"@Bean fun idGenerator() は SequenceIdGenerator を組み立てるだけの配線。" +
						"SequenceIdGenerator に @Component(@Service / @Repository)を付けてコンポーネントスキャンさせる",
				),
			)
	}

	@Test
	fun `第三者ライブラリの型を組み立てる Bean は報告しない`() {
		val code =
			"""
			package com.example.config

			import org.springframework.context.annotation.Bean
			import org.springframework.context.annotation.Configuration
			import tools.jackson.databind.ObjectMapper

			@Configuration(proxyBeanMethods = false)
			class CradleConfiguration {
				@Bean
				fun objectMapper(): ObjectMapper = ObjectMapper()
			}
			""".trimIndent()

		assertThatCode(code)
			.withEditorConfigOverride(JavaConfigBeanRule.PROJECT_PACKAGE_PREFIX_PROPERTY to "com.example")
			.hasNoLintViolations()
	}

	@Test
	fun `ファクトリ経由や組み立てを伴う Bean は既定では報告しない`() {
		val code =
			"""
			package com.example.config

			import com.example.infra.jooq.JooqSettings
			import org.springframework.context.annotation.Bean

			@Configuration(proxyBeanMethods = false)
			class CradleConfiguration {
				@Bean
				fun jooqSettings(): Settings = JooqSettings.settings()
			}
			""".trimIndent()

		assertThatCode(code)
			.withEditorConfigOverride(JavaConfigBeanRule.PROJECT_PACKAGE_PREFIX_PROPERTY to "com.example")
			.hasNoLintViolations()
	}

	@Test
	fun `report_all ならすべての Bean を報告する`() {
		val code =
			"""
			package com.example.config

			import com.example.infra.jooq.JooqSettings
			import org.springframework.context.annotation.Bean

			@Configuration(proxyBeanMethods = false)
			class CradleConfiguration {
				@Bean
				fun jooqSettings(): Settings = JooqSettings.settings()
			}
			""".trimIndent()

		assertThatCode(code)
			.withEditorConfigOverride(
				JavaConfigBeanRule.PROJECT_PACKAGE_PREFIX_PROPERTY to "com.example",
				JavaConfigBeanRule.REPORT_ALL_PROPERTY to true,
			).hasLintViolationsWithoutAutoCorrect(
				LintViolation(
					9,
					6,
					"@Bean fun jooqSettings() — Bean は @Component 系のアノテーションで宣言する。" +
						"Java Config でしか書けないなら @Suppress(\"ktlint:cradle:java-config-bean\") で理由を残す",
				),
			)
	}

	@Test
	fun `Bean でない関数は見ない`() {
		val code =
			"""
			package com.example.app

			import com.example.infra.jooq.JooqAlbumRepository

			class Wiring {
				fun albumRepository(dsl: DSLContext) = JooqAlbumRepository(dsl)
			}
			""".trimIndent()

		assertThatCode(code)
			.withEditorConfigOverride(JavaConfigBeanRule.PROJECT_PACKAGE_PREFIX_PROPERTY to "com.example")
			.hasNoLintViolations()
	}

	@Test
	fun `宣言に付けた Suppress で抑止できる`() {
		val code =
			"""
			package com.example.config

			import com.example.infra.jooq.JooqAlbumRepository
			import org.springframework.context.annotation.Bean

			@Configuration(proxyBeanMethods = false)
			class CradleConfiguration {
				// 生成された interface にはアノテーションを付けられないため、ここで配線する
				@Suppress("ktlint:cradle:java-config-bean")
				@Bean
				fun albumRepository(dsl: DSLContext): AlbumRepository = JooqAlbumRepository(dsl)
			}
			""".trimIndent()

		assertThatCode(code)
			.withEditorConfigOverride(JavaConfigBeanRule.PROJECT_PACKAGE_PREFIX_PROPERTY to "com.example")
			.hasNoLintViolations()
	}
}
