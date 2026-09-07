import type { AiComputeRequest, AiInitSharedTTMessage, AiTelemetryMessage } from './aiWorkerRuntime';
import {
  handleAiComputeRequest,
  handleInitSharedTT,
  isAiComputeRequest,
  isAiInitSharedTTMessage,
} from './aiWorkerRuntime';

const isWorkerMessage = (data: unknown): data is AiComputeRequest | AiInitSharedTTMessage => {
  if (typeof data !== 'object' || data === null) return false;
  return isAiComputeRequest(data) || isAiInitSharedTTMessage(data);
};

const getRequestEnvelope = (data: unknown): { requestId: number; fen: string } | undefined => {
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as Record<string, unknown>;
  if (record.type !== 'compute-best-move' || !Number.isSafeInteger(record.requestId)) return undefined;
  return {
    requestId: record.requestId as number,
    fen: typeof record.fen === 'string' ? record.fen.slice(0, 128) : '',
  };
};

const handleWorkerMessage = async (data: unknown): Promise<void> => {
  const runtimeDeps = {
    emitTelemetry: (event: AiTelemetryMessage) => {
      self.postMessage(event);
    },
  };

  try {
    if (!isWorkerMessage(data)) {
      const request = getRequestEnvelope(data);
      self.postMessage({
        type: 'ai-telemetry',
        scope: 'ai-worker',
        level: 'error',
        name: 'invalid-worker-message',
        timestamp: new Date().toISOString(),
        requestId: request?.requestId,
        data: { error: 'invalid-worker-message' },
      });
      if (request) {
        self.postMessage({
          type: 'best-move-result',
          requestId: request.requestId,
          fen: request.fen,
          bestMove: null,
          error: 'invalid AI worker request',
        });
      }
      return;
    }
    if (data.type === 'init-shared-tt') {
      await handleInitSharedTT(data, runtimeDeps);
      return;
    }
    if (data.type === 'compute-best-move') {
      const response = await handleAiComputeRequest(data, runtimeDeps);
      if (response) {
        self.postMessage(response);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const request = getRequestEnvelope(data);
    self.postMessage({
      type: 'ai-telemetry',
      scope: 'ai-worker',
      level: 'error',
      name: 'worker-message-failed',
      timestamp: new Date().toISOString(),
      requestId: request?.requestId,
      data: { error: message },
    });

    if (request) {
      self.postMessage({
        type: 'best-move-result',
        requestId: request.requestId,
        fen: request.fen,
        bestMove: null,
        error: message,
      });
    }
  }
};

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const { data } = event;
  void handleWorkerMessage(data);
});
