import crypto from 'node:crypto';
import { z } from 'zod';
import { adapterRegistry } from '../adapters/index.ts';
import type { EventIngestResult, NormalizedGateEvent, ServerAuditEntry } from '../../shared/types.ts';

const standardEventSchema = z.object({
  event_id: z.string().min(1).max(128),
  device_id: z.string().min(1).max(64),
  gate_id: z.string().min(1).max(64),
  source: z.enum(['RFID', 'BARCODE', 'PROXIMITY', 'MANUAL']),
  direction: z.enum(['IN', 'OUT']),
  tag_or_code: z.string().min(1).max(128),
  quantity: z.number().positive().max(100000),
  rack_id: z.string().min(1).max(128).nullable(),
  timestamp: z.string().min(1).max(64),
});

export class EventProcessor {
  private processedEventIds = new Map<string, number>();
  private processedHashes = new Map<string, number>();
  private debounceMap = new Map<string, number>();
  private gateDebounceSec = new Map<string, number>();
  private auditLogs: ServerAuditEntry[] = [];
  private deviceApiKeys = new Map<string, string>();

  constructor() {
    // Load default + env device API keys
    const rawKeys =
      process.env.DEVICE_API_KEYS ||
      'wh-rfid-a-key-01:RFID-GATE-A-01,wh-barcode-b-key-02:BARCODE-GATE-B-01,wh-prox-c-key-03:PROX-GATE-C-01,wh-rfid-c-key-04:RFID-GATE-C-02';
    for (const pair of rawKeys.split(',')) {
      const [key, deviceId] = pair.split(':').map((s) => s.trim());
      if (key && deviceId) {
        this.deviceApiKeys.set(key, deviceId);
      }
    }
  }

  setGateDebounce(gateId: string, seconds: number) {
    if (gateId && Number.isFinite(seconds) && seconds >= 0) {
      this.gateDebounceSec.set(gateId, seconds);
    }
  }

  registerDeviceApiKey(apiKey: string, deviceCode: string) {
    this.deviceApiKeys.set(apiKey, deviceCode);
  }

  verifyDeviceApiKey(apiKey: string | undefined): { valid: boolean; deviceCode?: string } {
    if (!apiKey) return { valid: false };
    const matched = this.deviceApiKeys.get(apiKey);
    if (matched) return { valid: true, deviceCode: matched };
    // Allow keys prefixed with wh-dev- dynamically provisioned in UI
    if (apiKey.startsWith('wh-dev-') && apiKey.length >= 12) {
      return { valid: true };
    }
    return { valid: false };
  }

  getAuditLogs(limit = 50): ServerAuditEntry[] {
    return this.auditLogs.slice(0, limit);
  }

  private pushAudit(entry: Omit<ServerAuditEntry, 'id' | 'timestamp'>) {
    this.auditLogs.unshift({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    });
    if (this.auditLogs.length > 200) {
      this.auditLogs.length = 200;
    }
  }

  private cleanupCaches() {
    const now = Date.now();
    const maxAgeMs = 1000 * 60 * 60; // 1 hour window
    for (const [k, ts] of this.processedEventIds) {
      if (now - ts > maxAgeMs) this.processedEventIds.delete(k);
    }
    for (const [k, ts] of this.processedHashes) {
      if (now - ts > maxAgeMs) this.processedHashes.delete(k);
    }
    for (const [k, ts] of this.debounceMap) {
      if (now - ts > 1000 * 60 * 5) this.debounceMap.delete(k);
    }
  }

  ingestRaw(rawPayload: Record<string, unknown>, gateDebounceOverrideSec?: number): EventIngestResult {
    this.cleanupCaches();

    const adapted = adapterRegistry.resolveAndNormalize(rawPayload);
    if (!adapted.ready) {
      if (adapted.pendingInfo) {
        this.pushAudit({
          eventId: String(rawPayload.event_id || 'seq-pending'),
          deviceId: String(rawPayload.device_id || 'PROXIMITY'),
          gateId: adapted.pendingInfo.gateId,
          source: 'PROXIMITY',
          status: 'PENDING_SEQUENCE',
          detail: `Sensor ${adapted.pendingInfo.firstSensor} triggered; awaiting Sensor ${adapted.pendingInfo.waitingFor}`,
        });
        return {
          status: 'PENDING_SEQUENCE',
          sequenceState: adapted.pendingInfo,
        };
      }
      this.pushAudit({
        eventId: String(rawPayload.event_id || 'invalid'),
        deviceId: String(rawPayload.device_id || 'unknown'),
        gateId: String(rawPayload.gate_id || 'unknown'),
        source: 'SYSTEM',
        status: 'REJECTED',
        detail: adapted.error || 'Adapter normalization failed',
      });
      return { status: 'REJECTED', reason: adapted.error };
    }

    const parsed = standardEventSchema.safeParse(adapted.event);
    if (!parsed.success) {
      const reason = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return { status: 'REJECTED', reason };
    }

    const event = parsed.data;

    // 1. Idempotency check by event_id
    if (this.processedEventIds.has(event.event_id)) {
      this.pushAudit({
        eventId: event.event_id,
        deviceId: event.device_id,
        gateId: event.gate_id,
        source: event.source,
        status: 'DUPLICATE',
        detail: `Duplicate event_id ${event.event_id} skipped`,
      });
      return { status: 'DUPLICATE', reason: 'Duplicate event_id' };
    }

    // 2. Payload content hash idempotency (same gate + tag + direction + timestamp)
    const hashInput = `${event.gate_id}|${event.direction}|${event.tag_or_code}|${event.quantity}|${event.timestamp}`;
    const payloadHash = crypto.createHash('sha256').update(hashInput).digest('hex');

    if (this.processedHashes.has(payloadHash)) {
      this.pushAudit({
        eventId: event.event_id,
        deviceId: event.device_id,
        gateId: event.gate_id,
        source: event.source,
        status: 'DUPLICATE',
        detail: `Duplicate payload hash for ${event.tag_or_code} skipped`,
      });
      return { status: 'DUPLICATE', reason: 'Duplicate payload hash' };
    }

    // 3. Configurable per-gate debounce window (default 5s)
    // Manual entries bypass tag debounce if user intentionally submits consecutive batches, unless same event_id
    const debounceSec =
      gateDebounceOverrideSec ?? this.gateDebounceSec.get(event.gate_id) ?? 5;
    if (event.source !== 'MANUAL' && debounceSec > 0) {
      const debounceKey = `${event.gate_id}:${event.direction}:${event.tag_or_code}`;
      const lastSeen = this.debounceMap.get(debounceKey);
      const now = Date.now();
      if (lastSeen && now - lastSeen < debounceSec * 1000) {
        this.pushAudit({
          eventId: event.event_id,
          deviceId: event.device_id,
          gateId: event.gate_id,
          source: event.source,
          status: 'DEBOUNCED',
          detail: `Filtered repeated ${event.tag_or_code} at ${event.gate_id} within ${debounceSec}s window`,
        });
        return {
          status: 'DEBOUNCED',
          reason: `Tag ${event.tag_or_code} filtered within ${debounceSec}s gate debounce window`,
        };
      }
      this.debounceMap.set(debounceKey, now);
    }

    const nowMs = Date.now();
    this.processedEventIds.set(event.event_id, nowMs);
    this.processedHashes.set(payloadHash, nowMs);

    const normalized: NormalizedGateEvent = {
      ...event,
      payload_hash: payloadHash,
      raw_payload: JSON.stringify(rawPayload).slice(0, 1800),
    };

    this.pushAudit({
      eventId: normalized.event_id,
      deviceId: normalized.device_id,
      gateId: normalized.gate_id,
      source: normalized.source,
      status: 'ACCEPTED',
      detail: `${normalized.direction} ${normalized.tag_or_code} x${normalized.quantity}`,
    });

    return { status: 'ACCEPTED', event: normalized };
  }
}

export const eventProcessor = new EventProcessor();
