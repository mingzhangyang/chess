interface TelemetryEvent {
  scope: string;
  name: string;
  level: 'info' | 'warn' | 'error';
  data?: Record<string, unknown>;
  timestamp: string;
}

type TelemetrySink = (event: TelemetryEvent) => void;

declare global {
  interface Window {
    __CHESS_TELEMETRY__?: TelemetrySink;
  }
}

function emit(event: TelemetryEvent): void {
  const sink = window.__CHESS_TELEMETRY__;
  if (typeof sink === 'function') {
    sink(event);
    return;
  }

  const label = `[${event.scope}] ${event.name}`;
  if (event.level === 'error') {
    console.error(label, event.data ?? {});
    return;
  }
  if (event.level === 'warn') {
    console.warn(label, event.data ?? {});
    return;
  }
  console.info(label, event.data ?? {});
}

export function createTelemetry(scope: string) {
  return {
    info(name: string, data?: Record<string, unknown>) {
      emit({ scope, name, data, level: 'info', timestamp: new Date().toISOString() });
    },
    warn(name: string, data?: Record<string, unknown>) {
      emit({ scope, name, data, level: 'warn', timestamp: new Date().toISOString() });
    },
    error(name: string, data?: Record<string, unknown>) {
      emit({ scope, name, data, level: 'error', timestamp: new Date().toISOString() });
    },
  };
}
