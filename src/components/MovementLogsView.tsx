import React, { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import type { GateDoc, MovementDoc } from '../shared/types.ts';

interface Props {
  movements: MovementDoc[];
  gates: GateDoc[];
}

export const MovementLogsView: React.FC<Props> = ({ movements, gates }) => {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [gateFilter, setGateFilter] = useState('ALL');
  const [dirFilter, setDirFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [skuSearch, setSkuSearch] = useState('');

  const filtered = useMemo(() => {
    return movements.filter((m) => {
      const tsDate = m.eventTimestamp.slice(0, 10);
      if (dateFrom && tsDate < dateFrom) return false;
      if (dateTo && tsDate > dateTo) return false;
      if (gateFilter !== 'ALL' && m.gateCode !== gateFilter) return false;
      if (dirFilter !== 'ALL' && m.direction !== dirFilter) return false;
      if (sourceFilter !== 'ALL' && m.source !== sourceFilter) return false;
      if (skuSearch.trim()) {
        const q = skuSearch.trim().toLowerCase();
        const matchSku = (m.sku || '').toLowerCase().includes(q);
        const matchName = (m.itemName || '').toLowerCase().includes(q);
        const matchTag = (m.tagOrCode || '').toLowerCase().includes(q);
        if (!matchSku && !matchName && !matchTag) return false;
      }
      return true;
    });
  }, [movements, dateFrom, dateTo, gateFilter, dirFilter, sourceFilter, skuSearch]);

  const exportCsv = () => {
    const headers = [
      'Event ID',
      'Timestamp',
      'Gate',
      'Direction',
      'SKU',
      'Item Name',
      'Quantity',
      'Source',
      'Device ID',
      'Rack',
      'Placement Status',
      'Tag/Code',
    ];
    const rows = filtered.map((m) => [
      m.eventId,
      m.eventTimestamp,
      m.gateCode,
      m.direction,
      m.sku || '',
      m.itemName || '',
      String(m.quantity),
      m.source,
      m.deviceId || '',
      m.rackCode || 'UNASSIGNED',
      m.placementStatus,
      m.tagOrCode || '',
    ]);
    const csv =
      '\uFEFF' +
      [headers, ...rows]
        .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `warehouse-movements-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end">
        <div className="lg:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Cari SKU / Tag / Barang</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={skuSearch}
              onChange={(e) => setSkuSearch(e.target.value)}
              placeholder="SKU-ELC-001 atau EPC..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Dari Tanggal</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Sampai Tanggal</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Gate</label>
          <select
            value={gateFilter}
            onChange={(e) => setGateFilter(e.target.value)}
            className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="ALL">Semua Gate</option>
            {gates.map((g) => (
              <option key={g.id} value={g.code}>
                {g.code}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Arah</label>
            <select
              value={dirFilter}
              onChange={(e) => setDirFilter(e.target.value)}
              className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="ALL">Semua</option>
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Sumber</label>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="ALL">Semua</option>
              <option value="RFID">RFID</option>
              <option value="BARCODE">BARCODE</option>
              <option value="PROXIMITY">PROXIMITY</option>
              <option value="MANUAL">MANUAL</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={exportCsv}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV ({filtered.length})
          </button>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-3 px-4">Waktu</th>
                <th className="py-3 px-4">Gate</th>
                <th className="py-3 px-4">Arah</th>
                <th className="py-3 px-4">SKU / Barang</th>
                <th className="py-3 px-4 text-right">Qty</th>
                <th className="py-3 px-4">Sumber & Device</th>
                <th className="py-3 px-4">Rak</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    Tidak ada log pergerakan yang sesuai filter.
                  </td>
                </tr>
              ) : (
                filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap tabular-nums">
                      {new Date(m.eventTimestamp).toLocaleString('id-ID')}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                      {m.gateCode}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`font-mono font-bold ${
                          m.direction === 'IN' ? 'text-emerald-700' : 'text-sky-700'
                        }`}
                      >
                        {m.direction}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-mono font-semibold text-slate-900">
                        {m.sku || m.tagOrCode}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[220px]">
                        {m.itemName || 'Unmapped'}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {m.quantity}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-800">{m.source}</div>
                      <div className="text-[11px] font-mono text-slate-500">{m.deviceId}</div>
                    </td>
                    <td className="py-2.5 px-4 font-mono font-medium text-slate-800">
                      {m.rackCode || 'UNASSIGNED'}
                    </td>
                    <td className="py-2.5 px-4">
                      {m.placementStatus === 'ASSIGNED' && (
                        <span className="text-emerald-700 font-medium">Tercatat</span>
                      )}
                      {m.placementStatus === 'UNASSIGNED' && (
                        <span className="text-amber-700 font-semibold">UNASSIGNED</span>
                      )}
                      {m.placementStatus === 'OVER_CAPACITY_REJECTED' && (
                        <span className="text-rose-700 font-semibold">OVER CAPACITY</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
