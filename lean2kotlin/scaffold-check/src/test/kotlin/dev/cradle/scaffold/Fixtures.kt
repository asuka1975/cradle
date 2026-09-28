package dev.cradle.scaffold

// 生成された fixture を実装に写す（具象テストの note() / entity() 用）
internal fun NoteFixture.materialize(): NoteImpl = NoteImpl(id, author, title, closed)
