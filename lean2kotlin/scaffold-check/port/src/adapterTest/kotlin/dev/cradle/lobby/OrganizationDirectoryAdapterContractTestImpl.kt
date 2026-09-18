package dev.cradle.lobby

import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectory
import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectoryAdapterContractTest
import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectoryFindMemberMember
import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectoryFindMemberOutcome
import dev.cradle.lobby.application.port.organizationdirectory.OrganizationDirectoryFindMemberRequest
import dev.cradle.lobby.runtime.EmployeeId

/** 社員ディレクトリの stub: 社員の表と「答えない」状態。実プロジェクトでは HTTP stub や提供元の sandbox がこの位置に来る。 */
class StubOrganizationDirectory : OrganizationDirectory {
	private val members = mutableMapOf<EmployeeId, OrganizationDirectoryFindMemberMember>()
	var down = false

	fun register(id: EmployeeId, member: OrganizationDirectoryFindMemberMember) { members[id] = member }

	override fun findMember(request: OrganizationDirectoryFindMemberRequest): OrganizationDirectoryFindMemberOutcome {
		if (down) return OrganizationDirectoryFindMemberOutcome.Unavailable
		val m = members[request.employee] ?: return OrganizationDirectoryFindMemberOutcome.Missing
		return OrganizationDirectoryFindMemberOutcome.Found(m)
	}
}

/** 生成された適合テストに stub 相手の Adapter を配線する。各 arrange で stub をその観測を返す状態にしてから要求を返す。 */
class OrganizationDirectoryAdapterContractTestImpl : OrganizationDirectoryAdapterContractTest() {
	private val stub = StubOrganizationDirectory()

	override fun adapter(): OrganizationDirectory = stub

	override fun arrangeFindMemberFound(): OrganizationDirectoryFindMemberRequest {
		stub.down = false
		stub.register(EmployeeId(1L), OrganizationDirectoryFindMemberMember(name = "受入 太郎", active = true))
		return OrganizationDirectoryFindMemberRequest(EmployeeId(1L))
	}

	override fun arrangeFindMemberMissing(): OrganizationDirectoryFindMemberRequest {
		stub.down = false
		return OrganizationDirectoryFindMemberRequest(EmployeeId(404L))
	}

	override fun arrangeFindMemberUnavailable(): OrganizationDirectoryFindMemberRequest {
		stub.down = true
		return OrganizationDirectoryFindMemberRequest(EmployeeId(1L))
	}
}
