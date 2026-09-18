/-
  自前のタグ属性。パスから導出できない設計判断だけを印で付与する。生成器はこの印を外から読む。
-/
import Lean

namespace Lobby

open Lean

initialize aggregateRootAttr : TagAttribute ←
  registerTagAttribute `aggregateRoot "集約ルート（トランザクション境界・Repository の単位）"

initialize valueObjectAttr : TagAttribute ←
  registerTagAttribute `valueObject "値オブジェクト（同一性を持たない値の市民）"

initialize repositoryStateAttr : TagAttribute ←
  registerTagAttribute `repositoryState "Repository の観測モデル（論理状態）"

initialize contractAttr : TagAttribute ←
  registerTagAttribute `contract "契約定理（抽象契約テストの生成源）"

initialize actorContextAttr : TagAttribute ←
  registerTagAttribute `actorContext "操作の主体（名義）の調達ポート"

initialize faultContractAttr : TagAttribute ←
  registerTagAttribute `faultContract "障害契約（障害注入つき契約テストの期待値の源）"

end Lobby
