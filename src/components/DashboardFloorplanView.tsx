import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  List,
  MapPin,
  Play,
  Radio,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Warehouse,
  WifiOff,
  X,
} from 'lucide-react';
import { computeRackPct, computeStatusColor, getCapacityTone } from '../lib/capacityEngine.ts';
import { WarehouseFloorplanCanvas } from './WarehouseFloorplanCanvas.tsx';
import type {
  AlertDoc,
  DeviceDoc,
  GateDoc,
  ItemDoc,
  ItemTagDoc,
  MovementDoc,
  RackDoc,
  RackStockDoc,
  SettingDoc,
  UserRole,
  ZoneDoc,
} from '../shared/types.ts';

interface Props {
  role: UserRole;
  wsConnected: boolean;
  zones: ZoneDoc[];
  gates: GateDoc[];
  racks: RackDoc[];
  items: ItemDoc[];
  itemTags: ItemTagDoc[];
  devices: DeviceDoc[];
  rackStocks: RackStockDoc[];
  movements: MovementDoc[];
  alerts: AlertDoc[];
  settings: SettingDoc | null;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onTriggerSimulatedEvent: (payload: Record<string, unknown>) => Promise<void>;
  onNavigateToLogs: () => void;
  onOpenLayoutSettings: () => void;
}

const RACK_PHOTO_PATH = '/src/assets/images/warehouse_rack_photo_1794976251136.jpg';

type EffectiveStatus = 'GREEN' | 'YELLOW' | 'RED' | 'OFFLINE';

const STATUS_META: Record<
  EffectiveStatus,
  {
    label: string;
    cellClass: string;
    badgeClass: string;
    barClass: string;
    ringStroke: string;
    dotClass: string;
  }
> = {
  GREEN: {
    label: 'Normal',
    cellClass: 'bg-emerald-500 hover:bg-emerald-600 border-emerald-700/40 text-white',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200/70',
    barClass: 'bg-emerald-500',
    ringStroke: '#10b981',
    dotClass: 'bg-emerald-500',
  },
  YELLOW: {
    label: 'Hampir Penuh',
    cellClass: 'bg-amber-400 hover:bg-amber-500 border-amber-600/50 text-amber-950',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200/80',
    barClass: 'bg-amber-400',
    ringStroke: '#f59e0b',
    dotClass: 'bg-amber-400',
  },
  RED: {
    label: 'Perlu Perhatian',
    cellClass: 'bg-rose-500 hover:bg-rose-600 border-rose-700/50 text-white',
    badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200/80',
    barClass: 'bg-rose-500',
    ringStroke: '#ef4444',
    dotClass: 'bg-rose-500',
  },
  OFFLINE: {
    label: 'Offline',
    cellClass: 'bg-slate-400 hover:bg-slate-500 border-slate-500/60 text-white',
    badgeClass: 'bg-slate-100 text-slate-600 border border-slate-200',
    barClass: 'bg-slate-400',
    ringStroke: '#94a3b8',
    dotClass: 'bg-slate-400',
  },
};

function formatUnitShort(unitType: RackDoc['unitType']): string {
  if (unitType === 'PALLET_SLOT') return 'Pallet';
  if (unitType === 'M3') return 'm³';
  return 'kg';
}

export const DashboardFloorplanView: React.FC<Props> = ({
  role,
  wsConnected,
  zones,
  gates,
  racks,
  items,
  itemTags,
  devices,
  rackStocks,
  movements,
  alerts,
  settings,
  onAcknowledgeAlert,
  onTriggerSimulatedEvent,
  onNavigateToLogs,
  onOpenLayoutSettings,
}) => {
  const [subTab, setSubTab] = useState<'map' | 'list' | 'stats'>('map');
  const [selectedRackId, setSelectedRackId] = useState<string>('');
  const [popoverRackId, setPopoverRackId] = useState<string>('');
  const [areaFilter, setAreaFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [simBusy, setSimBusy] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [nowClock, setNowClock] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNowClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const greenMax = settings?.greenMaxPct ?? 69;
  const yellowMax = settings?.yellowMaxPct ?? 90;
  const canOperate = role === 'ADMIN' || role === 'OPERATOR';

  // Determine offline racks from IoT device status per zone:
  // - If all devices in a zone are offline -> all racks in that zone are offline
  // - If some (but not all) devices in a zone are offline -> 3 racks per offline device in that zone
  const offlineRackIds = useMemo(() => {
    const result = new Set<string>();

    for (const z of zones) {
      const zGates = gates.filter((g) => g.zoneId === z.id);
      if (zGates.length === 0) continue;
      const zDevices = devices.filter((d) => zGates.some((g) => g.id === d.gateId));
      if (zDevices.length === 0) continue;

      const offlineDevs = zDevices.filter((d) => d.status === 'OFFLINE');
      if (offlineDevs.length === 0) continue;

      const zRacks = [...racks]
        .filter((r) => r.zoneId === z.id)
        .sort((a, b) => a.code.localeCompare(b.code));

      if (offlineDevs.length >= zDevices.length) {
        for (const r of zRacks) result.add(r.id);
      } else {
        const count = Math.min(zRacks.length, offlineDevs.length * 3);
        const affected = zRacks.slice(-count);
        for (const r of affected) result.add(r.id);
      }
    }
    return result;
  }, [zones, gates, devices, racks]);

  const getRackEffectiveStatus = (rack: RackDoc): EffectiveStatus => {
    if (offlineRackIds.has(rack.id)) return 'OFFLINE';
    return computeStatusColor(rack.usedCapacity, rack.maxCapacity, greenMax, yellowMax);
  };

  const sortedZones = useMemo(
    () => [...zones].sort((a, b) => a.code.localeCompare(b.code)),
    [zones]
  );

  const sortedRacks = useMemo(
    () =>
      [...racks].sort(
        (a, b) =>
          a.zoneId.localeCompare(b.zoneId) ||
          a.colIndex - b.colIndex ||
          a.rowIndex - b.rowIndex ||
          a.code.localeCompare(b.code)
      ),
    [racks]
  );

  // Stock counts & SKU map per rack
  const stocksByRackId = useMemo(() => {
    const map = new Map<string, RackStockDoc[]>();
    for (const rs of rackStocks) {
      if (rs.quantity <= 0) continue;
      const list = map.get(rs.rackId) || [];
      list.push(rs);
      map.set(rs.rackId, list);
    }
    return map;
  }, [rackStocks]);

  // Filter logic shared across Peta Gudang, Daftar Rak, and Filter & Pencarian
  const matchingRackIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const set = new Set<string>();
    for (const r of sortedRacks) {
      if (areaFilter !== 'ALL' && r.zoneId !== areaFilter) continue;
      const effStatus: EffectiveStatus = offlineRackIds.has(r.id)
        ? 'OFFLINE'
        : computeStatusColor(r.usedCapacity, r.maxCapacity, greenMax, yellowMax);
      if (statusFilter !== 'ALL' && effStatus !== statusFilter) continue;
      if (q) {
        const stocks = stocksByRackId.get(r.id) || [];
        const matchRack =
          r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
        const matchSku = stocks.some(
          (s) => s.sku.toLowerCase().includes(q) || s.itemName.toLowerCase().includes(q)
        );
        if (!matchRack && !matchSku) continue;
      }
      set.add(r.id);
    }
    return set;
  }, [sortedRacks, areaFilter, statusFilter, searchQuery, offlineRackIds, stocksByRackId, greenMax, yellowMax]);

  const hasActiveFilter =
    areaFilter !== 'ALL' || statusFilter !== 'ALL' || searchQuery.trim().length > 0;

  const activeRack = useMemo(() => {
    if (selectedRackId) {
      const found = racks.find((r) => r.id === selectedRackId);
      if (found) return found;
    }
    const b12 = sortedRacks.find((r) => r.code === 'B-12' && matchingRackIds.has(r.id));
    if (b12) return b12;
    const filteredFirst = sortedRacks.find((r) => matchingRackIds.has(r.id));
    return filteredFirst || sortedRacks[0] || null;
  }, [racks, sortedRacks, selectedRackId, matchingRackIds]);

  const summary = useMemo(() => {
    const total = racks.length;
    let green = 0;
    let yellow = 0;
    let red = 0;
    let offline = 0;
    for (const r of racks) {
      const st: EffectiveStatus = offlineRackIds.has(r.id)
        ? 'OFFLINE'
        : computeStatusColor(r.usedCapacity, r.maxCapacity, greenMax, yellowMax);
      if (st === 'OFFLINE') offline++;
      else if (st === 'GREEN') green++;
      else if (st === 'YELLOW') yellow++;
      else if (st === 'RED') red++;
    }
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

    const todayStr = new Date().toISOString().slice(0, 10);
    let inToday = 0;
    let outToday = 0;
    for (const m of movements) {
      if (m.placementStatus === 'OVER_CAPACITY_REJECTED') continue;
      if (m.eventTimestamp.slice(0, 10) === todayStr) {
        if (m.direction === 'IN') inToday += m.quantity;
        else outToday += m.quantity;
      }
    }

    const onlineDevices = devices.filter((d) => d.status !== 'OFFLINE').length;

    return {
      total,
      green,
      yellow,
      red,
      offline,
      greenPct: pct(green),
      yellowPct: pct(yellow),
      redPct: pct(red),
      offlinePct: pct(offline),
      inToday,
      outToday,
      onlineDevices,
      totalDevices: devices.length,
    };
  }, [racks, movements, devices, offlineRackIds, greenMax, yellowMax]);

  const activeRackZone = useMemo(
    () => zones.find((z) => z.id === activeRack?.zoneId) || null,
    [zones, activeRack]
  );

  const activeRackStocks = useMemo(() => {
    if (!activeRack) return [];
    return stocksByRackId.get(activeRack.id) || [];
  }, [stocksByRackId, activeRack]);

  const activeRackMovements = useMemo(() => {
    if (!activeRack) return [];
    return movements.filter((m) => m.rackId === activeRack.id).slice(0, 20);
  }, [movements, activeRack]);

  const visibleZones = useMemo(() => {
    if (areaFilter === 'ALL') return sortedZones;
    return sortedZones.filter((z) => z.id === areaFilter);
  }, [sortedZones, areaFilter]);

  const unackAlerts = useMemo(
    () => alerts.filter((a) => !a.acknowledged).slice(0, 3),
    [alerts]
  );

  const handleRefreshPulse = () => {
    setRefreshSpin(true);
    setNowClock(new Date());
    setTimeout(() => setRefreshSpin(false), 450);
  };

  const handleQuickSim = async (mode: 'RFID_IN' | 'BARCODE_OUT' | 'PROX_AB_IN' | 'PROX_BA_OUT') => {
    setSimBusy(true);
    try {
      const firstGate = gates[0]?.code || 'GATE-A';
      const secondGate = gates[1]?.code || firstGate;
      const thirdGate = gates[2]?.code || firstGate;
      if (mode === 'RFID_IN') {
        const tag = itemTags.find((t) => t.tagType === 'RFID') || itemTags[0];
        await onTriggerSimulatedEvent({
          source: 'RFID',
          gate_id: firstGate,
          device_id: 'RFID-GATE-A-01',
          direction: 'IN',
          tag_or_code: tag?.tagOrCode || items[0]?.sku || 'E2801160600002054C2A1B10',
          quantity: 2,
        });
      } else if (mode === 'BARCODE_OUT') {
        const tag = itemTags.find((t) => t.tagType === 'BARCODE') || itemTags[0];
        await onTriggerSimulatedEvent({
          source: 'BARCODE',
          gate_id: secondGate,
          device_id: 'BARCODE-GATE-B-01',
          direction: 'OUT',
          tag_or_code: tag?.tagOrCode || items[5]?.sku || '899100200105',
          quantity: 2,
        });
      } else if (mode === 'PROX_AB_IN') {
        await onTriggerSimulatedEvent({
          source: 'PROXIMITY',
          gate_id: thirdGate,
          device_id: 'PROX-GATE-C-01',
          sensor: 'A',
          tag_or_code: items[0]?.sku || 'SKU-CLD-013',
          quantity: 1,
        });
        await new Promise((r) => setTimeout(r, 350));
        await onTriggerSimulatedEvent({
          source: 'PROXIMITY',
          gate_id: thirdGate,
          device_id: 'PROX-GATE-C-01',
          sensor: 'B',
          tag_or_code: items[0]?.sku || 'SKU-CLD-013',
          quantity: 1,
        });
      } else if (mode === 'PROX_BA_OUT') {
        await onTriggerSimulatedEvent({
          source: 'PROXIMITY',
          gate_id: thirdGate,
          device_id: 'PROX-GATE-C-01',
          sensor: 'B',
          tag_or_code: items[0]?.sku || 'SKU-CLD-013',
          quantity: 1,
        });
        await new Promise((r) => setTimeout(r, 350));
        await onTriggerSimulatedEvent({
          source: 'PROXIMITY',
          gate_id: thirdGate,
          device_id: 'PROX-GATE-C-01',
          sensor: 'A',
          tag_or_code: items[0]?.sku || 'SKU-CLD-013',
          quantity: 1,
        });
      }
    } finally {
      setSimBusy(false);
    }
  };

  const dateFormatted = nowClock.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeFormatted = nowClock.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Circular SVG Donut math for right Detail Rak card
  const activePct = activeRack
    ? computeRackPct(activeRack.usedCapacity, activeRack.maxCapacity)
    : 0;
  const activeEffectiveStatus: EffectiveStatus = activeRack
    ? getRackEffectiveStatus(activeRack)
    : 'GREEN';
  const activeMeta = STATUS_META[activeEffectiveStatus];
  const activeTone = getCapacityTone(activePct, activeEffectiveStatus, greenMax, yellowMax);
  const ringRadius = 38;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = ringCircumference * (1 - Math.min(100, activePct) / 100);

  return (
    <div className="space-y-4">
      {/* Row 1: 6-Card Top KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3.5">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-[#1D63ED] flex items-center justify-center shrink-0">
            <Warehouse className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500">Total Rak</div>
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <span className="font-display text-2xl font-bold text-slate-900">
                {summary.total}
              </span>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                ({zones.length} Area)
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500">Rak Normal</div>
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <span className="font-display text-2xl font-bold text-slate-900">
                {summary.green}
              </span>
              <span className="text-xs font-semibold text-emerald-600">
                ({summary.greenPct}%)
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500">Hampir Penuh</div>
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <span className="font-display text-2xl font-bold text-slate-900">
                {summary.yellow}
              </span>
              <span className="text-xs font-semibold text-amber-600">
                ({summary.yellowPct}%)
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500">Perlu Perhatian</div>
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <span className="font-display text-2xl font-bold text-slate-900">
                {summary.red}
              </span>
              <span className="text-xs font-semibold text-rose-600">
                ({summary.redPct}%)
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
            <WifiOff className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500">Offline</div>
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <span className="font-display text-2xl font-bold text-slate-900">
                {summary.offline}
              </span>
              <span className="text-xs font-semibold text-slate-500">
                ({summary.offlinePct}%)
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 flex flex-col justify-center gap-1.5 text-xs">
          <div className="flex items-center gap-2 text-slate-700 font-medium">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="tabular-nums truncate">{dateFormatted}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-700 font-mono tabular-nums">
            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{timeFormatted} WIB</span>
          </div>
          <div className="flex items-center gap-1.5 font-semibold text-slate-800 pt-0.5">
            <span
              className={`w-2 h-2 rounded-full ${
                wsConnected ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            <span>{wsConnected ? 'Live' : 'Sync'}</span>
          </div>
        </div>
      </div>

      {/* Unacknowledged Alert Strip */}
      {unackAlerts.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-2xl px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="font-semibold text-slate-900 shrink-0">Peringatan Kapasitas:</span>
            <span className="text-slate-700 truncate">{unackAlerts[0].message}</span>
          </div>
          {canOperate && (
            <button
              onClick={() => void onAcknowledgeAlert(unackAlerts[0].id)}
              className="text-[#1D63ED] hover:underline font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              Tandai Dibaca ({unackAlerts.length})
            </button>
          )}
        </div>
      )}

      {/* Row 2: Toolbar Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center p-1 bg-white border border-slate-200 rounded-xl">
          <button
            onClick={() => setSubTab('map')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'map'
                ? 'bg-[#1D63ED] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            Peta Gudang
          </button>
          <button
            onClick={() => setSubTab('list')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'list'
                ? 'bg-[#1D63ED] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            Daftar Rak
          </button>
          <button
            onClick={() => setSubTab('stats')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'stats'
                ? 'bg-[#1D63ED] text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Statistik
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
              Pilih Area:
            </span>
            <select
              value={areaFilter}
              onChange={(e) => {
                setAreaFilter(e.target.value);
                setPopoverRackId('');
              }}
              className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-xl text-slate-700 cursor-pointer"
            >
              <option value="ALL">Semua Area ({zones.length})</option>
              {sortedZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onOpenLayoutSettings}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl whitespace-nowrap cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#1D63ED]" />
            Atur Kapasitas
          </button>

          <button
            onClick={handleRefreshPulse}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#1D63ED] hover:bg-blue-700 rounded-xl whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshSpin ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Row 3: Main Split (Left Map/List/Stats + Right Detail Rak) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        {/* Left Column */}
        <section className="xl:col-span-9 bg-white border border-slate-200/90 rounded-2xl p-3.5 flex flex-col">
          {subTab === 'map' && (
            <WarehouseFloorplanCanvas
              visibleZones={visibleZones}
              sortedRacks={sortedRacks}
              activeRack={activeRack}
              popoverRackId={popoverRackId}
              hasActiveFilter={hasActiveFilter}
              matchingRackIds={matchingRackIds}
              stocksByRackId={stocksByRackId}
              greenMax={greenMax}
              yellowMax={yellowMax}
              getRackEffectiveStatus={getRackEffectiveStatus}
              onSelectRack={(id) => setSelectedRackId(id)}
              onTogglePopover={(id) => setPopoverRackId((prev) => (prev === id ? '' : id))}
              onClosePopover={() => setPopoverRackId('')}
              onOpenRackHistory={() => setDrawerOpen(true)}
            />
          )}

          {subTab === 'list' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                    <th className="py-2.5 px-3">Kode Rak</th>
                    <th className="py-2.5 px-3">Area</th>
                    <th className="py-2.5 px-3">Kapasitas</th>
                    <th className="py-2.5 px-3">Utilisasi</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedRacks
                    .filter((r) => matchingRackIds.has(r.id))
                    .map((r) => {
                      const pct = computeRackPct(r.usedCapacity, r.maxCapacity);
                      const eff = getRackEffectiveStatus(r);
                      const meta = STATUS_META[eff];
                      const tone = getCapacityTone(pct, eff, greenMax, yellowMax);
                      const zone = zones.find((z) => z.id === r.zoneId);
                      const isSelected = activeRack?.id === r.id;

                      return (
                        <tr
                          key={r.id}
                          onClick={() => setSelectedRackId(r.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                            {r.code}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{zone?.name || r.zoneId}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-700 tabular-nums">
                            {r.usedCapacity} / {r.maxCapacity} {formatUnitShort(r.unitType)}
                          </td>
                          <td className="py-2.5 px-3 w-40">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-200"
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor: tone.hexMain,
                                  }}
                                />
                              </div>
                              <span className="font-mono font-semibold text-slate-800 w-9 text-right tabular-nums">
                                {pct}%
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${meta.badgeClass}`}
                            >
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  eff === 'YELLOW'
                                    ? 'animate-rack-blink-warn'
                                    : eff === 'RED'
                                    ? 'animate-rack-blink-critical'
                                    : ''
                                }`}
                                style={{ backgroundColor: tone.hexMain }}
                              />
                              {meta.label}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRackId(r.id);
                                setDrawerOpen(true);
                              }}
                              className="text-[#1D63ED] hover:underline font-semibold cursor-pointer"
                            >
                              Riwayat
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {subTab === 'stats' && (
            <div className="space-y-5 p-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    Utilisasi Kapasitas per Area
                  </h3>
                  <div className="space-y-3">
                    {sortedZones.map((z) => {
                      const zRacks = racks.filter((r) => r.zoneId === z.id);
                      const used = zRacks.reduce((s, r) => s + r.usedCapacity, 0);
                      const max = zRacks.reduce((s, r) => s + r.maxCapacity, 0);
                      const pct = max > 0 ? Math.round((used / max) * 100) : 0;
                      const areaStatus = computeStatusColor(used, max, greenMax, yellowMax);
                      const areaTone = getCapacityTone(pct, areaStatus, greenMax, yellowMax);
                      return (
                        <div key={z.id} className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="font-semibold text-slate-800">
                              {z.name} ({zRacks.length} Rak)
                            </span>
                            <span className="font-mono text-slate-600 tabular-nums">
                              {used.toLocaleString('id-ID')} / {max.toLocaleString('id-ID')} ({pct}%)
                            </span>
                          </div>
                          <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-200"
                              style={{
                                width: `${Math.min(100, pct)}%`,
                                backgroundColor: areaTone.hexMain,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    Ringkasan Operasional & Simulasi IoT
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="text-slate-500">Barang Masuk Hari Ini</div>
                      <div className="font-display text-xl font-bold text-emerald-600 tabular-nums">
                        +{summary.inToday}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="text-slate-500">Barang Keluar Hari Ini</div>
                      <div className="font-display text-xl font-bold text-sky-600 tabular-nums">
                        -{summary.outToday}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="text-slate-500">Device IoT Online</div>
                      <div className="font-display text-xl font-bold text-slate-900 tabular-nums">
                        {summary.onlineDevices} / {summary.totalDevices}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="text-slate-500">Gate Aktif</div>
                      <div className="font-display text-xl font-bold text-slate-900 tabular-nums">
                        {gates.filter((g) => g.isActive).length} / {gates.length}
                      </div>
                    </div>
                  </div>

                  {canOperate && (
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <div className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5 text-[#1D63ED]" />
                        Simulasi Event IoT Realtime (WebSocket)
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleQuickSim('RFID_IN')}
                          disabled={simBusy}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                        >
                          <Play className="w-2.5 h-2.5" /> RFID IN
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleQuickSim('BARCODE_OUT')}
                          disabled={simBusy}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 cursor-pointer"
                        >
                          <Play className="w-2.5 h-2.5" /> Barcode OUT
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleQuickSim('PROX_AB_IN')}
                          disabled={simBusy}
                          className="px-2.5 py-1.5 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg disabled:opacity-50 cursor-pointer"
                        >
                          Proximity A→B (IN)
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleQuickSim('PROX_BA_OUT')}
                          disabled={simBusy}
                          className="px-2.5 py-1.5 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg disabled:opacity-50 cursor-pointer"
                        >
                          Proximity B→A (OUT)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right Column: Detail Rak */}
        <aside className="xl:col-span-3 bg-white border border-slate-200/90 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 mb-3.5">
              Detail Rak
            </h2>

            {activeRack ? (
              <div className="space-y-4">
                {/* Top block: Status + Code + Rack Photo */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                        activeMeta.badgeClass
                      } ${
                        activeEffectiveStatus === 'YELLOW'
                          ? 'animate-rack-blink-warn'
                          : activeEffectiveStatus === 'RED'
                          ? 'animate-rack-blink-critical'
                          : ''
                      }`}
                    >
                      {activeEffectiveStatus === 'GREEN' && <CheckCircle2 className="w-3.5 h-3.5" />}
                      {activeEffectiveStatus === 'YELLOW' && <AlertTriangle className="w-3.5 h-3.5" />}
                      {activeEffectiveStatus === 'RED' && <AlertCircle className="w-3.5 h-3.5" />}
                      {activeEffectiveStatus === 'OFFLINE' && <WifiOff className="w-3.5 h-3.5" />}
                      <span>{activeMeta.label}</span>
                    </span>
                    <div>
                      <div className="font-display text-2xl font-bold text-slate-900 leading-tight">
                        {activeRack.code}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">
                        {activeRackZone?.name || activeRack.zoneId}
                      </div>
                    </div>
                  </div>

                  {!imgError ? (
                    <img
                      src={RACK_PHOTO_PATH}
                      alt={`Foto rak ${activeRack.code}`}
                      referrerPolicy="no-referrer"
                      onError={() => setImgError(true)}
                      className="w-24 h-20 rounded-xl object-cover border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="w-24 h-20 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                      <Warehouse className="w-7 h-7 text-slate-400" />
                    </div>
                  )}
                </div>

                {/* Circular Donut Gauge + Capacity Progress */}
                <div className="pt-3 border-t border-slate-100 flex items-center gap-4">
                  <div className="relative w-22 h-22 shrink-0 flex items-center justify-center">
                    <svg className="w-22 h-22 -rotate-90" viewBox="0 0 96 96">
                      <circle
                        cx="48"
                        cy="48"
                        r={ringRadius}
                        fill="none"
                        stroke="#f1f5f9"
                        strokeWidth="8"
                      />
                      <circle
                        cx="48"
                        cy="48"
                        r={ringRadius}
                        fill="none"
                        stroke={activeTone.hexMain}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={ringCircumference}
                        strokeDashoffset={ringDashOffset}
                      />
                    </svg>
                    <span className="absolute font-display text-lg font-bold text-slate-900 tabular-nums">
                      {activePct}%
                    </span>
                  </div>

                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="text-xs text-slate-500 font-medium">Kapasitas Rak</div>
                    <div className="font-display text-sm font-bold text-slate-900 tabular-nums truncate">
                      {activeRack.usedCapacity.toLocaleString('id-ID')} /{' '}
                      {activeRack.maxCapacity.toLocaleString('id-ID')}{' '}
                      {formatUnitShort(activeRack.unitType)}
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-200"
                        style={{
                          width: `${activePct}%`,
                          backgroundColor: activeTone.hexMain,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Metadata Spec Rows */}
                <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
                  <div className="grid grid-cols-12">
                    <span className="col-span-5 text-slate-500">Jumlah Barang</span>
                    <span className="col-span-7 font-semibold text-slate-900">
                      : {activeRackStocks.length} Jenis
                    </span>
                  </div>
                  <div className="grid grid-cols-12">
                    <span className="col-span-5 text-slate-500">Lokasi</span>
                    <span className="col-span-7 font-medium text-slate-800 truncate">
                      : {activeRackZone?.name || 'Area'} - Baris {activeRack.rowIndex + 1}
                    </span>
                  </div>
                  <div className="grid grid-cols-12">
                    <span className="col-span-5 text-slate-500">Status</span>
                    <span className="col-span-7 font-medium text-slate-800">
                      : {activeEffectiveStatus === 'OFFLINE' ? 'Sensor Offline' : 'Normal Operasi'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500 py-8 text-center">
                Klik salah satu rak pada peta untuk melihat detail.
              </div>
            )}
          </div>

          {activeRack && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="mt-5 w-full py-2.5 px-3 text-xs font-semibold text-[#1D63ED] bg-slate-50 hover:bg-blue-50 border border-slate-200 rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Lihat Riwayat</span>
            </button>
          )}
        </aside>
      </div>

      {/* Row 4: Bottom 3-Panel Row (Aktivitas Terakhir | Keterangan Warna | Filter & Pencarian) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Panel 1: Aktivitas Terakhir */}
        <section className="lg:col-span-6 bg-white border border-slate-200/90 rounded-2xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              <h3 className="font-display text-sm font-bold text-slate-900">
                Aktivitas Terakhir
              </h3>
            </div>
            <button
              type="button"
              onClick={onNavigateToLogs}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#1D63ED] hover:underline cursor-pointer"
            >
              <span>Lihat Semua</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-2 pr-3">Waktu</th>
                  <th className="py-2 pr-3">Rak</th>
                  <th className="py-2 pr-3">Aktivitas</th>
                  <th className="py-2 pr-3">Keterangan</th>
                  <th className="py-2">Petugas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      Belum ada pergerakan barang tercatat.
                    </td>
                  </tr>
                ) : (
                  movements.slice(0, 4).map((m) => {
                    const t = new Date(m.eventTimestamp);
                    const timeStr = `${String(t.getHours()).padStart(2, '0')}:${String(
                      t.getMinutes()
                    ).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
                    const dotColor =
                      m.placementStatus === 'OVER_CAPACITY_REJECTED'
                        ? 'bg-rose-500'
                        : m.placementStatus === 'UNASSIGNED'
                        ? 'bg-amber-400'
                        : m.direction === 'IN'
                        ? 'bg-emerald-500'
                        : 'bg-[#1D63ED]';
                    const actLabel =
                      m.placementStatus === 'OVER_CAPACITY_REJECTED'
                        ? 'Over-Capacity'
                        : m.direction === 'IN'
                        ? 'Barang Masuk'
                        : 'Barang Keluar';

                    return (
                      <tr key={m.id}>
                        <td className="py-2.5 pr-3 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                          {timeStr}
                        </td>
                        <td className="py-2.5 pr-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                          {m.rackCode || 'UNASSIGNED'}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-slate-800 font-medium">
                            <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                            {actLabel}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-600 truncate max-w-[200px]">
                          {m.quantity} {m.direction === 'IN' ? 'masuk' : 'keluar'} - {m.sku || m.tagOrCode}
                        </td>
                        <td className="py-2.5 text-slate-700 font-medium whitespace-nowrap">
                          {m.source === 'MANUAL' ? 'Operator' : m.source}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Panel 2: Keterangan Warna */}
        <section className="lg:col-span-3 bg-white border border-slate-200/90 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 mb-3.5">
              Keterangan Warna
            </h3>
            <div className="space-y-3 text-xs text-slate-700">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-6 h-3.5 rounded-full shrink-0 border border-emerald-600/30"
                    style={{
                      backgroundImage: 'linear-gradient(to right, #86efac, #22c55e, #15803d)',
                    }}
                  />
                  <span>Normal (0–{greenMax}%)</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">Lega→Padat</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-6 h-3.5 rounded-full shrink-0 border border-amber-600/30 animate-rack-blink-warn"
                    style={{
                      backgroundImage: 'linear-gradient(to right, #fde047, #f97316)',
                    }}
                  />
                  <span>Hampir Penuh ({greenMax + 1}–{yellowMax}%)</span>
                </div>
                <span className="text-[10px] text-amber-600 font-semibold">Berkedip</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-6 h-3.5 rounded-full shrink-0 border border-rose-700/30 animate-rack-blink-critical"
                    style={{
                      backgroundImage: 'linear-gradient(to right, #fb7185, #b91c1c)',
                    }}
                  />
                  <span>Perlu Perhatian (&gt; {yellowMax}%)</span>
                </div>
                <span className="text-[10px] text-rose-600 font-semibold">Berkedip</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-3.5 rounded-full bg-slate-400 shrink-0 border border-slate-500/40" />
                <span>Offline</span>
              </div>
            </div>
          </div>
          <p className="mt-3 pt-2.5 border-t border-slate-100 text-[11px] text-slate-500 leading-snug">
            Kepekatan warna &amp; bar bawah tiap rak menyesuaikan persentase keterisian.
          </p>
        </section>

        {/* Panel 3: Filter & Pencarian */}
        <section className="lg:col-span-3 bg-white border border-slate-200/90 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 mb-3.5">
              Filter & Pencarian
            </h3>
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari kode rak atau barang..."
                  className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50/70 focus:bg-white focus:outline-none focus:border-[#1D63ED]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-2.5 py-2 text-xs border border-slate-200 rounded-xl bg-white text-slate-700"
                >
                  <option value="ALL">Semua Status</option>
                  <option value="GREEN">Normal</option>
                  <option value="YELLOW">Hampir Penuh</option>
                  <option value="RED">Perlu Perhatian</option>
                  <option value="OFFLINE">Offline</option>
                </select>

                <select
                  value={areaFilter}
                  onChange={(e) => setAreaFilter(e.target.value)}
                  className="px-2.5 py-2 text-xs border border-slate-200 rounded-xl bg-white text-slate-700"
                >
                  <option value="ALL">Semua Area</option>
                  {sortedZones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('ALL');
                setAreaFilter('ALL');
              }}
              className="mt-3 text-[11px] font-semibold text-[#1D63ED] hover:underline self-start cursor-pointer"
            >
              Reset Filter ({matchingRackIds.size} rak cocok)
            </button>
          )}
        </section>
      </div>

      {/* Slide-Over Detail 20 Pergerakan Rak */}
      {drawerOpen && activeRack && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
          <div className="w-full max-w-lg bg-white h-full border-l border-slate-200 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="font-mono text-xs text-slate-500">Riwayat Rak</div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  {activeRack.code} — {activeRack.name}
                </h3>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <h4 className="text-xs font-semibold text-slate-700 mb-2.5">
                  Isi SKU Saat Ini ({activeRackStocks.length})
                </h4>
                {activeRackStocks.length === 0 ? (
                  <p className="text-xs text-slate-500">Tidak ada stok SKU terperinci di rak ini.</p>
                ) : (
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {activeRackStocks.map((st) => (
                      <div key={st.id} className="px-3.5 py-2.5 flex items-center justify-between text-xs">
                        <div>
                          <div className="font-mono font-semibold text-slate-900">{st.sku}</div>
                          <div className="text-slate-500">{st.itemName}</div>
                        </div>
                        <div className="font-mono font-bold text-slate-900 tabular-nums">
                          {st.quantity}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-700 mb-2.5">
                  20 Pergerakan Terakhir
                </h4>
                {activeRackMovements.length === 0 ? (
                  <p className="text-xs text-slate-500">Belum ada pergerakan di rak ini.</p>
                ) : (
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {activeRackMovements.map((m) => (
                      <div key={m.id} className="px-3.5 py-2.5 flex items-center justify-between text-xs">
                        <div>
                          <div className="flex items-center gap-1.5">
                            {m.direction === 'IN' ? (
                              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <ArrowUpRight className="w-3.5 h-3.5 text-sky-600" />
                            )}
                            <span className="font-mono font-semibold text-slate-900">
                              {m.sku || m.tagOrCode}
                            </span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-600">{m.source}</span>
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                            {new Date(m.eventTimestamp).toLocaleString('id-ID')} · {m.gateCode}
                          </div>
                        </div>
                        <div className="font-mono font-bold text-slate-900 tabular-nums">
                          {m.direction === 'IN' ? '+' : '-'}
                          {m.quantity}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
