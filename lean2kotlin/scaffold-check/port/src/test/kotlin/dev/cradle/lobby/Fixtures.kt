package dev.cradle.lobby

// 生成された fixture を実装に写す（具象テストの visitorName() / visit() / entity() 用）
internal fun VisitorNameFixture.materialize(): VisitorNameImpl = VisitorNameImpl(text)
internal fun VisitFixture.materialize(): VisitImpl = VisitImpl(id, host, hostName, visitor.materialize(), phase)
