package dev.cradle.ktlint

import com.pinterest.ktlint.test.KtLintAssertThat.Companion.assertThatRule
import org.junit.jupiter.api.Test

class ActorContextSiteRuleTest {
	private val assertThatCode = assertThatRule { ActorContextSiteRule() }

	@Test
	fun `認証アダプタは名義を組み立てられる`() {
		val code =
			"""
			package com.example.presentation.auth

			class ActorContextFactory {
				fun employee(): ActorContext = ActorContext(EmployeeId(1L))
			}
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}

	@Test
	fun `プレゼンテーションが本文から名義を組み立てるのを検出する`() {
		val code =
			"""
			package com.example.presentation.intent

			class IntentController {
				fun post(request: PostIntentRequest) = usecase.execute(ActorContext(UserId(request.actorId)))
			}
			""".trimIndent()

		assertThatCode(code).hasLintViolationWithoutAutoCorrect(
			4,
			57,
			"com.example.presentation.intent で ActorContext を組み立てている。名義は認証が決めるもので、" +
				"ペイロードから作れる場所を増やすと「本文に社員番号を書けば誰にでもなれる」ことになる。" +
				"組み立ててよいのは認証アダプタ(com.example.presentation.auth 配下)だけで、" +
				"使う側は DI で受け取る(backend-kotlin 規則「名義の運び方」)",
		)
	}

	@Test
	fun `使い始めの名義も同じ扱い`() {
		val code =
			"""
			package com.example.application.usecase.startusingusecase

			class StartUsingUseCaseImpl {
				fun run() = EnrollingActorContext(EmployeeId(1L), DepartmentId(2L))
			}
			""".trimIndent()

		assertThatCode(code).hasLintViolationWithoutAutoCorrect(
			4,
			14,
			"com.example.application.usecase.startusingusecase で EnrollingActorContext を組み立てている。" +
				"名義は認証が決めるもので、" +
				"ペイロードから作れる場所を増やすと「本文に社員番号を書けば誰にでもなれる」ことになる。" +
				"組み立ててよいのは認証アダプタ(com.example.presentation.auth 配下)だけで、" +
				"使う側は DI で受け取る(backend-kotlin 規則「名義の運び方」)",
		)
	}

	@Test
	fun `完全修飾で書いても逃げられない`() {
		val code =
			"""
			package com.example.presentation.loan

			class LoanController {
				fun act() = com.example.domain.application.ActorContext(EmployeeId(1L))
			}
			""".trimIndent()

		assertThatCode(code).hasLintViolationWithoutAutoCorrect(
			4,
			45,
			"com.example.presentation.loan で ActorContext を組み立てている。名義は認証が決めるもので、" +
				"ペイロードから作れる場所を増やすと「本文に社員番号を書けば誰にでもなれる」ことになる。" +
				"組み立ててよいのは認証アダプタ(com.example.presentation.auth 配下)だけで、" +
				"使う側は DI で受け取る(backend-kotlin 規則「名義の運び方」)",
		)
	}

	@Test
	fun `受け取って使うだけなら構築ではない`() {
		val code =
			"""
			package com.example.application.usecase.postintentusecase

			class PostIntentUseCaseImpl(
				private val actor: ActorContext,
			) {
				fun execute() = actor.employee
			}
			""".trimIndent()

		assertThatCode(code).hasNoLintViolations()
	}
}
