import { canResetGame, canonicalFen, newGameFen, validateMove } from './chessRules';
import type { MoveRejectCode, MoveRequestPayload, PlayerColor, StoredRoomState } from './types';
import { isObjectRecord } from '../../shared/realtimeProtocol';

const ROOM_STORAGE_KEY = 'room-state';

interface SessionRoleContext {
  role: 'player' | 'spectator';
  color: PlayerColor | null;
}

type MoveApplyResult =
  | { ok: true; fen: string }
  | { ok: false; code: MoveRejectCode };

export class RoomStateStore {
  private readonly state: DurableObjectState;
  private fen = newGameFen();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  getFen(): string {
    return this.fen;
  }

  async hydrate(): Promise<void> {
    const persisted = await this.state.storage.get<StoredRoomState>(ROOM_STORAGE_KEY);
    if (!persisted?.fen) {
      return;
    }

    const parsedFen = canonicalFen(persisted.fen);
    if (parsedFen) {
      this.fen = parsedFen;
    }
  }

  parseMoveRequestPayload(payload: unknown): MoveRequestPayload | null {
    if (!isObjectRecord(payload)) {
      return null;
    }

    const rawRequestId = payload.requestId;
    const rawFen = payload.fen;
    if (typeof rawRequestId !== 'string' || typeof rawFen !== 'string') {
      return null;
    }

    const requestId = rawRequestId.trim();
    if (!requestId || requestId.length > 64) {
      return null;
    }

    return { requestId, fen: rawFen };
  }

  async applyMove(request: MoveRequestPayload, session: SessionRoleContext): Promise<MoveApplyResult> {
    const result = validateMove({
      currentFen: this.fen,
      nextFen: request.fen,
      role: session.role,
      color: session.color,
    });
    if ('code' in result) {
      return { ok: false, code: result.code };
    }

    this.fen = result.nextFen;
    await this.persist();
    return { ok: true, fen: this.fen };
  }

  async reset(role: 'player' | 'spectator'): Promise<{ ok: true; fen: string } | { ok: false; code: 'spectator-cannot-reset' }> {
    const result = canResetGame(role);
    if ('code' in result) {
      return result;
    }

    this.fen = newGameFen();
    await this.persist();
    return { ok: true, fen: this.fen };
  }

  private async persist(): Promise<void> {
    await this.state.storage.put(ROOM_STORAGE_KEY, { fen: this.fen } satisfies StoredRoomState);
  }
}
