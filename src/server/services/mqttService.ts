import mqtt, { type MqttClient } from 'mqtt';
import type { Server as SocketIOServer } from 'socket.io';
import { eventProcessor } from './eventProcessor.ts';

let mqttClient: MqttClient | null = null;
let mqttConnected = false;

export function getMqttStatus() {
  return {
    configured: Boolean(process.env.MQTT_BROKER_URL),
    connected: mqttConnected,
    brokerUrl: process.env.MQTT_BROKER_URL || null,
  };
}

export function initMqttSubscriber(io: SocketIOServer) {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) {
    console.log('[MQTT] MQTT_BROKER_URL not set; running in HTTP Webhook + Socket.IO + Simulator mode.');
    return;
  }

  mqttClient = mqtt.connect(brokerUrl, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 5000,
    connectTimeout: 5000,
  });

  mqttClient.on('connect', () => {
    mqttConnected = true;
    console.log(`[MQTT] Connected to broker ${brokerUrl}`);
    mqttClient?.subscribe(
      [
        'warehouse/+/gate/+/event',
        'warehouse/+/gate/+/proximity',
        'warehouse/+/device/+/heartbeat',
      ],
      { qos: 1 },
      (err) => {
        if (err) console.error('[MQTT] Subscribe error:', err.message);
      }
    );
  });

  mqttClient.on('close', () => {
    mqttConnected = false;
  });

  mqttClient.on('error', (err) => {
    mqttConnected = false;
    console.error('[MQTT] Broker error:', err.message);
  });

  mqttClient.on('message', (topic, messageBuffer) => {
    try {
      const payload = JSON.parse(messageBuffer.toString('utf8')) as Record<string, unknown>;
      const parts = topic.split('/');

      // Topic: warehouse/{warehouse_id}/device/{device_id}/heartbeat
      if (parts.length === 5 && parts[3] && parts[4] === 'heartbeat') {
        const deviceId = String(payload.device_id || parts[3]);
        io.emit('device:heartbeat', {
          deviceId,
          warehouseId: parts[1],
          timestamp: new Date().toISOString(),
          meta: payload,
        });
        return;
      }

      // Topic: warehouse/{warehouse_id}/gate/{gate_id}/event or /proximity
      if (parts.length === 5 && parts[2] === 'gate') {
        if (!payload.gate_id) payload.gate_id = parts[3];
        if (parts[4] === 'proximity' && !payload.source) {
          payload.source = 'PROXIMITY';
        }
        const result = eventProcessor.ingestRaw(payload);
        if (result.status === 'ACCEPTED' && result.event) {
          io.emit('warehouse:event', result.event);
        } else if (result.status === 'PENDING_SEQUENCE') {
          io.emit('proximity:sequence', result.sequenceState);
        } else {
          io.emit('event:filtered', {
            status: result.status,
            reason: result.reason,
            gateId: payload.gate_id,
          });
        }
      }
    } catch (error) {
      console.error('[MQTT] Failed to parse message on topic', topic, error);
    }
  });
}
