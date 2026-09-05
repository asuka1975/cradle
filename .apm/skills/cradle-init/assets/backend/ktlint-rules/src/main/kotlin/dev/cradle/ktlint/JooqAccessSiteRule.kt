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
import org.jetbrains.kotlin.lexer.KtTokens
import org.jetbrains.kotlin.psi.KtClassOrObject
import org.jetbrains.kotlin.psi.KtFile
import org.jetbrains.kotlin.psi.KtImportDirective
import org.jetbrains.kotlin.psi.KtNamedDeclaration
import org.jetbrains.kotlin.psi.KtPackageDirective

/**
 * jOOQ に触ってよい場所の限定。
 *
 * 参照系の QueryService は「抽象化層を挟まず直接 ORM にアクセスする」(.claude/rules/backend-kotlin.md)。
 * この規約は「画面ごとに読み取りモデルを独立させる」ためにあるが、**共有のクエリヘルパを
 * `DSLContext` の拡張関数として書くと字面では違反にならない** — 呼び出し側は
 * `dsl.fetchAll…()` で jOOQ を直接叩いているのと区別がつかず、interface もポートも
 * 現れないからである(共有ヘルパの置き場になりやすい — 複数画面で共有した
 * 結果、中間型が画面の**和集合**に育ち、どの画面も読まない列を運んでいた)。
 *
 * そこで「層を挟んだか」ではなく **「どのファイルが jOOQ を import してよいか」** を検査する。
 * 許可するのは infrastructure 側のパッケージと、`*QueryServiceImpl` を宣言するファイルだけ。
 * 共有ヘルパはどちらにも当てはまらないので、書けば必ず落ちる。
 *
 * import の検査には抜け道が 2 つあるので、同じルールで塞ぐ:
 *
 * - **完全修飾の参照** — import を書かず `org.jooq.impl.DSL.field(...)` と書けば
 *   import には映らない。監視接頭辞で始まる修飾参照も同じ違反として報告する。
 * - **許可されたファイルへの同居** — 接尾辞で許可されたファイル(`*QueryServiceImpl`)に
 *   非 private のトップレベル宣言を置くと、そこが共有クエリヘルパの置き場になる。
 *   許可された型以外のトップレベル宣言は **private でなければならない**。
 *
 * 判定は `.editorconfig` の次のプロパティで調整する(いずれもカンマ区切り):
 *
 * - `ktlint_cradle_jooq_access_site_import_prefixes` 監視する import の接頭辞
 * - `ktlint_cradle_jooq_access_site_allowed_packages` 無条件に許すパッケージ
 * - `ktlint_cradle_jooq_access_site_allowed_type_suffixes` 許す型名の接尾辞
 *
 * テストは実 DB を相手にする(fake を挟まない — .claude/rules/backend-kotlin.md)ため jOOQ に触る必要がある。
 * `.editorconfig` の `[src/test/**/*.kt]` でこのルールを切ってある。
 *
 * 例外を認めるときは **ファイル先頭に** `@file:Suppress("ktlint:cradle:jooq-access-site")` を
 * 付けて、理由をコメントに残す(違反の報告位置が import 宣言なので宣言単位の抑止は効かない。
 * 同居の違反だけは宣言の位置で報告するので、宣言に付けた `@Suppress` も効く)。
 */
class JooqAccessSiteRule :
	Rule(
		ruleId = RuleId("${CradleRuleSetProvider.RULE_SET_ID.value}:jooq-access-site"),
		about = CradleRuleSetProvider.ABOUT,
		usesEditorConfigProperties = setOf(IMPORT_PREFIXES_PROPERTY, ALLOWED_PACKAGES_PROPERTY, ALLOWED_TYPE_SUFFIXES_PROPERTY),
	),
	RuleAutocorrectApproveHandler {

	private var importPrefixes = IMPORT_PREFIXES_PROPERTY.defaultValue.toNameList()
	private var allowedPackages = ALLOWED_PACKAGES_PROPERTY.defaultValue.toNameList()
	private var allowedTypeSuffixes = ALLOWED_TYPE_SUFFIXES_PROPERTY.defaultValue.toNameList()

	/** 1 ファイルにつき 1 回だけ報告する(import が何本あっても言いたいことは同じ)。 */
	private var reported = false

	override fun beforeFirstNode(editorConfig: EditorConfig) {
		importPrefixes = editorConfig[IMPORT_PREFIXES_PROPERTY].toNameList()
		allowedPackages = editorConfig[ALLOWED_PACKAGES_PROPERTY].toNameList()
		allowedTypeSuffixes = editorConfig[ALLOWED_TYPE_SUFFIXES_PROPERTY].toNameList()
	}

	override fun beforeVisitChildNodes(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		when (node.elementType) {
			ElementType.IMPORT_DIRECTIVE -> visitImportDirective(node, emit)
			ElementType.DOT_QUALIFIED_EXPRESSION -> visitQualifiedReference(node, emit)
			in TOP_LEVEL_DECLARATION_TYPES -> visitTopLevelDeclaration(node, emit)
		}
	}

	private fun visitImportDirective(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		if (reported) return
		val directive = node.psi as? KtImportDirective ?: return
		val imported = directive.importedFqName?.asString() ?: return
		if (importPrefixes.none { imported.isUnderPackage(it) }) return

		val file = directive.containingKtFile
		if (file.isAllowedAccessSite()) return

		reported = true
		emit(node.startOffset, disallowedSiteMessage(file, "$imported を import している"), false)
	}

	/** import せず `org.jooq.impl.DSL.field(...)` のように完全修飾で書いた場合も同じ違反。 */
	private fun visitQualifiedReference(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		if (reported) return
		val path = node.text.leadingDottedPath()
		if (importPrefixes.none { path.isUnderPackage(it) }) return
		// import・package 宣言の中の修飾名は import の検査が見るのでここでは見ない
		if (node.isInsideImportOrPackageDirective()) return

		val file = node.psi.containingFile as? KtFile ?: return
		if (file.isAllowedAccessSite()) return

		reported = true
		emit(node.startOffset, disallowedSiteMessage(file, "$path を完全修飾で参照している"), false)
	}

	/** 接尾辞で許可されたファイルでは、許可された型以外のトップレベル宣言は private に限る。 */
	private fun visitTopLevelDeclaration(
		node: ASTNode,
		emit: (offset: Int, errorMessage: String, canBeAutoCorrected: Boolean) -> AutocorrectDecision,
	) {
		val declaration = node.psi as? KtNamedDeclaration ?: return
		// 入れ子の宣言は対象外(トップレベルだけを見る)
		if (declaration.parent !is KtFile) return

		val file = declaration.containingKtFile
		// パッケージで許可された場所(infrastructure 側)は同居の制限を受けない
		if (file.isInAllowedPackage() || !file.declaresAllowedSuffixType()) return
		if (declaration.hasAllowedTypeSuffix()) return
		if (declaration.hasModifier(KtTokens.PRIVATE_KEYWORD)) return

		val name = declaration.name ?: "(匿名)"
		emit(
			declaration.nameIdentifier?.textOffset ?: declaration.textOffset,
			"'$name' が ${allowedTypeSuffixes.joinToString("・") { "*$it" }} のファイルに private でない形で同居している。" +
				"接尾辞の許可は jOOQ の接点を 1 ファイルに閉じるためのもので、公開のトップレベル宣言は共有クエリヘルパの再来になる。" +
				"private にするか、役割の決まった場所へ移す(.claude/rules/backend-kotlin.md)",
			false,
		)
	}

	private fun disallowedSiteMessage(file: KtFile, offence: String): String {
		val packageName = file.packageFqName.asString().ifEmpty { "(既定パッケージ)" }
		return "$packageName は jOOQ に触ってよい場所ではない($offence)。" +
			"許されるのは ${allowedPackages.joinToString("・")} と " +
			"${allowedTypeSuffixes.joinToString("・") { "*$it" }} を宣言するファイルだけ。" +
			"画面をまたぐクエリヘルパを作らず、各 QueryServiceImpl に直接書く(.claude/rules/backend-kotlin.md)。" +
			"DSLContext の拡張関数にしても、共有すれば同じ抽象化層である"
	}

	/** infrastructure 側のパッケージか、許された接尾辞の型(= QueryServiceImpl)を宣言しているか。 */
	private fun KtFile.isAllowedAccessSite(): Boolean = isInAllowedPackage() || declaresAllowedSuffixType()

	private fun KtFile.isInAllowedPackage(): Boolean = allowedPackages.any { packageFqName.asString().isUnderPackage(it) }

	private fun KtFile.declaresAllowedSuffixType(): Boolean = declarations
		.filterIsInstance<KtClassOrObject>()
		.any { it.hasAllowedTypeSuffix() }

	private fun KtNamedDeclaration.hasAllowedTypeSuffix(): Boolean =
		this is KtClassOrObject && allowedTypeSuffixes.any { name?.endsWith(it) == true }

	private fun ASTNode.isInsideImportOrPackageDirective(): Boolean {
		var current = psi.parent
		while (current != null) {
			if (current is KtImportDirective || current is KtPackageDirective) return true
			if (current is KtFile) return false
			current = current.parent
		}
		return false
	}

	/** `org.jooq.impl.DSL.field("id")` から先頭の修飾名 `org.jooq.impl.DSL.field` を取り出す。 */
	private fun String.leadingDottedPath(): String = takeWhile { it.isLetterOrDigit() || it == '.' || it == '_' }

	/** `com.example.infra` は `com.example.infra` と `com.example.infra.jooq` に一致し、`com.example.infraX` には一致しない。 */
	private fun String.isUnderPackage(prefix: String): Boolean = this == prefix || startsWith("$prefix.")

	private fun String.toNameList(): List<String> = split(',').map { it.trim() }.filter { it.isNotEmpty() }

	companion object {
		private val TOP_LEVEL_DECLARATION_TYPES =
			setOf(
				ElementType.CLASS,
				ElementType.OBJECT_DECLARATION,
				ElementType.FUN,
				ElementType.PROPERTY,
				ElementType.TYPEALIAS,
			)

		val IMPORT_PREFIXES_PROPERTY: EditorConfigProperty<String> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_jooq_access_site_import_prefixes",
					"jOOQ への依存と見なす import の接頭辞(カンマ区切り)",
					PropertyType.PropertyValueParser.IDENTITY_VALUE_PARSER,
				),
				defaultValue = "org.jooq",
			)

		val ALLOWED_PACKAGES_PROPERTY: EditorConfigProperty<String> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_jooq_access_site_allowed_packages",
					"jOOQ に触ってよいパッケージ(カンマ区切り。配下のサブパッケージも含む)",
					PropertyType.PropertyValueParser.IDENTITY_VALUE_PARSER,
				),
				defaultValue = "",
			)

		val ALLOWED_TYPE_SUFFIXES_PROPERTY: EditorConfigProperty<String> =
			EditorConfigProperty(
				type =
				PropertyType.LowerCasingPropertyType(
					"ktlint_cradle_jooq_access_site_allowed_type_suffixes",
					"パッケージによらず jOOQ に触ってよい型名の接尾辞(カンマ区切り)",
					PropertyType.PropertyValueParser.IDENTITY_VALUE_PARSER,
				),
				defaultValue = "QueryServiceImpl",
			)
	}
}
