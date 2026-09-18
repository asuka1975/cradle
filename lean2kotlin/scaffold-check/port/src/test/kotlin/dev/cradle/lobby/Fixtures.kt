package dev.cradle.lobby

// 生成された fixture を実装に写す（具象テストの visitorName() / visit() / paymentAttempt() / entity() 用）
internal fun VisitorNameFixture.materialize(): VisitorNameImpl = VisitorNameImpl(text)
internal fun VisitFixture.materialize(): VisitImpl = VisitImpl(id, host, hostName, visitor.materialize(), phase)
internal fun PaymentAttemptFixture.materialize(): PaymentAttemptImpl = PaymentAttemptImpl(id, visit, amount, tries, phase)
