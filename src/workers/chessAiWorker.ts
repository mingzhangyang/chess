import type { AiComputeRequest, AiInitSharedTTMessage, AiTelemetryMessage } from './aiWorkerRuntime';
import { handleAiComputeRequest, handleInitSharedTT } from './aiWorkerRuntime';

const handleWorkerMessage = async (data: AiComputeRequest | AiInitSharedTTMessage): Promise<void> => {
  const runtimeDeps = {
    emitTelemetry: (event: AiTelemetryMessage) => {
      self.postMessage(event);
    },
  };

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
};

self.addEventListener('message', (event: MessageEvent<AiComputeRequest | AiInitSharedTTMessage>) => {
  const { data } = event;
  void handleWorkerMessage(data);
});
