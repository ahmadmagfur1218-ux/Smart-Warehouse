import type { EventSource, StandardGateEvent } from '../../shared/types.ts';

export interface AdapterNormalizeResult {
  ready: boolean;
  event?: StandardGateEvent;
  pendingInfo?: {
    gateId: string;
    firstSensor: 'A' | 'B';
    waitingFor: 'A' | 'B';
  };
  error?: string;
}

export interface InputAdapter {
  readonly source: EventSource;
  readonly name: string;
  canHandle(rawPayload: Record<string, unknown>): boolean;
  normalize(rawPayload: Record<string, unknown>): AdapterNormalizeResult;
}
