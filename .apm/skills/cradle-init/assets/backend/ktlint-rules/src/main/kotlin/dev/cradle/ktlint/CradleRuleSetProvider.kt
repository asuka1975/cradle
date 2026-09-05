package dev.cradle.ktlint

import com.pinterest.ktlint.cli.ruleset.core.api.RuleSetProviderV3
import com.pinterest.ktlint.rule.engine.core.api.Rule
import com.pinterest.ktlint.rule.engine.core.api.RuleProvider
import com.pinterest.ktlint.rule.engine.core.api.RuleSetId

/**
 * Cradle 独自のルールセット。ktlint 標準ルールが見ない「設計上の作法」だけを扱う。
 *
 * `META-INF/services/com.pinterest.ktlint.cli.ruleset.core.api.RuleSetProviderV3` から
 * ServiceLoader で読まれる。ルールは既定で有効。個別に切るときは `.editorconfig` に
 * `ktlint_cradle_<rule-id> = disabled`、まとめて切るときは `ktlint_cradle = disabled`。
 */
class CradleRuleSetProvider : RuleSetProviderV3(RULE_SET_ID) {
	override fun getRuleProviders(): Set<RuleProvider> = setOf(
		RuleProvider { SingleClassPerFileRule() },
		RuleProvider { JavaConfigBeanRule() },
		RuleProvider { JooqAccessSiteRule() },
		RuleProvider { PackageRootDeclarationRule() },
		RuleProvider { BypassSiteRule() },
		RuleProvider { PresentationCallsExecuteOnlyRule() },
		RuleProvider { NoRepositoryFakeRule() },
		RuleProvider { ActorContextSiteRule() },
	)

	companion object {
		val RULE_SET_ID = RuleSetId("cradle")

		/** 違反時のスタックトレースや IDE から辿れる出自。 */
		val ABOUT =
			Rule.About(
				maintainer = "Cradle",
				repositoryUrl = "https://github.com/asuka1975/cradle",
				issueTrackerUrl = "https://github.com/asuka1975/cradle/issues",
			)
	}
}
