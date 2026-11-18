import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Activity, Plus, Power, RefreshCw } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type {
  DeviceDoc,
  GateDoc,
  ServerAuditEntry,
  SettingDoc,
  UserRole,
  WarehouseDoc,
} from '../shared/types.ts';

interface Props {
  role: UserRole;
  currentUid: string;
  warehouse: WarehouseDoc | null;
  gates: GateDoc[];
  devices: DeviceDoc[];
  settings: SettingDoc | null;
  onPingDevice: (deviceCode: string) => Promise<void>;
  onNotify: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
}

export const DevicesView: React.FC<Props> = ({
  role,
  currentUid,
  warehouse,
  gates,
  devices,
  settings,
  onPingDevice,
  onNotify,
}) => {
  const [auditLogs, setAuditLogs] = useState<ServerAuditEntry[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [devCode, setDevCode] = useState('');
  const [devName, setDevName] = useState('');
  const [devGateId, setDevGateId] = useState(gates[0]?.id || '');
  const [devSource, setDevSource] = useState<'RFID' | 'BARCODE' | 'PROXIMITY'>('RFID');

  const timeoutSec = settings?.heartbeatTimeoutSec ?? 60;
  const canOperate = role === 'ADMIN' || role === 'OPERATOR';

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const loadAudit = async () => {
    try {
      const res = await fetch('/api/v1/audit-logs');
      if (res.ok) {
        const data = (await res.json()) as { logs: ServerAuditEntry[] };
        setAuditLogs(data.logs || []);
      }
    } catch {
      // Ignore network polling errors silently
    }
  };

  useEffect(() => {
    void loadAudit();
    const timer = setInterval(() => void loadAudit(), 6000);
    return () => clearInterval(timer);
  }, []);

  const handleRegisterDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    const gId = devGateId || gates[0]?.id;
    if (!canOperate || !devCode.trim() || !devName.trim() || !gId) return;
    const whId = warehouse?.id || 'wh-jkt-01';
    const gateObj = gates.find((g) => g.id === gId);
    const id = `dev-${devCode.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-${Date.now().toString(36).slice(-3)}`;
    const randomKey = `wh-dev-${Math.random().toString(36).slice(2, 10)}`;

    try {
      await setDoc(doc(db, 'devices', id), {
        id,
        warehouseId: whId,
        gateId: gId,
        deviceCode: devCode.trim().toUpperCase(),
        name: devName.trim(),
        sourceType: devSource,
        apiKeyPreview: `${randomKey.slice(0, 8)}...`,
        mqttTopic: `warehouse/${warehouse?.code || 'WH-JKT-01'}/gate/${gateObj?.code || 'GATE-A'}/event`,
        status: 'ONLINE',
        lastHeartbeatIso: new Date().toISOString(),
        firmwareVersion: 'v1.0.0',
        ownerUid: warehouse?.ownerUid || currentUid,
        memberUids: warehouse?.memberUids || [currentUid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onNotify(`Perangkat ${devCode.toUpperCase()} terdaftar. API Key: ${randomKey}`);
      setDevCode('');
      setDevName('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `devices/${id}`);
    }
  };

  const handleToggleDeviceStatus = async (device: DeviceDoc) => {
    if (!canOperate) return;
    const nextStatus = device.status === 'OFFLINE' ? 'ONLINE' : 'OFFLINE';
    try {
      await updateDoc(doc(db, 'devices', device.id), {
        status: nextStatus,
        ...(nextStatus === 'ONLINE' ? { lastHeartbeatIso: new Date().toISOString() } : {}),
        updatedAt: serverTimestamp(),
      });
      onNotify(`Perangkat ${device.deviceCode} diubah ke status ${nextStatus}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `devices/${device.id}`);
    }
  };

  return (
    <div className="space-y-6">
      {canOperate && (
        <form
          onSubmit={handleRegisterDevice}
          className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Device ID</label>
            <input
              value={devCode}
              onChange={(e) => setDevCode(e.target.value)}
              placeholder="RFID-GATE-D-01"
              required
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nama Perangkat</label>
            <input
              value={devName}
              onChange={(e) => setDevName(e.target.value)}
              placeholder="UHF Reader Gate D"
              required
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Gate Terpasang</label>
            <select
              value={devGateId || gates[0]?.id || ''}
              onChange={(e) => setDevGateId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {gates.map((g) => (
                <option key={g.id} value={g.id}>{g.code}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tipe Sumber</label>
            <select
              value={devSource}
              onChange={(e) => setDevSource(e.target.value as 'RFID' | 'BARCODE' | 'PROXIMITY')}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="RFID">RFID</option>
              <option value="BARCODE">BARCODE</option>
              <option value="PROXIMITY">PROXIMITY</option>
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Daftarkan Device
          </button>
        </form>
      )}

      {/* Device Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Status Perangkat IoT (Batas Offline: &gt;{timeoutSec} detik tanpa heartbeat)
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-3 px-4">Device Code</th>
                <th className="py-3 px-4">Nama & Firmware</th>
                <th className="py-3 px-4">Gate</th>
                <th className="py-3 px-4">MQTT Topic / Key</th>
                <th className="py-3 px-4">Heartbeat Terakhir</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Uji</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {devices.map((d) => {
                const ageSec = Math.max(
                  0,
                  Math.round((nowMs - new Date(d.lastHeartbeatIso).getTime()) / 1000)
                );
                const isOnline = d.status !== 'OFFLINE';
                const gate = gates.find((g) => g.id === d.gateId);
                return (
                  <tr key={d.id}>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                      {d.deviceCode}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="text-slate-800 font-medium">{d.name}</div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {d.sourceType} · {d.firmwareVersion || 'v1.0'}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700">{gate?.code || d.gateId}</td>
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-[11px] text-slate-600 truncate max-w-[240px]">
                        {d.mqttTopic}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        Key: {d.apiKeyPreview || 'configured'}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 tabular-nums">
                      {ageSec}s lalu
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`font-semibold ${
                          isOnline ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {isOnline ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      {canOperate && (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => void onPingDevice(d.deviceCode)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md cursor-pointer"
                          >
                            <Activity className="w-3 h-3" /> Heartbeat
                          </button>
                          <button
                            onClick={() => void handleToggleDeviceStatus(d)}
                            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer ${
                              isOnline
                                ? 'bg-rose-50 hover:bg-rose-100 text-rose-700'
                                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                            }`}
                            title={isOnline ? 'Simulasikan Offline' : 'Aktifkan Online'}
                          >
                            <Power className="w-3 h-3" /> {isOnline ? 'Off' : 'On'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ingestion Audit Log (Debounce / Idempotency Verification) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Log Audit Ingestion & Filter Debounce Server
          </h3>
          <button
            onClick={() => void loadAudit()}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Muat Ulang
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 text-xs">
          {auditLogs.length === 0 ? (
            <div className="p-6 text-center text-slate-500">
              Belum ada aktivitas ingestion pada sesi server ini.
            </div>
          ) : (
            auditLogs.map((log) => (
              <div key={log.id} className="px-5 py-2.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`font-mono font-semibold shrink-0 ${
                      log.status === 'ACCEPTED'
                        ? 'text-emerald-700'
                        : log.status === 'DEBOUNCED' || log.status === 'DUPLICATE'
                        ? 'text-amber-700'
                        : log.status === 'REJECTED'
                        ? 'text-rose-700'
                        : 'text-sky-700'
                    }`}
                  >
                    {log.status}
                  </span>
                  <span className="font-mono text-slate-500 shrink-0">{log.gateId}</span>
                  <span className="text-slate-700 truncate">{log.detail}</span>
                </div>
                <span className="font-mono text-[11px] text-slate-400 shrink-0 tabular-nums">
                  {new Date(log.timestamp).toLocaleTimeString('id-ID')}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
