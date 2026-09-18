package dev.cradle.lobby

import dev.cradle.lobby.domain.entity.Visit
import dev.cradle.lobby.domain.repository.VisitRepository
import dev.cradle.lobby.domain.valueobject.VisitId
import dev.cradle.lobby.domain.valueobject.VisitPhase

/** `Lobby.Application.VisitRepositoryState` の写し。並びは追加順、`update` は同一性で差し替えて並びを保つ。
    観測モデルの制約 `uniqueIds` / `atMostOneExpected` は実 DB の制約と同じく例外で守る — 生成 fixture が制約を破れば赤くなる。 */
class InMemoryVisitRepository : VisitRepository {
	private val visits = mutableListOf<Visit>()

	override fun findById(id: VisitId): Visit? = visits.find { it.id == id }

	override fun findAll(): List<Visit> = visits.toList()

	override fun add(visit: Visit) {
		check(visits.none { it.id == visit.id }) { "duplicate id: ${visit.id}" }
		check(visit.phase == VisitPhase.Left || visits.none { it.phase != VisitPhase.Left }) { "lobby occupied" }
		visits += visit
	}

	override fun update(visit: Visit) {
		val i = visits.indexOfFirst { it.id == visit.id }
		check(visit.phase == VisitPhase.Left || visits.none { it.id != visit.id && it.phase != VisitPhase.Left }) { "lobby occupied" }
		if (i >= 0) visits[i] = visit
	}
}
