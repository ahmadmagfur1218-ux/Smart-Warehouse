import React, { useEffect, useRef, useState } from 'react';
import { Barcode, Cpu, Keyboard, Radio, Send } from 'lucide-react';
import type { GateDoc, ItemDoc, ItemTagDoc, RackDoc, UserRole } from '../shared/types.ts';

interface Props {
  role: UserRole;
  gates: GateDoc[];
  racks: RackDoc[];
  items: ItemDoc[];
  itemTags: ItemTagDoc[];
  onSubmitEvent: (payload: Record<string, unknown>) => Promise<void>;
}

export const GateTerminalView: React.FC<Props> = ({
  role,
  gates,
  racks,
  items,
  itemTags,
  onSubmitEvent,
}) => {
  const canOperate = role === 'ADMIN' || role === 'OPERATOR';

  // Keyboard-Wedge Barcode Scanner State
  const wedgeInputRef = useRef<HTMLInputElement>(null);
  const [wedgeGateId, setWedgeGateId] = useState<string>(gates[1]?.code || gates[0]?.code || 'GATE-B');
  const [wedgeDirection, setWedgeDirection] = useState<'IN' | 'OUT'>('OUT');
  const [wedgeCode, setWedgeCode] = useState('');
  const [wedgeQty, setWedgeQty] = useState(1);
  const [wedgeAutoFocus, setWedgeAutoFocus] = useState(true);
  const [lastScannedLog, setLastScannedLog] = useState<string | null>(null);

  // Manual Fallback Form State
  const [manualGate, setManualGate] = useState<string>(gates[0]?.code || 'GATE-A');
  const [manualDir, setManualDir] = useState<'IN' | 'OUT'>('IN');
  const [manualSku, setManualSku] = useState<string>(items[0]?.sku || '');
  const [manualQty, setManualQty] = useState(1);
  const [manualRackId, setManualRackId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // Proximity Dual-Sensor Tester State
  const [proxGate, setProxGate] = useState<string>(gates[2]?.code || gates[0]?.code || 'GATE-C');
  const [proxSku, setProxSku] = useState<string>(items[12]?.sku || items[0]?.sku || 'SKU-CLD-013');
  const [proxStepLog, setProxStepLog] = useState<string>('Siap menerima urutan Sensor A / Sensor B.');

  useEffect(() => {
    if (wedgeAutoFocus) {
      wedgeInputRef.current?.focus();
    }
  }, [wedgeAutoFocus]);

  const handleWedgeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wedgeCode.trim() || !canOperate) return;
    setBusy(true);
    try {
      const code = wedgeCode.trim();
      await onSubmitEvent({
        source: 'BARCODE',
        gate_id: wedgeGateId,
        device_id: `BARCODE-WEDGE-${wedgeGateId}`,
        direction: wedgeDirection,
        tag_or_code: code,
        quantity: Number(wedgeQty) || 1,
        rack_id: null,
      });
      const matchedTag = itemTags.find((t) => t.tagOrCode.toUpperCase() === code.toUpperCase());
      setLastScannedLog(
        `Scan terkirim: ${code} (${matchedTag ? matchedTag.sku : 'Direct SKU/Tag'}) · ${wedgeDirection} x${wedgeQty} @ ${wedgeGateId}`
      );
      setWedgeCode('');
      if (wedgeAutoFocus) wedgeInputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSku || !canOperate) return;
    setBusy(true);
    try {
      await onSubmitEvent({
        source: 'MANUAL',
        gate_id: manualGate,
        device_id: 'MANUAL-CONSOLE',
        direction: manualDir,
        tag_or_code: manualSku,
        quantity: Number(manualQty) || 1,
        rack_id: manualRackId || null,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleProximitySensor = async (sensor: 'A' | 'B') => {
    if (!canOperate) return;
    setBusy(true);
    try {
      await onSubmitEvent({
        source: 'PROXIMITY',
        gate_id: proxGate,
        device_id: 'PROX-GATE-C-01',
        sensor,
        tag_or_code: proxSku,
        quantity: 1,
      });
      setProxStepLog(
        `Sensor ${sensor} dipicu pada ${new Date().toLocaleTimeString('id-ID')}. Picu sensor pasangan dalam 3,5 detik untuk menentukan arah IN/OUT.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {!canOperate && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
          Akun Anda memiliki role <strong>VIEWER</strong> (hanya baca). Hubungi Admin untuk akses Operator agar dapat mencatat pergerakan barang.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Keyboard-Wedge Barcode Scanner */}
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                <Barcode className="w-4 h-4 text-slate-700" />
                Barcode / QR Keyboard-Wedge Terminal
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Arahkan scanner USB/Bluetooth ke kolom ini; scanner otomatis mengirim Enter setelah terbaca.
              </p>
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={wedgeAutoFocus}
                onChange={(e) => setWedgeAutoFocus(e.target.checked)}
                className="rounded border-slate-300"
              />
              Auto-focus
            </label>
          </div>

          <form onSubmit={handleWedgeSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Gate</label>
                <select
                  value={wedgeGateId}
                  onChange={(e) => setWedgeGateId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {gates.map((g) => (
                    <option key={g.id} value={g.code}>
                      {g.code} ({g.gateType})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Arah</label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['IN', 'OUT'] as const).map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => setWedgeDirection(dir)}
                      className={`py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                        wedgeDirection === dir
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {dir}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Scan Barcode / QR / EPC
                </label>
                <div className="relative">
                  <Keyboard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    ref={wedgeInputRef}
                    type="text"
                    value={wedgeCode}
                    onChange={(e) => setWedgeCode(e.target.value)}
                    placeholder="Contoh: 899100200105"
                    disabled={!canOperate}
                    className="w-full pl-9 pr-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Qty</label>
                <input
                  type="number"
                  min={1}
                  value={wedgeQty}
                  onChange={(e) => setWedgeQty(Number(e.target.value))}
                  disabled={!canOperate}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] text-slate-500">
                Sample barcode: <span className="font-mono">899100200100</span> s/d{' '}
                <span className="font-mono">899100200119</span>
              </div>
              <button
                type="submit"
                disabled={!canOperate || busy || !wedgeCode.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Proses Scan
              </button>
            </div>
          </form>

          {lastScannedLog && (
            <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700">
              {lastScannedLog}
            </div>
          )}
        </section>

        {/* Manual Fallback Entry */}
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="font-display text-base font-semibold text-slate-900 mb-1">
            Input Manual Pergerakan (Fallback)
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Gunakan saat reader IoT sedang offline atau untuk penyesuaian stok fisik di gate.
          </p>

          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Gate</label>
                <select
                  value={manualGate}
                  onChange={(e) => setManualGate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {gates.map((g) => (
                    <option key={g.id} value={g.code}>
                      {g.code} — {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Arah</label>
                <select
                  value={manualDir}
                  onChange={(e) => setManualDir(e.target.value as 'IN' | 'OUT')}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="IN">IN (Barang Masuk)</option>
                  <option value="OUT">OUT (Barang Keluar)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Item / SKU</label>
              <select
                value={manualSku}
                onChange={(e) => setManualSku(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {items.map((it) => (
                  <option key={it.id} value={it.sku}>
                    {it.sku} — {it.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Kuantitas</label>
                <input
                  type="number"
                  min={1}
                  value={manualQty}
                  onChange={(e) => setManualQty(Number(e.target.value))}
                  disabled={!canOperate}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Rak Tujuan (Opsional)
                </label>
                <select
                  value={manualRackId}
                  onChange={(e) => setManualRackId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">Otomatis (Aturan Penempatan)</option>
                  {racks.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} ({r.usedCapacity}/{r.maxCapacity} {r.unitType})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!canOperate || busy || !manualSku}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Catat Pergerakan Manual
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Dual-Sensor Proximity Simulator */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-slate-700" />
              Penguji Sensor Proximity Ganda (ESP32 A / B Direction Detector)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Picu Sensor A lalu Sensor B dalam 3,5 detik untuk menghasilkan event <strong>IN</strong>, atau Sensor B lalu A untuk <strong>OUT</strong>.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-600 flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-emerald-600" />
            <span>{proxStepLog}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Gate Bidirectional</label>
            <select
              value={proxGate}
              onChange={(e) => setProxGate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {gates.map((g) => (
                <option key={g.id} value={g.code}>
                  {g.code} ({g.gateType})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">SKU Default Jalur</label>
            <select
              value={proxSku}
              onChange={(e) => setProxSku(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {items.map((it) => (
                <option key={it.id} value={it.sku}>
                  {it.sku} — {it.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void handleProximitySensor('A')}
            disabled={!canOperate || busy}
            className="px-4 py-2.5 text-xs font-semibold bg-slate-100 border border-slate-300 text-slate-900 rounded-lg hover:bg-slate-200 disabled:opacity-50 cursor-pointer"
          >
            Picu Sensor A (Luar)
          </button>
          <button
            type="button"
            onClick={() => void handleProximitySensor('B')}
            disabled={!canOperate || busy}
            className="px-4 py-2.5 text-xs font-semibold bg-slate-100 border border-slate-300 text-slate-900 rounded-lg hover:bg-slate-200 disabled:opacity-50 cursor-pointer"
          >
            Picu Sensor B (Dalam)
          </button>
        </div>
      </section>
    </div>
  );
};
