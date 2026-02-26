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
  private fenHistory: string[] = [this.fen];

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

    const persistedHistory = Array.isArray(persisted.fenHistory) ? persisted.fenHistory : [];
    const normalizedHistory: string[] = [];
    for (const entry of persistedHistory) {
      if (typeof entry !== 'string') {
        continue;
      }
      const normalized = canonicalFen(entry);
      if (normalized) {
        normalizedHistory.push(normalized);
      }
    }

    if (normalizedHistory.length > 0) {
      this.fenHistory = normalizedHistory;
      this.fen = normalizedHistory[normalizedHistory.length - 1];
      return;
    }

    const parsedFen = canonicalFen(persisted.fen);
    if (parsedFen) {
      this.fen = parsedFen;
      this.fenHistory = [parsedFen];
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
    this.fenHistory.push(this.fen);
    if (this.fenHistory.length > 512) {
      this.fenHistory = this.fenHistory.slice(-512);
    }
    await this.persist();
    return { ok: true, fen: this.fen };
  }

  async reset(role: 'player' | 'spectator'): Promise<{ ok: true; fen: string } | { ok: false; code: 'spectator-cannot-reset' }> {
    const result = canResetGame(role);
    if ('code' in result) {
      return result;
    }

    this.fen = newGameFen();
    this.fenHistory = [this.fen];
    await this.persist();
    return { ok: true, fen: this.fen };
  }

  canUndo(): boolean {
    return this.fenHistory.length > 1;
  }

  async undo(): Promise<{ ok: true; fen: string } | { ok: false; code: 'cannot-undo' }> {
    if (this.fenHistory.length <= 1) {
      return { ok: false, code: 'cannot-undo' };
    }
    this.fenHistory.pop();
    this.fen = this.fenHistory[this.fenHistory.length - 1];
    await this.persist();
    return { ok: true, fen: this.fen };
  }

  private async persist(): Promise<void> {
    await this.state.storage.put(
      ROOM_STORAGE_KEY,
      { fen: this.fen, fenHistory: this.fenHistory } satisfies StoredRoomState,
    );
  }
}
