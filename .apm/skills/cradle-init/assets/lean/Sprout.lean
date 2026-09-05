-- ライブラリルート。モジュールを追加したらここに import を足す。
-- 層の壁（cradle lean-check が検査する）:
--   Domain      ← 何も import しない（Prelude のみ）
--   Application ← Domain だけ（Runtime を知らない）
--   Runtime     ← Domain / Application（表現の仮置き・境界 — 非規範）
--   Laws        ← Runtime（保証の転送）
import Sprout.Prelude
import Sprout.Domain.Annotations
import Sprout.Domain.ValueObject
import Sprout.Domain.Error
import Sprout.Domain.Entity.Note
import Sprout.Application.ActorContext
import Sprout.Application.RepositoryState
import Sprout.Application.ReadModel
import Sprout.Application.View
import Sprout.Application.Projection
import Sprout.Application.UseCase.PostNoteUseCase.Command
import Sprout.Application.UseCase.PostNoteUseCase.UseCase
import Sprout.Application.UseCase.CloseNoteUseCase.Command
import Sprout.Application.UseCase.CloseNoteUseCase.UseCase
import Sprout.Application.UseCase.NotesUseCase.ReadModel
import Sprout.Application.UseCase.NotesUseCase.QueryService
import Sprout.Application.UseCase.NotesUseCase.UseCase
import Sprout.Runtime.Ids
import Sprout.Runtime.Command
import Sprout.Runtime.Machine
import Sprout.Runtime.Reachable
import Sprout.Runtime.Views
import Sprout.Runtime.Json
import Sprout.Runtime.Scenarios
import Sprout.Laws.Properties
