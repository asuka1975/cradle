-- ライブラリルート。抽出のドライバは `import Depot` で全モジュールを読む。
import Depot.Domain.Annotations
import Depot.Domain.Error
import Depot.Domain.ValueObject
import Depot.Domain.Entity.Order
import Depot.Domain.DomainService.Refund
import Depot.Application.UseCase.PlaceOrderUseCase.Command
import Depot.Application.UseCase.PlaceOrderUseCase.UseCase
import Depot.Application.UseCase.StockUseCase.QueryService
import Depot.Laws.Nominations
