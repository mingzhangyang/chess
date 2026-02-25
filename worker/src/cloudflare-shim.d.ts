interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface DurableObjectId {}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): Fetcher;
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
  acceptWebSocket(webSocket: WebSocket): void;
  getWebSockets(): WebSocket[];
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

interface WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

interface ResponseInit {
  webSocket?: WebSocket | null;
}

declare var WebSocketPair: {
  new (): {
    0: WebSocket;
    1: WebSocket;
  };
};

type ExportedHandler<Env = unknown> = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}
