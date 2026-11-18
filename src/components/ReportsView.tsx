import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { computeRackPct, computeStatusColor, getCapacityTone } from '../lib/capacityEngine.ts';
import type { GateDoc, MovementDoc, RackDoc, SettingDoc } from '../shared/types.ts';

interface Props {
  movements: MovementDoc[];
  gates: GateDoc[];
  racks: RackDoc[];
  settings?: SettingDoc | null;
}

export const ReportsView: React.FC<Props> = ({ movements, gates, racks, settings }) => {
  const greenMax = settings?.greenMaxPct ?? 69;
  const yellowMax = settings?.yellowMaxPct ?? 90;

  const dailyData = useMemo(() => {
    const map = new Map<string, { date: string; IN: number; OUT: number }>();
    for (const m of movements) {
      if (m.placementStatus === 'OVER_CAPACITY_REJECTED') continue;
      const date = m.eventTimestamp.slice(0, 10);
      const curr = map.get(date) || { date, IN: 0, OUT: 0 };
      if (m.direction === 'IN') curr.IN += m.quantity;
      else curr.OUT += m.quantity;
      map.set(date, curr);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  }, [movements]);

  const gateData = useMemo(() => {
    const map = new Map<string, { gate: string; IN: number; OUT: number }>();
    for (const g of gates) {
      map.set(g.code, { gate: g.code, IN: 0, OUT: 0 });
    }
    for (const m of movements) {
      if (m.placementStatus === 'OVER_CAPACITY_REJECTED') continue;
      const curr = map.get(m.gateCode) || { gate: m.gateCode, IN: 0, OUT: 0 };
      if (m.direction === 'IN') curr.IN += m.quantity;
      else curr.OUT += m.quantity;
      map.set(m.gateCode, curr);
    }
    return [...map.values()];
  }, [movements, gates]);

  const rackUtilData = useMemo(() => {
    return [...racks]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((r) => {
        const pct = computeRackPct(r.usedCapacity, r.maxCapacity);
        const st = computeStatusColor(r.usedCapacity, r.maxCapacity, greenMax, yellowMax);
        const tone = getCapacityTone(pct, st, greenMax, yellowMax);
        return {
          rack: r.code,
          utilizationPct: pct,
          fillColor: tone.hexMain,
        };
      });
  }, [racks, greenMax, yellowMax]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="font-display text-sm font-semibold text-slate-900 mb-1">
            Pergerakan Barang Masuk vs Keluar per Hari
          </h2>
          <p className="text-xs text-slate-500 mb-4">Agregasi kuantitas event IN dan OUT harian</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="IN" name="Barang Masuk (IN)" fill="#16a34a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="OUT" name="Barang Keluar (OUT)" fill="#0284c7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="font-display text-sm font-semibold text-slate-900 mb-1">
            Volume Pergerakan per Gate
          </h2>
          <p className="text-xs text-slate-500 mb-4">Distribusi beban lalu lintas antar gerbang gudang</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gateData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="gate" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="IN" name="IN" fill="#16a34a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="OUT" name="OUT" fill="#0f172a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-display text-sm font-semibold text-slate-900 mb-1">
          Utilisasi Kapasitas Seluruh Rak (%)
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Persentase dan indikator warna keterisian setiap rak saat ini
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rackUtilData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="rack" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip />
              <Bar dataKey="utilizationPct" name="Utilisasi (%)" radius={[4, 4, 0, 0]}>
                {rackUtilData.map((entry) => (
                  <Cell key={entry.rack} fill={entry.fillColor} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
};
