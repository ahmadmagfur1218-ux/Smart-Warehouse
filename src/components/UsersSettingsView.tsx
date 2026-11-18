import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { Boxes, Check, Shield, Sliders } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import { computeStatusColor } from '../lib/capacityEngine.ts';
import { applyWarehouseLayoutToFirestore } from '../lib/layoutGenerator.ts';
import type {
  GateDoc,
  RackDoc,
  RackUnitType,
  SettingDoc,
  UserProfileDoc,
  UserRole,
  WarehouseDoc,
  ZoneDoc,
} from '../shared/types.ts';

interface UsersProps {
  role: UserRole;
  currentUid: string;
  users: UserProfileDoc[];
  onNotify: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
}

export const UsersView: React.FC<UsersProps> = ({ role, currentUid, users, onNotify }) => {
  const isAdmin = role === 'ADMIN';

  const handleRoleChange = async (targetUid: string, nextRole: UserRole) => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, 'users', targetUid), {
        role: nextRole,
        updatedAt: serverTimestamp(),
      });
      onNotify(`Role pengguna diperbarui menjadi ${nextRole}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    }
  };

  const handleStatusChange = async (targetUid: string, nextStatus: 'ACTIVE' | 'SUSPENDED') => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, 'users', targetUid), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      onNotify(`Status akun diperbarui menjadi ${nextStatus}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start gap-3">
        <Shield className="w-5 h-5 text-slate-700 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-600 leading-relaxed">
          <div className="font-semibold text-slate-900 mb-1">Kontrol Akses Berbasis Role (RBAC)</div>
          <span>
            <strong>ADMIN</strong> mengelola user, master data, dan threshold settings.{' '}
            <strong>OPERATOR</strong> memproses scan gate, pergerakan manual, dan master SKU/tag.{' '}
            <strong>VIEWER</strong> hanya dapat memantau dashboard, log, dan laporan.
          </span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
              <th className="py-3 px-4">Nama Tampilan</th>
              <th className="py-3 px-4">UID</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.uid}>
                <td className="py-2.5 px-4 font-medium text-slate-900">
                  {u.displayName} {u.uid === currentUid && <span className="text-slate-400">(Anda)</span>}
                </td>
                <td className="py-2.5 px-4 font-mono text-slate-500">{u.uid}</td>
                <td className="py-2.5 px-4">
                  <select
                    value={u.role}
                    disabled={!isAdmin}
                    onChange={(e) => void handleRoleChange(u.uid, e.target.value as UserRole)}
                    className="px-2.5 py-1 text-xs border border-slate-300 rounded-md bg-white disabled:bg-slate-100"
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="OPERATOR">OPERATOR</option>
                    <option value="VIEWER">VIEWER</option>
                  </select>
                </td>
                <td className="py-2.5 px-4">
                  <select
                    value={u.status}
                    disabled={!isAdmin || u.uid === currentUid}
                    onChange={(e) =>
                      void handleStatusChange(u.uid, e.target.value as 'ACTIVE' | 'SUSPENDED')
                    }
                    className="px-2.5 py-1 text-xs border border-slate-300 rounded-md bg-white disabled:bg-slate-100"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface SettingsProps {
  role: UserRole;
  currentUid: string;
  warehouse: WarehouseDoc | null;
  zones: ZoneDoc[];
  gates: GateDoc[];
  settings: SettingDoc | null;
  racks: RackDoc[];
  onNotify: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
  onLayoutApplied?: () => void;
  onResetFactoryPreset?: () => Promise<void>;
}

const LAYOUT_PRESETS: Array<{
  id: string;
  label: string;
  sub: string;
  areaCount: number;
  racksPerArea: number;
  aislesPerArea: number;
  defaultRackCapacity: number;
  defaultRackUnit: RackUnitType;
}> = [
  {
    id: 'small',
    label: 'Gudang Kecil',
    sub: '3 Area · 12 Rak',
    areaCount: 3,
    racksPerArea: 4,
    aislesPerArea: 2,
    defaultRackCapacity: 20,
    defaultRackUnit: 'PALLET_SLOT',
  },
  {
    id: 'medium',
    label: 'Gudang Menengah',
    sub: '4 Area · 48 Rak',
    areaCount: 4,
    racksPerArea: 12,
    aislesPerArea: 3,
    defaultRackCapacity: 50,
    defaultRackUnit: 'PALLET_SLOT',
  },
  {
    id: 'enterprise',
    label: 'Gudang Besar',
    sub: '5 Area · 100 Rak',
    areaCount: 5,
    racksPerArea: 20,
    aislesPerArea: 4,
    defaultRackCapacity: 1000,
    defaultRackUnit: 'UNIT',
  },
];

function unitLabelText(unit: RackUnitType): string {
  if (unit === 'PALLET_SLOT') return 'Pallet Slot';
  if (unit === 'M3') return 'm³';
  return 'kg';
}

export const SettingsView: React.FC<SettingsProps> = ({
  role,
  currentUid,
  warehouse,
  zones,
  gates,
  settings,
  racks,
  onNotify,
  onLayoutApplied,
  onResetFactoryPreset,
}) => {
  const isAdmin = role === 'ADMIN';

  // Threshold & IoT Params state
  const [greenMax, setGreenMax] = useState(settings?.greenMaxPct ?? 69);
  const [yellowMax, setYellowMax] = useState(settings?.yellowMaxPct ?? 90);
  const [hbTimeout, setHbTimeout] = useState(settings?.heartbeatTimeoutSec ?? 60);
  const [debounceSec, setDebounceSec] = useState(settings?.defaultDebounceSec ?? 5);
  const [allowOver, setAllowOver] = useState(settings?.allowOverCapacity ?? false);
  const [saving, setSaving] = useState(false);

  // Warehouse Layout & Capacity Configurator state
  const inferredAreaCount = Math.min(12, Math.max(1, settings?.defaultAreaCount ?? (zones.length || 5)));
  const inferredRacksPerArea = Math.min(
    40,
    Math.max(
      1,
      settings?.defaultRacksPerArea ??
        (zones.length > 0 ? Math.max(1, Math.round(racks.length / zones.length)) : 20)
    )
  );
  const [areaCount, setAreaCount] = useState<number>(inferredAreaCount);
  const [racksPerArea, setRacksPerArea] = useState<number>(inferredRacksPerArea);
  const [aislesPerArea, setAislesPerArea] = useState<number>(settings?.defaultAislesPerArea ?? 4);
  const [defaultRackCapacity, setDefaultRackCapacity] = useState<number>(
    settings?.defaultRackCapacity ?? 1000
  );
  const [defaultRackUnit, setDefaultRackUnit] = useState<RackUnitType>(
    settings?.defaultRackUnit ?? 'UNIT'
  );
  const [populateSampleFill, setPopulateSampleFill] = useState<boolean>(true);
  const [areaNames, setAreaNames] = useState<string[]>([]);
  const [confirmingLayout, setConfirmingLayout] = useState(false);
  const [applyingLayout, setApplyingLayout] = useState(false);
  const [resettingFactory, setResettingFactory] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setGreenMax(settings.greenMaxPct);
    setYellowMax(settings.yellowMaxPct);
    setHbTimeout(settings.heartbeatTimeoutSec);
    setDebounceSec(settings.defaultDebounceSec);
    setAllowOver(settings.allowOverCapacity);
    if (settings.defaultAreaCount) setAreaCount(settings.defaultAreaCount);
    if (settings.defaultRacksPerArea) setRacksPerArea(settings.defaultRacksPerArea);
    if (settings.defaultAislesPerArea) setAislesPerArea(settings.defaultAislesPerArea);
    if (settings.defaultRackCapacity) setDefaultRackCapacity(settings.defaultRackCapacity);
    if (settings.defaultRackUnit) setDefaultRackUnit(settings.defaultRackUnit);
  }, [settings]);

  useEffect(() => {
    setAreaNames((prev) => {
      const next: string[] = [];
      for (let i = 0; i < areaCount; i++) {
        const letter = String.fromCharCode(65 + i);
        next.push(prev[i] || zones[i]?.name || `Area ${letter}`);
      }
      return next;
    });
  }, [areaCount, zones]);

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings || !isAdmin) return;
    if (greenMax >= yellowMax) {
      onNotify('Batas Hijau harus lebih kecil dari batas Kuning.', 'error');
      return;
    }

    setSaving(true);
    try {
      const updates: Array<{ id: string; color: RackDoc['statusColor'] }> = [];
      for (const r of racks) {
        const nextColor = computeStatusColor(
          r.usedCapacity,
          r.maxCapacity,
          Number(greenMax),
          Number(yellowMax)
        );
        if (nextColor !== r.statusColor) {
          updates.push({ id: r.id, color: nextColor });
        }
      }

      const settingsBatch = writeBatch(db);
      settingsBatch.update(doc(db, 'settings', settings.id), {
        greenMaxPct: Number(greenMax),
        yellowMaxPct: Number(yellowMax),
        heartbeatTimeoutSec: Number(hbTimeout),
        defaultDebounceSec: Number(debounceSec),
        allowOverCapacity: Boolean(allowOver),
        updatedAt: serverTimestamp(),
      });
      await settingsBatch.commit();

      for (let i = 0; i < updates.length; i += 15) {
        const chunk = updates.slice(i, i + 15);
        const batch = writeBatch(db);
        for (const u of chunk) {
          batch.update(doc(db, 'racks', u.id), {
            statusColor: u.color,
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }

      onNotify('Pengaturan threshold & warna seluruh rak diperbarui.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `settings/${settings.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleApplyLayout = async () => {
    if (!isAdmin || !warehouse) return;
    const safeAreas = Math.min(12, Math.max(1, Number(areaCount) || 1));
    const safeRacks = Math.min(40, Math.max(1, Number(racksPerArea) || 1));
    const safeAisles = Math.min(6, Math.max(1, Number(aislesPerArea) || 1));
    const safeCap = Math.max(1, Number(defaultRackCapacity) || 1);

    setApplyingLayout(true);
    try {
      await applyWarehouseLayoutToFirestore({
        config: {
          areaCount: safeAreas,
          racksPerArea: safeRacks,
          aislesPerArea: safeAisles,
          defaultRackCapacity: safeCap,
          defaultRackUnit,
          populateSampleFill,
          areaNames,
        },
        currentUid,
        warehouse,
        existingZones: zones,
        existingRacks: racks,
        existingGates: gates,
        settings,
      });
      setConfirmingLayout(false);
      onNotify(
        `Layout gudang diperbarui: ${safeAreas} Area, ${safeAreas * safeRacks} Rak aktif.`
      );
      if (onLayoutApplied) onLayoutApplied();
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Gagal memperbarui layout gudang.',
        'error'
      );
    } finally {
      setApplyingLayout(false);
    }
  };

  const totalRacksPreview = Math.max(1, areaCount) * Math.max(1, racksPerArea);
  const totalCapacityPreview = totalRacksPreview * Math.max(1, defaultRackCapacity);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
      {/* Left: Warehouse Capacity & Custom Layout Configurator */}
      <section className="xl:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#1D63ED] flex items-center justify-center shrink-0">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Pengaturan Kapasitas & Layout Gudang
              </h2>
              <p className="text-xs text-slate-500">
                Sesuaikan jumlah area, jumlah rak per area, lorong, dan kapasitas sesuai kebutuhan pelanggan.
              </p>
            </div>
          </div>
        </div>

        {/* Preset Selector */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700">Preset Cepat Ukuran Gudang</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {LAYOUT_PRESETS.map((p) => {
              const selected =
                areaCount === p.areaCount &&
                racksPerArea === p.racksPerArea &&
                defaultRackUnit === p.defaultRackUnit;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => {
                    setAreaCount(p.areaCount);
                    setRacksPerArea(p.racksPerArea);
                    setAislesPerArea(p.aislesPerArea);
                    setDefaultRackCapacity(p.defaultRackCapacity);
                    setDefaultRackUnit(p.defaultRackUnit);
                  }}
                  className={`text-left p-3 rounded-xl border transition-colors cursor-pointer disabled:opacity-60 ${
                    selected
                      ? 'border-[#1D63ED] bg-blue-50/70'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">{p.label}</span>
                    {selected && <Check className="w-3.5 h-3.5 text-[#1D63ED]" />}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">{p.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Numeric Configuration */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Jumlah Area (1–12)
            </label>
            <input
              type="number"
              min={1}
              max={12}
              value={areaCount}
              onChange={(e) => setAreaCount(Math.min(12, Math.max(1, Number(e.target.value))))}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Jumlah Rak per Area (1–40)
            </label>
            <input
              type="number"
              min={1}
              max={40}
              value={racksPerArea}
              onChange={(e) => setRacksPerArea(Math.min(40, Math.max(1, Number(e.target.value))))}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Kolom Lorong / Area (1–6)
            </label>
            <input
              type="number"
              min={1}
              max={6}
              value={aislesPerArea}
              onChange={(e) => setAislesPerArea(Math.min(6, Math.max(1, Number(e.target.value))))}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Kapasitas Maks per Rak
            </label>
            <input
              type="number"
              min={1}
              max={100000}
              value={defaultRackCapacity}
              onChange={(e) => setDefaultRackCapacity(Math.max(1, Number(e.target.value)))}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Satuan Kapasitas Rak
            </label>
            <select
              value={defaultRackUnit}
              onChange={(e) => setDefaultRackUnit(e.target.value as RackUnitType)}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="UNIT">Kilogram / Unit (kg)</option>
              <option value="PALLET_SLOT">Pallet Slot (Slot Pallet)</option>
              <option value="M3">Volume (m³)</option>
            </select>
          </div>
        </div>

        {/* Custom Area Names */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700">Penamaan Area di Peta Gudang</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {areaNames.map((nameVal, idx) => (
              <input
                key={idx}
                type="text"
                maxLength={32}
                value={nameVal}
                disabled={!isAdmin}
                onChange={(e) => {
                  const next = [...areaNames];
                  next[idx] = e.target.value;
                  setAreaNames(next);
                }}
                placeholder={`Area ${String.fromCharCode(65 + idx)}`}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={populateSampleFill}
            onChange={(e) => setPopulateSampleFill(e.target.checked)}
            disabled={!isAdmin}
            className="rounded border-slate-300"
          />
          Isi contoh okupansi awal secara proporsional (Hijau / Kuning / Merah) untuk pratinjau kapasitas
        </label>

        {/* Live Layout Preview Bar */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-slate-500">Jumlah Area</div>
            <div className="font-display text-base font-bold text-slate-900 tabular-nums">
              {areaCount} Area
            </div>
          </div>
          <div>
            <div className="text-slate-500">Total Rak Gudang</div>
            <div className="font-display text-base font-bold text-[#1D63ED] tabular-nums">
              {totalRacksPreview} Rak
            </div>
          </div>
          <div>
            <div className="text-slate-500">Kapasitas Total</div>
            <div className="font-display text-base font-bold text-slate-900 tabular-nums">
              {totalCapacityPreview.toLocaleString('id-ID')} {unitLabelText(defaultRackUnit)}
            </div>
          </div>
        </div>

        {isAdmin ? (
          !confirmingLayout ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmingLayout(true)}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-[#1D63ED] rounded-xl hover:bg-blue-700 cursor-pointer"
              >
                Terapkan Layout & Kapasitas Gudang
              </button>
              {onResetFactoryPreset && (
                <button
                  type="button"
                  disabled={resettingFactory}
                  onClick={async () => {
                    setResettingFactory(true);
                    try {
                      await onResetFactoryPreset();
                    } finally {
                      setResettingFactory(false);
                    }
                  }}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl disabled:opacity-50 cursor-pointer"
                >
                  {resettingFactory
                    ? 'Memulihkan Preset Pabrik...'
                    : 'Reset ke Preset Pabrik (5 Area · 100 Rak · 160 SKU)'}
                </button>
              )}
            </div>
          ) : (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <span className="text-amber-900 font-medium">
                Membuat ulang {areaCount} Area & {totalRacksPreview} Rak akan mengganti daftar area/rak saat ini. Lanjutkan?
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={applyingLayout}
                  onClick={() => void handleApplyLayout()}
                  className="px-3.5 py-1.5 font-semibold text-white bg-[#1D63ED] rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {applyingLayout ? 'Memproses...' : 'Ya, Terapkan'}
                </button>
                <button
                  type="button"
                  disabled={applyingLayout}
                  onClick={() => setConfirmingLayout(false)}
                  className="px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
              </div>
            </div>
          )
        ) : (
          <p className="text-xs text-slate-500">Hanya Admin yang dapat mengubah kapasitas & layout gudang.</p>
        )}
      </section>

      {/* Right: Threshold & Parameter IoT */}
      <form
        onSubmit={handleSaveThresholds}
        className="xl:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-5"
      >
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Sliders className="w-4 h-4 text-slate-700" />
          <h2 className="font-display text-base font-bold text-slate-900">
            Threshold Kapasitas & Parameter IoT
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Batas Maks Hijau (%)
            </label>
            <input
              type="number"
              min={10}
              max={90}
              value={greenMax}
              onChange={(e) => setGreenMax(Number(e.target.value))}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Batas Maks Kuning (%)
            </label>
            <input
              type="number"
              min={11}
              max={99}
              value={yellowMax}
              onChange={(e) => setYellowMax(Number(e.target.value))}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Di atas {yellowMax}% otomatis berstatus Merah.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Timeout Heartbeat (detik)
            </label>
            <input
              type="number"
              min={10}
              max={600}
              value={hbTimeout}
              onChange={(e) => setHbTimeout(Number(e.target.value))}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Default Debounce Gate (detik)
            </label>
            <input
              type="number"
              min={0}
              max={120}
              value={debounceSec}
              onChange={(e) => setDebounceSec(Number(e.target.value))}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={allowOver}
            onChange={(e) => setAllowOver(e.target.checked)}
            disabled={!isAdmin}
            className="rounded border-slate-300"
          />
          Izinkan barang masuk (IN) melebihi kapasitas maksimum rak
        </label>

        {isAdmin ? (
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Menyimpan...' : 'Simpan Threshold & IoT'}
          </button>
        ) : (
          <p className="text-xs text-slate-500">Hanya Admin yang dapat mengubah pengaturan ini.</p>
        )}
      </form>
    </div>
  );
};

