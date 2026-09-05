/-
  自前のタグ属性。パス（ディレクトリ・namespace）から導出できない設計判断だけを印で付与する。
  生成器はこの印を**外から**読む — ここに生成配線のコードは書かない。
-/
import Lean

namespace Sprout

open Lean

/-- 集約ルートの印。ルートの選択はディレクトリからは導出できない設計判断。 -/
initialize aggregateRootAttr : TagAttribute ←
  registerTagAttribute `aggregateRoot "集約ルート（トランザクション境界・Repository の単位）"

/-- 値オブジェクトの印（場所ずれの例外用。Domain/ValueObject.lean 在住のものは既定で値の市民）。 -/
initialize valueObjectAttr : TagAttribute ←
  registerTagAttribute `valueObject "値オブジェクト（同一性を持たない値の市民）"

/-- Repository の観測モデルの印。`<Root>RepositoryState ↔ <Root>Repository` の命名規約で対応する。 -/
initialize repositoryStateAttr : TagAttribute ←
  registerTagAttribute `repositoryState "Repository の観測モデル（論理状態）"

/-- 契約定理の印。定理 1 本 = 生成テストのファミリ 1 本。 -/
initialize contractAttr : TagAttribute ←
  registerTagAttribute `contract "契約定理（抽象契約テストの生成源）"

/-- 主体（名義）の調達ポートの印。「いまこの操作をしている人」は状態でも入力でもなく、
    操作といっしょに外から与えられる引数種。 -/
initialize actorContextAttr : TagAttribute ←
  registerTagAttribute `actorContext "操作の主体（名義）の調達ポート"

/-- 障害契約の印。技術的障害で中断されたときに観測されるべき状態を**定義**で表す
    （証明対象ではない — 中断の発生機構はモデル外）。 -/
initialize faultContractAttr : TagAttribute ←
  registerTagAttribute `faultContract "障害契約（障害注入つき契約テストの期待値の源）"

end Sprout
