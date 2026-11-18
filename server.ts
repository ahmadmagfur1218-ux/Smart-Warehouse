import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { v4 as uuidv4 } from 'uuid';
import { eventProcessor } from './src/server/services/eventProcessor.ts';
import { adapterRegistry } from './src/server/adapters/index.ts';
import { getMqttStatus, initMqttSubscriber } from './src/server/services/mqttService.ts';

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const port = Number(process.env.PORT || 3000);

  const corsOrigin = process.env.CORS_ORIGIN || '*';
  const io = new SocketIOServer(server, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
    },
  });

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(
    cors({
      origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()),
    })
  );
  app.use(express.json({ limit: '256kb' }));

  const ingestLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded for event ingestion' },
  });

  // Initialize MQTT Subscriber if MQTT_BROKER_URL is configured
  initMqttSubscriber(io);

  io.on('connection', (socket) => {
    socket.emit('system:connected', {
      adapters: adapterRegistry.listAdapters(),
      mqtt: getMqttStatus(),
      serverTime: new Date().toISOString(),
    });

    // Dashboard clients can sync per-gate debounce windows to the backend filter
    socket.on('gate:debounce:sync', (items: Array<{ gateCode: string; debounceWindowSec: number }>) => {
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item?.gateCode) {
            eventProcessor.setGateDebounce(item.gateCode, Number(item.debounceWindowSec ?? 5));
          }
        }
      }
    });
  });

  // --- REST API Routes (/api/v1) ---
  app.get('/api/v1/health', (_req, res) => {
    res.json({
      status: 'ok',
      adapters: adapterRegistry.listAdapters(),
      mqtt: getMqttStatus(),
      uptimeSec: Math.round(process.uptime()),
    });
  });

  app.get('/api/v1/audit-logs', (_req, res) => {
    res.json({ logs: eventProcessor.getAuditLogs(80) });
  });

  /**
   * Primary IoT HTTP Webhook Endpoint (Section 6)
   * Authenticated via X-API-Key header (for hardware gateways) or dashboard origin session
   */
  app.post('/api/v1/events', ingestLimiter, (req, res) => {
    const apiKey = req.header('X-API-Key');
    const isDashboardClient = req.header('X-Warehouse-Client') === 'dashboard';

    if (!isDashboardClient) {
      const authCheck = eventProcessor.verifyDeviceApiKey(apiKey);
      if (!authCheck.valid) {
        return res.status(401).json({
          error: 'Unauthorized: Missing or invalid X-API-Key header for device ingestion',
        });
      }
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const debounceOverride =
      typeof body.debounce_window_sec === 'number' ? body.debounce_window_sec : undefined;

    const result = eventProcessor.ingestRaw(body, debounceOverride);

    if (result.status === 'ACCEPTED' && result.event) {
      io.emit('warehouse:event', result.event);
      // Also emit heartbeat for the reporting device
      if (result.event.device_id && result.event.source !== 'MANUAL') {
        io.emit('device:heartbeat', {
          deviceId: result.event.device_id,
          timestamp: new Date().toISOString(),
        });
      }
      return res.status(201).json(result);
    }

    if (result.status === 'PENDING_SEQUENCE') {
      io.emit('proximity:sequence', result.sequenceState);
      return res.status(202).json(result);
    }

    if (result.status === 'DEBOUNCED' || result.status === 'DUPLICATE') {
      io.emit('event:filtered', {
        status: result.status,
        reason: result.reason,
        gateId: body.gate_id,
      });
      return res.status(200).json(result);
    }

    return res.status(400).json(result);
  });

  app.post('/api/v1/devices/:deviceId/heartbeat', (req, res) => {
    const deviceId = req.params.deviceId;
    const timestamp = new Date().toISOString();
    io.emit('device:heartbeat', {
      deviceId,
      timestamp,
      meta: req.body || {},
    });
    res.json({ status: 'ok', deviceId, timestamp });
  });

  /**
   * Built-in Hardware Event Simulator Endpoint (runs through exact same adapter + debounce pipeline)
   */
  app.post('/api/v1/simulator/trigger', (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const payload: Record<string, unknown> = {
      event_id: body.event_id || uuidv4(),
      device_id: body.device_id || 'RFID-GATE-A-01',
      gate_id: body.gate_id || 'GATE-A',
      source: body.source || 'RFID',
      direction: body.direction,
      sensor: body.sensor,
      tag_or_code: body.tag_or_code || 'E2801160600002054C2A1B10',
      quantity: Number(body.quantity || 1),
      rack_id: body.rack_id || null,
      timestamp: new Date().toISOString(),
    };

    const result = eventProcessor.ingestRaw(payload);
    if (result.status === 'ACCEPTED' && result.event) {
      io.emit('warehouse:event', result.event);
      if (result.event.device_id !== 'MANUAL-CONSOLE') {
        io.emit('device:heartbeat', {
          deviceId: result.event.device_id,
          timestamp: new Date().toISOString(),
        });
      }
      return res.status(201).json(result);
    }

    if (result.status === 'PENDING_SEQUENCE') {
      io.emit('proximity:sequence', result.sequenceState);
      return res.status(202).json(result);
    }

    io.emit('event:filtered', {
      status: result.status,
      reason: result.reason,
      gateId: payload.gate_id,
    });
    return res.status(200).json(result);
  });

  // Serve Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`Smart Warehouse Inventory server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
