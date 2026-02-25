import type { AiComputeRequest } from './aiWorkerRuntime';
import { handleAiComputeRequest } from './aiWorkerRuntime';

self.addEventListener('message', (event: MessageEvent<AiComputeRequest>) => {
  const response = handleAiComputeRequest(event.data);
  if (response) {
    self.postMessage(response);
  }
});
