package dev.cradle.ktlint

import com.pinterest.ktlint.rule.engine.core.api.Rule
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import java.io.File
import java.lang.reflect.Modifier

class CradleRuleSetProviderTest {
	@Test
	fun `getRuleProviders はこのパッケージの全ルールを返す(登録漏れの検出)`() {
		val registered: Set<Class<*>> =
			CradleRuleSetProvider()
				.getRuleProviders()
				.map { it.createNewRuleInstance().javaClass }
				.toSet()

		assertThat(registered).containsExactlyInAnyOrderElementsOf(ruleClassesInPackage())
	}

	/** コンパイル済みクラスから Rule の実装を数える。ルールを足して登録し忘れるとここで落ちる。 */
	private fun ruleClassesInPackage(): Set<Class<*>> {
		val classesRoot = File(CradleRuleSetProvider::class.java.protectionDomain.codeSource.location.toURI())
		return classesRoot
			.resolve("dev/cradle/ktlint")
			.listFiles { file: File -> file.extension == "class" && '$' !in file.name }
			.orEmpty()
			.map { Class.forName("dev.cradle.ktlint.${it.nameWithoutExtension}") }
			.filter { Rule::class.java.isAssignableFrom(it) && !Modifier.isAbstract(it.modifiers) }
			.toSet()
	}
}
