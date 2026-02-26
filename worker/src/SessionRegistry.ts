import type { PlayerColor, RoomUser } from './types';

export interface Session {
  id: string;
  name: string;
  role: 'player' | 'spectator';
  color: PlayerColor | null;
}

export class SessionRegistry {
  private readonly sessions = new Map<WebSocket, Session>();

  add(ws: WebSocket, session: Session): void {
    this.sessions.set(ws, session);
  }

  get(ws: WebSocket): Session | null {
    return this.sessions.get(ws) ?? null;
  }

  remove(ws: WebSocket): Session | null {
    const existing = this.sessions.get(ws);
    if (!existing) {
      return null;
    }
    this.sessions.delete(ws);
    return existing;
  }

  hydrateFromWebSockets(webSockets: WebSocket[]): void {
    this.sessions.clear();
    for (const ws of webSockets) {
      const session = ws.deserializeAttachment() as Session | null;
      if (session) {
        this.sessions.set(ws, session);
      }
    }
  }

  entries(): IterableIterator<[WebSocket, Session]> {
    return this.sessions.entries();
  }

  values(): IterableIterator<Session> {
    return this.sessions.values();
  }

  users(): RoomUser[] {
    return Array.from(this.sessions.values(), (session) => ({
      id: session.id,
      name: session.name,
      role: session.role,
      color: session.color,
    }));
  }

  getAvailableSeat(): PlayerColor | null {
    const occupied = new Set<PlayerColor>();
    for (const session of this.sessions.values()) {
      if (session.role === 'player' && session.color) {
        occupied.add(session.color);
      }
    }

    if (!occupied.has('w')) {
      return 'w';
    }
    if (!occupied.has('b')) {
      return 'b';
    }
    return null;
  }

  assignSeatIfAvailable(session: Session): void {
    if (session.role === 'player') {
      return;
    }
    const availableSeat = this.getAvailableSeat();
    if (availableSeat) {
      session.role = 'player';
      session.color = availableSeat;
      return;
    }
    session.role = 'spectator';
    session.color = null;
  }

  findSocketBySessionId(sessionId: string): WebSocket | null {
    for (const [ws, session] of this.sessions) {
      if (session.id === sessionId) {
        return ws;
      }
    }
    return null;
  }

  promoteSpectatorToPlayer(color: PlayerColor): { ws: WebSocket; session: Session } | null {
    for (const [ws, session] of this.sessions) {
      if (session.role === 'spectator') {
        session.role = 'player';
        session.color = color;
        return { ws, session };
      }
    }
    return null;
  }

  findPlayerSocketBySessionId(sessionId: string): { ws: WebSocket; session: Session } | null {
    for (const [ws, session] of this.sessions) {
      if (session.id === sessionId && session.role === 'player' && session.color) {
        return { ws, session };
      }
    }
    return null;
  }

  findOpponentPlayer(sessionId: string): { ws: WebSocket; session: Session } | null {
    for (const [ws, session] of this.sessions) {
      if (session.id !== sessionId && session.role === 'player' && session.color) {
        return { ws, session };
      }
    }
    return null;
  }

  swapPlayerColors(): boolean {
    let whitePlayer: Session | null = null;
    let blackPlayer: Session | null = null;

    for (const session of this.sessions.values()) {
      if (session.role !== 'player' || !session.color) {
        continue;
      }
      if (session.color === 'w') {
        whitePlayer = session;
      } else if (session.color === 'b') {
        blackPlayer = session;
      }
    }

    if (!whitePlayer || !blackPlayer) {
      return false;
    }

    whitePlayer.color = 'b';
    blackPlayer.color = 'w';
    return true;
  }
}
