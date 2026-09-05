package dev.cradle.ktlint

import com.pinterest.ktlint.rule.engine.core.api.AutocorrectDecision
import com.pinterest.ktlint.rule.engine.core.api.ElementType
import com.pinterest.ktlint.rule.engine.core.api.Rule
import com.pinterest.ktlint.rule.engine.core.api.RuleAutocorrectApproveHandler
import com.pinterest.ktlint.rule.engine.core.api.RuleId
import com.pinterest.ktlint.rule.engine.core.api.editorconfig.EditorConfig
import com.pinterest.ktlint.rule.engine.core.api.editorconfig.EditorConfigProperty
import org.ec4j.core.model.PropertyType
import org.jetbrains.kotlin.com.intellij.lang.ASTNode
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtFile

/**
 * 名義(`ActorContext`)を組み立ててよい場所の限定。
 *
 * 「誰として操作しているか」は**認証が決める** — 代理・代行は業務に存在せず、
 * 名義を選ぶ場面も無い。したがって名義はリクエストのペイロードから作ってはならない。
 *
 * ところがこれは字面では守れない。`ActorContext` は生成された data class なので、
 * どこからでも `ActorContext(UserId(request.actorId))` と書けてしまい、書けた時点で
 * 「本文に社員番号を入れれば誰にでもなれる」API が出来上がる。生成された契約テストも
 * ここは守らない — 検証されるのは「与えられた名義の下でのふるまい」までで、
 * **その名義が正しく組み立てられたか**は保証の外にある。
 *
 * そこで構築の**場所**を検査する。許すのは認証アダプタのパッケージだけ
 * (既定は `com.example.presentation.auth` = `ActorContextFactory` の置き場)。
 * 使う側(UseCaseImpl・QueryServiceImpl)は DI で受け取るので構築しない。
 *
 * 判定は `.editorconfig` の次のプロパティで調整する(いずれもカンマ区切り):
 *
 * - `ktlint_cradle_actor_context_site_types` 構築を見張る型の名前
 * - `ktlint_cradle_actor_context_site_allowed_packages` 構築を許すパッケージ(配下を含む)
 *
 * テストは名義を与えて動かすので構築が要る。`.editorconfig` の `[src/test/**/*.kt]` で
 * このルールを切ってある(生成された契約テストも同じ)。
 *
 * 例外を認めるときは構築箇所を含む宣言に `@Suppress("ktlint:cradle:actor-context-site")` を
 * 付けて、**なぜそこで名義を作ってよいのか**を必ずコメントに残す。
 */
class ActorContextSiteRule :
	Rule(
		ruleId = RuleId("${CradleRuleSetProvider.RULE_SET_ID.value}:actor-context-site"),
		about = CradleRuleSetProvider.ABOUT,
		usesEditorConfigProperties = setOf(TYPES_PROPERTY, ALLOWED_PACKAGES_PROPERTY),
	),
	RuleAutocorrectApproveHandler {

	private var types = TYPES_PROPERTY.defaultValue.toNameList()
	private var allowedPackages = ALLOWED_PACKAGES_PROPERTY.defaultValue.toNameList()

	override fun beforeFirstNode(editorConfig: EditorConfig) {
		types = editorConfig[TYPES_PROPERTY].toNameList()
		allowedPackages = editorConfig[ALLOWED_PACKAGES_PROPERTY].toNameList()
	}

	override fun beforeVisitChildNodes(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		if (node.elementType != ElementType.CALL_EXPRESSION) return
		val call = node.psi as? KtCallExpression ?: return
		// `com.example.….ActorContext(…)` と完全修飾で書いても、呼び先の単純名はここに現れる。
		val callee = call.calleeExpression?.text ?: return
		// 突き合わせは大小を無視する。`.editorconfig` の値は ktlint が小文字化して渡すので
		// (`LowerCasingPropertyType`)、素直に `in` で見ると型名は永遠に一致しない。
		if (callee.lowercase() !in types) return

		val file = call.containingKtFile
		if (file.isInAllowedPackage()) return

		emit(
			node.startOffset,
			"${file.packageName()} で $callee を組み立てている。名義は認証が決めるもので、" +
				"ペイロードから作れる場所を増やすと「本文に社員番号を書けば誰にでもなれる」ことになる。" +
				"組み立ててよいのは認証アダプタ(${allowedPackages.joinToString("・")} 配下)だけで、" +
				"使う側は DI で受け取る(.claude/rules/backend-kotlin.md「名義の運び方」)",
			false,
		)
	}

	private fun KtFile.isInAllowedPackage(): Boolean = allowedPackages.any { packageFqName.asString().isUnderPackage(it) }

	private fun KtFile.packageName(): String = packageFqName.asString().ifEmpty { "(既定パッケージ)" }

	/** `com.example.presentation.auth` は配下のサブパッケージにも一致し、`…authX` には一致しない。 */
	private fun String.isUnderPackage(prefix: String): Boolean = this == prefix || startsWith("$prefix.")

	private fun String.toNameList(): List<String> = split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }

	companion object {
		val TYPES_PROPERTY: EditorConfigProperty<String> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_actor_context_site_types",
					"構築を見張る名義の型名(カンマ区切り)",
					PropertyType.PropertyValueParser.IDENTITY_VALUE_PARSER,
				),
				defaultValue = "ActorContext,EnrollingActorContext",
			)

		val ALLOWED_PACKAGES_PROPERTY: EditorConfigProperty<String> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_actor_context_site_allowed_packages",
					"名義の構築を許すパッケージ(カンマ区切り。配下のサブパッケージを含む)",
					PropertyType.PropertyValueParser.IDENTITY_VALUE_PARSER,
				),
				defaultValue = "com.example.presentation.auth",
			)
	}
}
