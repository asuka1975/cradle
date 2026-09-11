package dev.cradle.scaffold

// 生成された fixture を実装に写す（具象テストの title() / note() / entity() 用）
internal fun TitleFixture.materialize(): TitleImpl = TitleImpl(text)
internal fun NoteFixture.materialize(): NoteImpl = NoteImpl(id, author, title.materialize(), closed)
