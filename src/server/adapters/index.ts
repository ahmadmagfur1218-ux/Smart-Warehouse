import { v4 as uuidv4 } from 'uuid';
import type { Direction, EventSource, StandardGateEvent } from '../../shared/types.ts';
import type { AdapterNormalizeResult, InputAdapter } from './types.ts';

function normalizeTimestamp(ts: unknown): string {
  if (typeof ts === 'string' && ts.trim().length > 0 && !Number.isNaN(Date.parse(ts))) {
    return new Date(ts).toISOString();
  }
  return new Date().toISOString();
}

function normalizeQuantity(qty: unknown): number {
  const n = Number(qty);
  if (Number.isFinite(n) && n > 0) return n;
  return 1;
}

/**
 * Adapter A: UHF/HF RFID Reader (MQTT / HTTP webhook)
 * Accepts standard event fields or vendor EPC payload aliases (`epc`, `tagId`, `antenna`).
 */
export class RfidAdapter implements InputAdapter {
  readonly source: EventSource = 'RFID';
  readonly name = 'UHF/HF RFID Adapter';

  canHandle(raw: Record<string, unknown>): boolean {
    return raw.source === 'RFID' || typeof raw.epc === 'string';
  }

  normalize(raw: Record<string, unknown>): AdapterNormalizeResult {
    const tagOrCode = String(raw.tag_or_code ?? raw.epc ?? raw.tagId ?? '').trim().toUpperCase();
    const gateId = String(raw.gate_id ?? raw.gateId ?? '').trim();
    const deviceId = String(raw.device_id ?? raw.deviceId ?? 'RFID-UNKNOWN').trim();
    const direction = String(raw.direction ?? 'IN').toUpperCase() as Direction;

    if (!tagOrCode || !gateId) {
      return { ready: false, error: 'RFID payload requires gate_id and tag_or_code/epc' };
    }
    if (direction !== 'IN' && direction !== 'OUT') {
      return { ready: false, error: 'Invalid direction; expected IN or OUT' };
    }

    const event: StandardGateEvent = {
      event_id: String(raw.event_id || uuidv4()),
      device_id: deviceId,
      gate_id: gateId,
      source: 'RFID',
      direction,
      tag_or_code: tagOrCode,
      quantity: normalizeQuantity(raw.quantity),
      rack_id: raw.rack_id ? String(raw.rack_id) : null,
      timestamp: normalizeTimestamp(raw.timestamp),
    };

    return { ready: true, event };
  }
}

/**
 * Adapter B: Barcode / QR Scanner (Keyboard-Wedge, USB Serial, or Gateway HTTP/MQTT)
 */
export class BarcodeAdapter implements InputAdapter {
  readonly source: EventSource = 'BARCODE';
  readonly name = 'Barcode/QR Scanner Adapter';

  canHandle(raw: Record<string, unknown>): boolean {
    return raw.source === 'BARCODE' || typeof raw.barcode === 'string';
  }

  normalize(raw: Record<string, unknown>): AdapterNormalizeResult {
    const tagOrCode = String(raw.tag_or_code ?? raw.barcode ?? raw.code ?? '').trim();
    const gateId = String(raw.gate_id ?? raw.gateId ?? '').trim();
    const deviceId = String(raw.device_id ?? raw.deviceId ?? 'BARCODE-WEDGE').trim();
    const direction = String(raw.direction ?? 'OUT').toUpperCase() as Direction;

    if (!tagOrCode || !gateId) {
      return { ready: false, error: 'Barcode payload requires gate_id and tag_or_code/barcode' };
    }
    if (direction !== 'IN' && direction !== 'OUT') {
      return { ready: false, error: 'Invalid direction; expected IN or OUT' };
    }

    const event: StandardGateEvent = {
      event_id: String(raw.event_id || uuidv4()),
      device_id: deviceId,
      gate_id: gateId,
      source: 'BARCODE',
      direction,
      tag_or_code: tagOrCode,
      quantity: normalizeQuantity(raw.quantity),
      rack_id: raw.rack_id ? String(raw.rack_id) : null,
      timestamp: normalizeTimestamp(raw.timestamp),
    };

    return { ready: true, event };
  }
}

interface ProximityGateSequence {
  firstSensor: 'A' | 'B';
  triggeredAtMs: number;
  tagOrCode?: string;
  deviceId?: string;
}

/**
 * Adapter C: Dual-Sensor Proximity / IR / Ultrasonic Detector (ESP32 / Arduino)
 * Sequence detection:
 *   - Sensor A triggered then Sensor B within 3.5s -> direction = IN
 *   - Sensor B triggered then Sensor A within 3.5s -> direction = OUT
 * Also supports pre-resolved proximity events that already specify `direction`.
 */
export class ProximityAdapter implements InputAdapter {
  readonly source: EventSource = 'PROXIMITY';
  readonly name = 'Dual-Sensor Proximity Direction Adapter';
  private gateSequences = new Map<string, ProximityGateSequence>();
  private readonly sequenceTimeoutMs = 3500;

  canHandle(raw: Record<string, unknown>): boolean {
    return raw.source === 'PROXIMITY' || raw.sensor === 'A' || raw.sensor === 'B';
  }

  normalize(raw: Record<string, unknown>): AdapterNormalizeResult {
    const gateId = String(raw.gate_id ?? raw.gateId ?? '').trim();
    const deviceId = String(raw.device_id ?? raw.deviceId ?? 'PROX-GATE-01').trim();
    if (!gateId) {
      return { ready: false, error: 'Proximity payload requires gate_id' };
    }

    // Mode 1: Raw dual-sensor trigger (`sensor: "A" | "B"`)
    const sensor = raw.sensor ? String(raw.sensor).toUpperCase() : null;
    if (sensor === 'A' || sensor === 'B') {
      const now = Date.now();
      const existing = this.gateSequences.get(gateId);

      // Clear stale sequence
      if (existing && now - existing.triggeredAtMs > this.sequenceTimeoutMs) {
        this.gateSequences.delete(gateId);
      }

      const active = this.gateSequences.get(gateId);
      const fallbackCode = String(raw.tag_or_code ?? active?.tagOrCode ?? 'SKU-CLD-013').trim();

      if (!active) {
        this.gateSequences.set(gateId, {
          firstSensor: sensor,
          triggeredAtMs: now,
          tagOrCode: fallbackCode,
          deviceId,
        });
        return {
          ready: false,
          pendingInfo: {
            gateId,
            firstSensor: sensor,
            waitingFor: sensor === 'A' ? 'B' : 'A',
          },
        };
      }

      if (active.firstSensor === sensor) {
        // Refresh trigger window on same sensor bounce
        active.triggeredAtMs = now;
        return {
          ready: false,
          pendingInfo: {
            gateId,
            firstSensor: sensor,
            waitingFor: sensor === 'A' ? 'B' : 'A',
          },
        };
      }

      // Complementary sensor triggered -> determine direction
      const direction: Direction = active.firstSensor === 'A' && sensor === 'B' ? 'IN' : 'OUT';
      this.gateSequences.delete(gateId);

      return {
        ready: true,
        event: {
          event_id: String(raw.event_id || uuidv4()),
          device_id: deviceId,
          gate_id: gateId,
          source: 'PROXIMITY',
          direction,
          tag_or_code: fallbackCode,
          quantity: normalizeQuantity(raw.quantity),
          rack_id: raw.rack_id ? String(raw.rack_id) : null,
          timestamp: normalizeTimestamp(raw.timestamp),
        },
      };
    }

    // Mode 2: Pre-resolved ESP32 proximity event with explicit direction
    const direction = String(raw.direction ?? '').toUpperCase() as Direction;
    if (direction !== 'IN' && direction !== 'OUT') {
      return { ready: false, error: 'Proximity event must provide sensor ("A"|"B") or direction ("IN"|"OUT")' };
    }

    return {
      ready: true,
      event: {
        event_id: String(raw.event_id || uuidv4()),
        device_id: deviceId,
        gate_id: gateId,
        source: 'PROXIMITY',
        direction,
        tag_or_code: String(raw.tag_or_code ?? 'SKU-CLD-013').trim(),
        quantity: normalizeQuantity(raw.quantity),
        rack_id: raw.rack_id ? String(raw.rack_id) : null,
        timestamp: normalizeTimestamp(raw.timestamp),
      },
    };
  }
}

/**
 * Adapter D: Manual Dashboard Entry (Fallback)
 */
export class ManualAdapter implements InputAdapter {
  readonly source: EventSource = 'MANUAL';
  readonly name = 'Manual Console Adapter';

  canHandle(raw: Record<string, unknown>): boolean {
    return raw.source === 'MANUAL' || !raw.source;
  }

  normalize(raw: Record<string, unknown>): AdapterNormalizeResult {
    const tagOrCode = String(raw.tag_or_code ?? raw.sku ?? '').trim();
    const gateId = String(raw.gate_id ?? raw.gateId ?? '').trim();
    const direction = String(raw.direction ?? 'IN').toUpperCase() as Direction;

    if (!tagOrCode || !gateId) {
      return { ready: false, error: 'Manual entry requires gate_id and tag_or_code/sku' };
    }
    if (direction !== 'IN' && direction !== 'OUT') {
      return { ready: false, error: 'Invalid direction; expected IN or OUT' };
    }

    return {
      ready: true,
      event: {
        event_id: String(raw.event_id || uuidv4()),
        device_id: String(raw.device_id ?? 'MANUAL-CONSOLE').trim(),
        gate_id: gateId,
        source: 'MANUAL',
        direction,
        tag_or_code: tagOrCode,
        quantity: normalizeQuantity(raw.quantity),
        rack_id: raw.rack_id ? String(raw.rack_id) : null,
        timestamp: normalizeTimestamp(raw.timestamp),
      },
    };
  }
}

export class AdapterRegistry {
  private adapters: InputAdapter[];

  constructor() {
    this.adapters = [
      new RfidAdapter(),
      new BarcodeAdapter(),
      new ProximityAdapter(),
      new ManualAdapter(),
    ];
  }

  register(adapter: InputAdapter) {
    this.adapters.unshift(adapter);
  }

  resolveAndNormalize(rawPayload: Record<string, unknown>): AdapterNormalizeResult {
    const adapter = this.adapters.find((a) => a.canHandle(rawPayload));
    if (!adapter) {
      return { ready: false, error: 'No registered input adapter matched payload source' };
    }
    return adapter.normalize(rawPayload);
  }

  listAdapters() {
    return this.adapters.map((a) => ({ source: a.source, name: a.name }));
  }
}

export const adapterRegistry = new AdapterRegistry();
