/-
  自前のタグ属性。抽出器は必須の 4 つ（aggregateRoot / valueObject / repositoryState / contract）が無いと止まる。
-/
import Lean

namespace Depot

open Lean

initialize aggregateRootAttr : TagAttribute ←
  registerTagAttribute `aggregateRoot "集約ルート（トランザクション境界・Repository の単位）"

initialize valueObjectAttr : TagAttribute ←
  registerTagAttribute `valueObject "値オブジェクト（同一性を持たない値の市民）"

initialize repositoryStateAttr : TagAttribute ←
  registerTagAttribute `repositoryState "Repository の観測モデル（論理状態）"

initialize contractAttr : TagAttribute ←
  registerTagAttribute `contract "契約定理（抽象契約テストの生成源）"

initialize faultContractAttr : TagAttribute ←
  registerTagAttribute `faultContract "障害契約（障害注入つき契約テストの期待値の源）"

end Depot
