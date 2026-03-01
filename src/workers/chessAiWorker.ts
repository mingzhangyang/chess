import type { AiComputeRequest, AiInitSharedTTMessage } from './aiWorkerRuntime';
import { handleAiComputeRequest, handleInitSharedTT } from './aiWorkerRuntime';

self.addEventListener('message', (event: MessageEvent<AiComputeRequest | AiInitSharedTTMessage>) => {
  const { data } = event;
  if (data.type === 'init-shared-tt') {
    handleInitSharedTT(data);
    return;
  }
  if (data.type === 'compute-best-move') {
    const response = handleAiComputeRequest(data);
    if (response) {
      self.postMessage(response);
    }
  }
});
