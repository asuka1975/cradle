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
import org.jetbrains.kotlin.psi.KtNameReferenceExpression

/**
 * presentation は UseCase の execute だけを呼ぶ(.claude/rules/backend-kotlin.md)。
 *
 * validate は公開のテストシームで、単独で呼ぶのは生成された契約テストだけ。
 * Controller が validate を呼ぶと、検査が execute の境界(`@Transactional`)の外で走り、
 * 「execute は必ず validate を呼ぶ」(.claude/rules/backend-kotlin.md)という入り口の一致が壊れる。
 * validate 用のエンドポイントも作らない。
 *
 * 検出は「`validate(...)` という名前の呼び出し」の字面で行う(レシーバの型は見ない)。
 * 対象のパッケージは `.editorconfig` の
 * `ktlint_cradle_presentation_calls_execute_only_packages`(カンマ区切り。配下のサブパッケージも含む)。
 *
 * 例外を認めるときは宣言に `@Suppress("ktlint:cradle:presentation-calls-execute-only")` を
 * 付けて、理由をコメントに残す。
 */
class PresentationCallsExecuteOnlyRule :
	Rule(
		ruleId = RuleId("${CradleRuleSetProvider.RULE_SET_ID.value}:presentation-calls-execute-only"),
		about = CradleRuleSetProvider.ABOUT,
		usesEditorConfigProperties = setOf(PACKAGES_PROPERTY),
	),
	RuleAutocorrectApproveHandler {

	private var packages = PACKAGES_PROPERTY.defaultValue.toNameList()

	override fun beforeFirstNode(editorConfig: EditorConfig) {
		packages = editorConfig[PACKAGES_PROPERTY].toNameList()
	}

	override fun beforeVisitChildNodes(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		if (node.elementType != ElementType.CALL_EXPRESSION) return
		val call = node.psi as? KtCallExpression ?: return
		val callee = call.calleeExpression as? KtNameReferenceExpression ?: return
		if (callee.getReferencedName() != VALIDATE) return

		val packageName = call.containingKtFile.packageFqName.asString()
		if (packages.none { packageName.isUnderPackage(it) }) return

		emit(
			callee.textOffset,
			"presentation は UseCase の execute だけを呼ぶ — validate は公開のテストシームで、" +
				"単独で呼ぶのは生成された契約テストだけ(.claude/rules/backend-kotlin.md)。" +
				"検査は execute が validate を呼ぶ形で境界の中で走る(.claude/rules/backend-kotlin.md)",
			false,
		)
	}

	/** `com.example.presentation` は `com.example.presentation.notes` にも一致する。 */
	private fun String.isUnderPackage(prefix: String): Boolean = this == prefix || startsWith("$prefix.")

	private fun String.toNameList(): List<String> = split(',').map { it.trim() }.filter { it.isNotEmpty() }

	companion object {
		private const val VALIDATE = "validate"

		val PACKAGES_PROPERTY: EditorConfigProperty<String> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_presentation_calls_execute_only_packages",
					"validate の呼び出しを禁じるパッケージ(カンマ区切り。配下のサブパッケージも含む)",
					PropertyType.PropertyValueParser.IDENTITY_VALUE_PARSER,
				),
				defaultValue = "com.example.presentation",
			)
	}
}
