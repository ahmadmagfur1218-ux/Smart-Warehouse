import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  WifiOff,
  X,
} from 'lucide-react';
import { computeRackPct, getCapacityTone } from '../lib/capacityEngine.ts';
import type { RackDoc, RackStockDoc, ZoneDoc } from '../shared/types.ts';

export type EffectiveRackStatus = 'GREEN' | 'YELLOW' | 'RED' | 'OFFLINE';

interface Props {
  visibleZones: ZoneDoc[];
  sortedRacks: RackDoc[];
  activeRack: RackDoc | null;
  popoverRackId: string;
  hasActiveFilter: boolean;
  matchingRackIds: Set<string>;
  stocksByRackId: Map<string, RackStockDoc[]>;
  greenMax?: number;
  yellowMax?: number;
  getRackEffectiveStatus: (rack: RackDoc) => EffectiveRackStatus;
  onSelectRack: (rackId: string) => void;
  onTogglePopover: (rackId: string) => void;
  onClosePopover: () => void;
  onOpenRackHistory: () => void;
}

function formatUnitShort(unitType: RackDoc['unitType']): string {
  if (unitType === 'PALLET_SLOT') return 'Pallet';
  if (unitType === 'M3') return 'm³';
  return 'kg';
}

const POPOVER_BADGE: Record<EffectiveRackStatus, string> = {
  GREEN: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  YELLOW: 'bg-amber-50 text-amber-800 border border-amber-200',
  RED: 'bg-rose-50 text-rose-700 border border-rose-200',
  OFFLINE: 'bg-slate-100 text-slate-600 border border-slate-200',
};

const TopDownPlant: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    viewBox="0 0 36 36"
    className={`w-6 h-6 drop-shadow-sm ${className}`}
    aria-hidden="true"
  >
    <circle cx="18" cy="18" r="14" fill="#14532d" opacity="0.22" />
    <circle cx="18" cy="18" r="10.5" fill="#15803d" />
    <ellipse cx="18" cy="10" rx="4" ry="7" fill="#22c55e" />
    <ellipse cx="18" cy="26" rx="4" ry="7" fill="#16a34a" />
    <ellipse cx="10" cy="18" rx="7" ry="4" fill="#22c55e" />
    <ellipse cx="26" cy="18" rx="7" ry="4" fill="#16a34a" />
    <ellipse
      cx="12"
      cy="12"
      rx="5.5"
      ry="3.2"
      transform="rotate(45 12 12)"
      fill="#4ade80"
    />
    <ellipse
      cx="24"
      cy="24"
      rx="5.5"
      ry="3.2"
      transform="rotate(45 24 24)"
      fill="#15803d"
    />
    <circle cx="18" cy="18" r="3.5" fill="#166534" />
  </svg>
);

export const WarehouseFloorplanCanvas: React.FC<Props> = ({
  visibleZones,
  sortedRacks,
  activeRack,
  popoverRackId,
  hasActiveFilter,
  matchingRackIds,
  stocksByRackId,
  greenMax = 69,
  yellowMax = 90,
  getRackEffectiveStatus,
  onSelectRack,
  onTogglePopover,
  onClosePopover,
  onOpenRackHistory,
}) => {
  return (
    <div
      className="flex-1 rounded-xl border border-slate-300 bg-[#8d96a3] p-[7px] shadow-inner overflow-x-auto relative flex flex-col"
      onClick={() => {
        if (popoverRackId) onClosePopover();
      }}
    >
      {/* Inner Concrete Warehouse Floor */}
      <div
        className="flex-1 min-w-[780px] rounded-[6px] border-2 border-[#6e7785] bg-[#e6eaef] flex relative overflow-hidden"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.18) 1px, transparent 1px), radial-gradient(circle at 50% 45%, rgba(255,255,255,0.45), rgba(203,213,225,0.28))',
          backgroundSize: '42px 42px, 42px 42px, 100% 100%',
        }}
      >
        {/* Top Perimeter Concrete Wall Strip with Structural Windows & Pillars */}
        <div className="pointer-events-none absolute top-0 inset-x-0 h-2.5 bg-gradient-to-b from-[#9aa3b0] to-[#bcc4cf] border-b border-[#6e7785]/60 flex items-center justify-around px-20 z-10">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="w-10 h-1 bg-[#e2e8f0] rounded-xs border border-slate-500/40" />
          ))}
        </div>

        {/* Left Architectural Wing: Ruang Admin, Loading Dock, Area Receiving */}
        <div className="w-[126px] shrink-0 border-r-[5px] border-[#828b98] bg-[#dadfe6] flex flex-col pt-2.5 relative z-10">
          {/* Room 1: Ruang Admin */}
          <div className="flex-1 border-b-[4px] border-[#828b98] p-2.5 flex flex-col items-center justify-between relative">
            {/* Doorway cut indicator on right wall */}
            <div className="absolute right-[-6px] bottom-3 w-2 h-8 bg-[#e6eaef] border-y border-slate-500" />
            <span className="font-display text-[11px] font-bold text-slate-800 text-center leading-tight mt-1">
              Ruang Admin
            </span>
            {/* Top-Down Office Desk & Chair SVG */}
            <svg viewBox="0 0 100 68" className="w-24 h-16 drop-shadow-sm" aria-hidden="true">
              {/* Rug / Shadow */}
              <rect x="10" y="14" width="80" height="44" rx="4" fill="#cbd5e1" opacity="0.6" />
              {/* Wooden L-Desk */}
              <rect x="14" y="22" width="72" height="22" rx="2" fill="#b78a5d" stroke="#784f2a" strokeWidth="1.5" />
              <rect x="64" y="14" width="22" height="30" rx="2" fill="#c69a6b" stroke="#784f2a" strokeWidth="1.5" />
              {/* Monitor & Keyboard */}
              <rect x="34" y="25" width="20" height="4" rx="1" fill="#1e293b" />
              <rect x="37" y="32" width="14" height="6" rx="1" fill="#475569" />
              {/* Swivel Chair */}
              <circle cx="44" cy="14" r="8" fill="#1e293b" stroke="#0f172a" strokeWidth="1.2" />
              <rect x="37" y="6" width="14" height="5" rx="2" fill="#334155" />
              {/* Desk Papers & Lamp */}
              <rect x="19" y="27" width="10" height="12" rx="1" fill="#f8fafc" stroke="#94a3b8" strokeWidth="0.8" />
              <circle cx="76" cy="22" r="4" fill="#64748b" />
            </svg>
          </div>

          {/* Room 2: Loading Dock */}
          <div className="flex-1 border-b-[4px] border-[#828b98] p-2.5 flex flex-col items-center justify-between relative">
            <div className="absolute right-[-6px] top-1/2 -translate-y-1/2 w-2 h-10 bg-[#e6eaef] border-y border-slate-500" />
            <span className="font-display text-[11px] font-bold text-slate-800 text-center leading-tight mt-0.5">
              Loading Dock
            </span>
            {/* Top-Down Forklift + Wooden Pallet with Boxes SVG */}
            <svg viewBox="0 0 110 64" className="w-24 h-14 drop-shadow-sm" aria-hidden="true">
              {/* Yellow Counterbalance Forklift */}
              <rect x="8" y="22" width="6" height="6" rx="1" fill="#0f172a" />
              <rect x="8" y="40" width="6" height="6" rx="1" fill="#0f172a" />
              <rect x="26" y="20" width="6" height="5" rx="1" fill="#0f172a" />
              <rect x="26" y="43" width="6" height="5" rx="1" fill="#0f172a" />
              <rect x="11" y="23" width="22" height="22" rx="4" fill="#f59e0b" stroke="#92400e" strokeWidth="1.3" />
              <rect x="15" y="27" width="11" height="14" rx="2" fill="#1e293b" />
              {/* Forks */}
              <rect x="33" y="26" width="16" height="3" fill="#475569" />
              <rect x="33" y="39" width="16" height="3" fill="#475569" />
              {/* Wooden Pallet */}
              <rect x="48" y="16" width="44" height="36" rx="2" fill="#d4a373" stroke="#8c5a2b" strokeWidth="1.5" />
              {/* 4 Stacked Cartons */}
              <rect x="52" y="19" width="16" height="14" rx="1" fill="#c69363" stroke="#7f4f24" strokeWidth="1" />
              <rect x="72" y="19" width="16" height="14" rx="1" fill="#b88454" stroke="#7f4f24" strokeWidth="1" />
              <rect x="52" y="35" width="16" height="14" rx="1" fill="#b88454" stroke="#7f4f24" strokeWidth="1" />
              <rect x="72" y="35" width="16" height="14" rx="1" fill="#c69363" stroke="#7f4f24" strokeWidth="1" />
              <line x1="60" y1="19" x2="60" y2="33" stroke="#e9d5b5" strokeWidth="1.5" opacity="0.7" />
              <line x1="80" y1="35" x2="80" y2="49" stroke="#e9d5b5" strokeWidth="1.5" opacity="0.7" />
            </svg>
          </div>

          {/* Room 3: Area Receiving */}
          <div className="flex-1 p-2.5 flex flex-col items-center justify-between relative">
            <div className="absolute right-[-6px] top-4 w-2 h-8 bg-[#e6eaef] border-y border-slate-500" />
            <span className="font-display text-[11px] font-bold text-slate-800 text-center leading-tight mt-0.5">
              Area Receiving
            </span>
            {/* Receiving Cargo Pallets SVG */}
            <svg viewBox="0 0 110 56" className="w-24 h-12 drop-shadow-sm" aria-hidden="true">
              <rect x="8" y="12" width="42" height="34" rx="2" fill="#d4a373" stroke="#8c5a2b" strokeWidth="1.4" />
              <rect x="12" y="16" width="15" height="12" fill="#c5915f" stroke="#7f4f24" strokeWidth="1" />
              <rect x="30" y="16" width="16" height="12" fill="#b57f4d" stroke="#7f4f24" strokeWidth="1" />
              <rect x="12" y="30" width="34" height="12" fill="#c5915f" stroke="#7f4f24" strokeWidth="1" />

              <rect x="58" y="12" width="42" height="34" rx="2" fill="#d4a373" stroke="#8c5a2b" strokeWidth="1.4" />
              <rect x="62" y="16" width="16" height="26" fill="#b57f4d" stroke="#7f4f24" strokeWidth="1" />
              <rect x="81" y="16" width="15" height="12" fill="#c5915f" stroke="#7f4f24" strokeWidth="1" />
              <rect x="81" y="30" width="15" height="12" fill="#c5915f" stroke="#7f4f24" strokeWidth="1" />
            </svg>
          </div>
        </div>

        {/* Main Floor Area Bays */}
        <div className="flex-1 pt-5 pb-0 px-3 sm:px-4 flex flex-col justify-between relative min-w-0">
          {visibleZones.length === 0 ? (
            <div className="m-auto text-xs text-slate-500">
              Belum ada area terdaftar. Klik &ldquo;Atur Kapasitas&rdquo; untuk membuat area & rak.
            </div>
          ) : (
            <div
              className="grid gap-3 my-auto"
              style={{
                gridTemplateColumns: `repeat(${Math.min(
                  Math.max(visibleZones.length, 1),
                  6
                )}, minmax(0, 1fr))`,
              }}
            >
              {visibleZones.map((zone, zIdx) => {
                const zoneRacks = sortedRacks.filter((r) => r.zoneId === zone.id);
                const maxCol = zoneRacks.reduce((acc, r) => Math.max(acc, r.colIndex), 0);
                const aisleCount = Math.max(1, maxCol + 1);
                const aisles: RackDoc[][] = Array.from({ length: aisleCount }, () => []);
                for (const r of zoneRacks) {
                  const idx = Math.min(aisleCount - 1, Math.max(0, r.colIndex));
                  aisles[idx].push(r);
                }
                const isDense = zoneRacks.length > 12;
                const isMedium = zoneRacks.length > 6 && !isDense;
                const placePopoverLeft =
                  visibleZones.length > 1 && zIdx >= Math.ceil(visibleZones.length / 2);

                return (
                  <div
                    key={zone.id}
                    className={`flex flex-col items-center relative px-1.5 pb-1.5 pt-0.5 ${
                      zIdx < visibleZones.length - 1
                        ? 'border-r border-dashed border-slate-400/70 pr-3'
                        : ''
                    }`}
                  >
                    {/* Top Structural Column Square */}
                    <div className="w-2.5 h-2.5 bg-slate-500/70 border border-slate-600 rounded-[1px] -mt-2 mb-1.5 opacity-65" />

                    {/* Blue Area Header Badge */}
                    <div className="bg-[#1D63ED] text-white text-[11px] font-bold px-4 py-1 rounded-md shadow-sm mb-2.5 truncate max-w-full tracking-wide">
                      {zone.name}
                    </div>

                    {/* Vertical Pallet Aisles */}
                    <div
                      className="w-full grid gap-2 flex-1 items-start"
                      style={{
                        gridTemplateColumns: `repeat(${aisleCount}, minmax(0, 1fr))`,
                      }}
                    >
                      {aisles.map((colRacks, cIdx) => (
                        <div
                          key={cIdx}
                          className="flex flex-col gap-[4px] bg-slate-400/20 p-[3px] rounded-[4px] border border-slate-400/30"
                        >
                          {colRacks.map((rack) => {
                            const eff = getRackEffectiveStatus(rack);
                            const pct = computeRackPct(rack.usedCapacity, rack.maxCapacity);
                            const tone = getCapacityTone(pct, eff, greenMax, yellowMax);
                            const isSelected = activeRack?.id === rack.id;
                            const isPopoverOpen = popoverRackId === rack.id;
                            const isDimmed = hasActiveFilter && !matchingRackIds.has(rack.id);
                            const stocksCount = (stocksByRackId.get(rack.id) || []).length;
                            const blinkClass =
                              !isDimmed && eff === 'YELLOW'
                                ? 'animate-rack-blink-warn'
                                : !isDimmed && eff === 'RED'
                                ? 'animate-rack-blink-critical'
                                : '';

                            return (
                              <div key={rack.id} className="relative">
                                <button
                                  type="button"
                                  title={`Rak ${rack.code} · ${tone.label} (${pct}% · ${rack.usedCapacity}/${rack.maxCapacity} ${formatUnitShort(rack.unitType)})`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectRack(rack.id);
                                    onTogglePopover(rack.id);
                                  }}
                                  style={{
                                    backgroundImage: `linear-gradient(to bottom, ${tone.hexLight}, ${tone.hexMain} 55%, ${tone.hexDark})`,
                                    borderColor: tone.hexDark,
                                    borderBottomColor: tone.hexLip,
                                  }}
                                  className={`w-full rounded-[3px] border border-b-[3px] shadow-xs transition-all cursor-pointer relative overflow-hidden flex flex-col items-center justify-between ${
                                    tone.textDark ? 'text-slate-900' : 'text-white'
                                  } ${
                                    isDense
                                      ? 'h-[38px] px-0.5 pt-1 pb-[5px]'
                                      : isMedium
                                      ? 'h-[44px] px-1 pt-1 pb-[6px]'
                                      : 'h-12 px-1.5 pt-1 pb-[6px]'
                                  } ${blinkClass} ${
                                    isSelected
                                      ? 'ring-2 ring-[#1D63ED] ring-offset-1 z-10 scale-[1.03]'
                                      : 'hover:brightness-105'
                                  } ${isDimmed ? 'opacity-20' : ''}`}
                                >
                                  {(eff === 'YELLOW' || eff === 'RED') && (
                                    <span
                                      className={`pointer-events-none absolute top-[3px] right-[3px] w-1.5 h-1.5 rounded-full z-20 ${
                                        eff === 'RED'
                                          ? 'bg-white ring-1 ring-rose-700'
                                          : 'bg-white ring-1 ring-amber-700'
                                      }`}
                                    />
                                  )}
                                  {/* 3D Top Crate Carton Seam Overlay */}
                                  <div
                                    className={`pointer-events-none absolute inset-[2px] bottom-[5px] grid grid-cols-2 ${
                                      isDense ? 'grid-rows-2' : ''
                                    } gap-[2px] opacity-60`}
                                  >
                                    <div
                                      className="rounded-[1px] border border-black/15 bg-white/15"
                                    />
                                    <div
                                      className="rounded-[1px] border border-black/15 bg-white/15"
                                    />
                                    {isDense && (
                                      <>
                                        <div
                                          className="rounded-[1px] border border-black/15 bg-white/15"
                                        />
                                        <div
                                          className="rounded-[1px] border border-black/15 bg-white/15"
                                        />
                                      </>
                                    )}
                                  </div>

                                  {isDense ? (
                                    <span
                                      className={`relative z-10 my-auto font-mono text-[9px] font-bold leading-none tabular-nums ${
                                        tone.textDark
                                          ? 'text-slate-900'
                                          : 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]'
                                      }`}
                                    >
                                      {eff === 'OFFLINE' ? 'OFF' : `${pct}%`}
                                    </span>
                                  ) : (
                                    <div
                                      className={`relative z-10 my-auto flex flex-col items-center leading-tight ${
                                        tone.textDark
                                          ? 'text-slate-900'
                                          : 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]'
                                      }`}
                                    >
                                      <span className="font-mono text-[10px] font-bold">
                                        {rack.code.replace(/^RACK-/i, '')}
                                      </span>
                                      <span className="font-mono text-[9px] font-semibold tabular-nums">
                                        {eff === 'OFFLINE' ? 'OFF' : `${pct}%`}
                                      </span>
                                    </div>
                                  )}

                                  {/* Proportional Per-Rack Capacity Fill Bar */}
                                  <div className="pointer-events-none absolute bottom-0 inset-x-0 h-[4px] bg-black/25">
                                    <div
                                      className={`h-full transition-all duration-200 ${
                                        tone.textDark ? 'bg-slate-900/75' : 'bg-white/90'
                                      }`}
                                      style={{ width: `${Math.max(4, pct)}%` }}
                                    />
                                  </div>
                                </button>

                                {/* Floating Popover Card (matches Rak B-12 in reference) */}
                                {isPopoverOpen && (
                                  <div
                                    className={`absolute top-1/2 -translate-y-1/2 z-30 w-56 bg-white border border-slate-200 rounded-xl shadow-xl p-3.5 text-left text-xs ${
                                      placePopoverLeft ? 'right-full mr-2.5' : 'left-full ml-2.5'
                                    }`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex items-center justify-between gap-1.5 mb-2 pb-2 border-b border-slate-100">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        {eff === 'GREEN' && (
                                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                        )}
                                        {eff === 'YELLOW' && (
                                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                                        )}
                                        {eff === 'RED' && (
                                          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                                        )}
                                        {eff === 'OFFLINE' && (
                                          <WifiOff className="w-4 h-4 text-slate-400 shrink-0" />
                                        )}
                                        <span className="font-display font-bold text-slate-900 truncate">
                                          Rak {rack.code}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={onClosePopover}
                                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>

                                    <div className="mb-2.5 flex items-center justify-between gap-2">
                                      <span
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${POPOVER_BADGE[eff]}`}
                                      >
                                        <span
                                          className="w-1.5 h-1.5 rounded-full shrink-0"
                                          style={{ backgroundColor: tone.hexMain }}
                                        />
                                        {tone.label}
                                      </span>
                                      <span className="font-mono text-[11px] font-bold text-slate-900 tabular-nums">
                                        {pct}%
                                      </span>
                                    </div>

                                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2.5">
                                      <div
                                        className="h-full rounded-full transition-all duration-200"
                                        style={{
                                          width: `${pct}%`,
                                          backgroundColor: tone.hexMain,
                                        }}
                                      />
                                    </div>

                                    <div className="space-y-1.5 text-[11px]">
                                      <div className="grid grid-cols-12">
                                        <span className="col-span-5 text-slate-500">Kapasitas</span>
                                        <span className="col-span-7 font-mono font-bold text-slate-900 tabular-nums">
                                          : {pct}%
                                        </span>
                                      </div>
                                      <div className="grid grid-cols-12">
                                        <span className="col-span-5 text-slate-500">Terisi</span>
                                        <span className="col-span-7 font-mono font-semibold text-slate-800 tabular-nums">
                                          : {rack.usedCapacity.toLocaleString('id-ID')} /{' '}
                                          {rack.maxCapacity.toLocaleString('id-ID')}{' '}
                                          {formatUnitShort(rack.unitType)}
                                        </span>
                                      </div>
                                      <div className="grid grid-cols-12">
                                        <span className="col-span-5 text-slate-500">Barang</span>
                                        <span className="col-span-7 font-semibold text-slate-800">
                                          : {stocksCount} Jenis
                                        </span>
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        onClosePopover();
                                        onOpenRackHistory();
                                      }}
                                      className="mt-3 pt-2 border-t border-slate-100 w-full flex items-center gap-1 text-[11px] font-semibold text-[#1D63ED] hover:underline cursor-pointer"
                                    >
                                      <span>Lihat Detail</span>
                                      <ArrowRight className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom Entrance Ramp: Pintu Utama with Hazard Stripes & Plants */}
          <div className="mt-3 flex items-end justify-between px-4 pointer-events-none">
            <TopDownPlant className="mb-1.5" />

            <div className="flex items-end">
              {/* Left Hazard Curb */}
              <div
                className="w-2.5 h-10 border-t border-l border-slate-600"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(-45deg, #f59e0b, #f59e0b 4px, #1e293b 4px, #1e293b 8px)',
                }}
              />
              {/* Main Ramp Floor */}
              <div className="w-32 h-10 bg-gradient-to-b from-[#cfd6df] to-[#dde3eb] border-t-2 border-slate-500 flex flex-col items-center justify-center gap-0.5 shadow-inner">
                <ArrowUp className="w-4 h-4 text-[#1D63ED] stroke-[3]" />
                <span className="font-display text-[11px] font-bold text-slate-800 leading-none">
                  Pintu Utama
                </span>
              </div>
              {/* Right Hazard Curb */}
              <div
                className="w-2.5 h-10 border-t border-r border-slate-600"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, #f59e0b, #f59e0b 4px, #1e293b 4px, #1e293b 8px)',
                }}
              />
            </div>

            <TopDownPlant className="mb-1.5" />
          </div>
        </div>
      </div>
    </div>
  );
};
