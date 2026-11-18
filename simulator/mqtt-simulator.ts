/**
 * Smart Warehouse Inventory — Hardware Event Simulator (MQTT & HTTP Webhook)
 *
 * Usage:
 *   MQTT Mode: npx tsx simulator/mqtt-simulator.ts
 *   HTTP Mode: npx tsx simulator/mqtt-simulator.ts --http http://localhost:3000
 */
import mqtt from 'mqtt';
import { v4 as uuidv4 } from 'uuid';

const args = process.argv.slice(2);
const httpIndex = args.indexOf('--http');
const httpBaseUrl = httpIndex !== -1 ? args[httpIndex + 1] || 'http://localhost:3000' : null;
const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

const SAMPLES = [
  { gate_id: 'GATE-A', device_id: 'RFID-GATE-A-01', source: 'RFID', direction: 'IN', tag_or_code: 'E2801160600002054C2A1B10', apiKey: 'wh-rfid-a-key-01' },
  { gate_id: 'GATE-A', device_id: 'RFID-GATE-A-01', source: 'RFID', direction: 'IN', tag_or_code: 'E2801160600002054C2A1B12', apiKey: 'wh-rfid-a-key-01' },
  { gate_id: 'GATE-B', device_id: 'BARCODE-GATE-B-01', source: 'BARCODE', direction: 'OUT', tag_or_code: '899100200105', apiKey: 'wh-barcode-b-key-02' },
  { gate_id: 'GATE-C', device_id: 'RFID-GATE-C-02', source: 'RFID', direction: 'IN', tag_or_code: 'E2801160600002054C2A1B22', apiKey: 'wh-rfid-c-key-04' },
  { gate_id: 'GATE-C', device_id: 'PROX-GATE-C-01', source: 'PROXIMITY', direction: 'IN', tag_or_code: 'SKU-CLD-013', apiKey: 'wh-prox-c-key-03' },
];

async function sendHttpEvent(sample: typeof SAMPLES[number], qty: number) {
  const payload = {
    event_id: uuidv4(),
    device_id: sample.device_id,
    gate_id: sample.gate_id,
    source: sample.source,
    direction: sample.direction,
    tag_or_code: sample.tag_or_code,
    quantity: qty,
    rack_id: null,
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(`${httpBaseUrl}/api/v1/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': sample.apiKey,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  console.log(`[HTTP ${res.status}] ${sample.gate_id} ${sample.direction} ${sample.tag_or_code} x${qty} ->`, body.status || body.error);
}

async function sendHttpHeartbeat(deviceId: string) {
  await fetch(`${httpBaseUrl}/api/v1/devices/${deviceId}/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firmwareVersion: 'sim-1.0', rssi: -52 }),
  });
}

if (httpBaseUrl) {
  console.log(`Starting HTTP Event Simulator -> ${httpBaseUrl}`);
  setInterval(async () => {
    const sample = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
    const qty = Math.floor(Math.random() * 3) + 1;
    try {
      await sendHttpEvent(sample, qty);
    } catch (err) {
      console.error('HTTP event failed:', err);
    }
  }, 4000);

  setInterval(async () => {
    for (const s of SAMPLES) {
      await sendHttpHeartbeat(s.device_id).catch(() => undefined);
    }
  }, 15000);
} else {
  console.log(`Starting MQTT Event Simulator -> ${brokerUrl}`);
  const client = mqtt.connect(brokerUrl, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
  });

  client.on('connect', () => {
    console.log('Simulator connected to MQTT broker');
    setInterval(() => {
      const sample = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
      const qty = Math.floor(Math.random() * 3) + 1;
      const topic = `warehouse/WH-JKT-01/gate/${sample.gate_id}/event`;
      const payload = {
        event_id: uuidv4(),
        device_id: sample.device_id,
        gate_id: sample.gate_id,
        source: sample.source,
        direction: sample.direction,
        tag_or_code: sample.tag_or_code,
        quantity: qty,
        rack_id: null,
        timestamp: new Date().toISOString(),
      };
      client.publish(topic, JSON.stringify(payload), { qos: 1 });
      console.log(`[MQTT] Published to ${topic}:`, payload.direction, payload.tag_or_code, `x${qty}`);
    }, 4500);

    setInterval(() => {
      const uniqueDevices = [...new Set(SAMPLES.map((s) => s.device_id))];
      for (const dev of uniqueDevices) {
        const hbTopic = `warehouse/WH-JKT-01/device/${dev}/heartbeat`;
        client.publish(hbTopic, JSON.stringify({ device_id: dev, uptime_ms: process.uptime() * 1000, timestamp: new Date().toISOString() }));
      }
      console.log(`[MQTT] Heartbeat sent for ${uniqueDevices.length} devices`);
    }, 15000);
  });

  client.on('error', (err) => {
    console.error('MQTT error:', err.message);
  });
}
