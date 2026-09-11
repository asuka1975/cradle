package dev.cradle.scaffold

import dev.cradle.scaffold.domain.valueobject.Title
import dev.cradle.scaffold.domain.valueobject.TitleEntityContractTest

class TitleEntityContractTestImpl : TitleEntityContractTest() {
	override fun title(fixture: TitleFixture): Title = fixture.materialize()
}
