import React, { useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { Check, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import { computeRackPct, computeStatusColor, getCapacityTone } from '../lib/capacityEngine.ts';
import type {
  GateDoc,
  GateType,
  ItemDoc,
  ItemTagDoc,
  RackDoc,
  RackUnitType,
  SettingDoc,
  TagType,
  UserRole,
  WarehouseDoc,
  ZoneDoc,
} from '../shared/types.ts';

interface Props {
  role: UserRole;
  currentUid: string;
  warehouse: WarehouseDoc | null;
  zones: ZoneDoc[];
  gates: GateDoc[];
  racks: RackDoc[];
  items: ItemDoc[];
  itemTags: ItemTagDoc[];
  settings: SettingDoc | null;
  onNotify: (msg: string, tone?: 'info' | 'warn' | 'error') => void;
}

type TabKey = 'RACKS' | 'GATES' | 'ZONES' | 'ITEMS' | 'TAGS' | 'WAREHOUSE';

export const MasterDataView: React.FC<Props> = ({
  role,
  currentUid,
  warehouse,
  zones,
  gates,
  racks,
  items,
  itemTags,
  settings,
  onNotify,
}) => {
  const [tab, setTab] = useState<TabKey>('RACKS');
  const canEdit = role === 'ADMIN' || role === 'OPERATOR';
  const whId = warehouse?.id || 'wh-jkt-01';
  const ownerUid = warehouse?.ownerUid || currentUid;
  const memberUids = warehouse?.memberUids?.includes(currentUid)
    ? warehouse.memberUids
    : [currentUid];

  // Form States
  const [zoneCode, setZoneCode] = useState('');
  const [zoneName, setZoneName] = useState('');

  const [gateCode, setGateCode] = useState('');
  const [gateName, setGateName] = useState('');
  const [gateZoneId, setGateZoneId] = useState(zones[0]?.id || '');
  const [gateType, setGateType] = useState<GateType>('BIDIRECTIONAL');
  const [gateDebounce, setGateDebounce] = useState(5);

  const [rackCode, setRackCode] = useState('');
  const [rackName, setRackName] = useState('');
  const [rackZoneId, setRackZoneId] = useState(zones[0]?.id || '');
  const [rackUnit, setRackUnit] = useState<RackUnitType>('PALLET_SLOT');
  const [rackMax, setRackMax] = useState(50);

  const [itemSku, setItemSku] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemCat, setItemCat] = useState('General');
  const [itemVol, setItemVol] = useState(1.0);
  const [itemDefRack, setItemDefRack] = useState('');

  const [tagCode, setTagCode] = useState('');
  const [tagType, setTagType] = useState<TagType>('RFID');
  const [tagItemId, setTagItemId] = useState(items[0]?.id || '');

  const [whName, setWhName] = useState(warehouse?.name || '');
  const [whLoc, setWhLoc] = useState(warehouse?.location || '');

  const [editingRackId, setEditingRackId] = useState<string | null>(null);
  const [editUsedCap, setEditUsedCap] = useState<number>(0);
  const [editMaxCap, setEditMaxCap] = useState<number>(1000);

  const greenMax = settings?.greenMaxPct ?? 69;
  const yellowMax = settings?.yellowMaxPct ?? 90;

  const safeId = (prefix: string, code: string) =>
    `${prefix}-${code.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 48)}-${Date.now().toString(36).slice(-4)}`;

  const handleCreateZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !zoneCode.trim() || !zoneName.trim()) return;
    const id = safeId('zone', zoneCode);
    try {
      await setDoc(doc(db, 'zones', id), {
        id,
        warehouseId: whId,
        code: zoneCode.trim().toUpperCase(),
        name: zoneName.trim(),
        description: '',
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setZoneCode('');
      setZoneName('');
      onNotify(`Zona ${zoneCode.toUpperCase()} ditambahkan.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `zones/${id}`);
    }
  };

  const handleCreateGate = async (e: React.FormEvent) => {
    e.preventDefault();
    const zId = gateZoneId || zones[0]?.id;
    if (!canEdit || !gateCode.trim() || !gateName.trim() || !zId) return;
    const id = safeId('gate', gateCode);
    try {
      await setDoc(doc(db, 'gates', id), {
        id,
        warehouseId: whId,
        zoneId: zId,
        code: gateCode.trim().toUpperCase(),
        name: gateName.trim(),
        gateType,
        debounceWindowSec: Number(gateDebounce) || 5,
        isActive: true,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setGateCode('');
      setGateName('');
      onNotify(`Gate ${gateCode.toUpperCase()} ditambahkan.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `gates/${id}`);
    }
  };

  const handleCreateRack = async (e: React.FormEvent) => {
    e.preventDefault();
    const zId = rackZoneId || zones[0]?.id;
    if (!canEdit || !rackCode.trim() || !rackName.trim() || !zId) return;
    const id = safeId('rack', rackCode);
    try {
      await setDoc(doc(db, 'racks', id), {
        id,
        warehouseId: whId,
        zoneId: zId,
        code: rackCode.trim().toUpperCase(),
        name: rackName.trim(),
        unitType: rackUnit,
        maxCapacity: Number(rackMax) || 50,
        usedCapacity: 0,
        statusColor: computeStatusColor(0, Number(rackMax) || 50, greenMax, yellowMax),
        rowIndex: 2,
        colIndex: 0,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setRackCode('');
      setRackName('');
      onNotify(`Rak ${rackCode.toUpperCase()} ditambahkan.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `racks/${id}`);
    }
  };

  const handleSaveRackCapacity = async (rack: RackDoc) => {
    if (!canEdit) return;
    const nextMax = Math.max(1, Number(editMaxCap) || rack.maxCapacity);
    const nextUsed = Math.max(0, Number(editUsedCap) || 0);
    const nextStatus = computeStatusColor(nextUsed, nextMax, greenMax, yellowMax);
    try {
      await updateDoc(doc(db, 'racks', rack.id), {
        usedCapacity: nextUsed,
        maxCapacity: nextMax,
        statusColor: nextStatus,
        updatedAt: serverTimestamp(),
      });
      setEditingRackId(null);
      onNotify(`Kapasitas rak ${rack.code} diperbarui (${computeRackPct(nextUsed, nextMax)}%).`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `racks/${rack.id}`);
    }
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !itemSku.trim() || !itemName.trim()) return;
    const id = safeId('item', itemSku);
    try {
      await setDoc(doc(db, 'items', id), {
        id,
        warehouseId: whId,
        sku: itemSku.trim().toUpperCase(),
        name: itemName.trim(),
        category: itemCat.trim() || 'General',
        unitLabel: 'UNIT',
        unitVolumeM3: Number(itemVol) || 1,
        defaultRackId: itemDefRack,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setItemSku('');
      setItemName('');
      onNotify(`SKU ${itemSku.toUpperCase()} ditambahkan.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `items/${id}`);
    }
  };

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = tagItemId || items[0]?.id;
    const matchedItem = items.find((i) => i.id === targetId);
    if (!canEdit || !tagCode.trim() || !matchedItem) return;
    const id = safeId('tag', tagCode);
    try {
      await setDoc(doc(db, 'item_tags', id), {
        id,
        warehouseId: whId,
        tagOrCode: tagCode.trim(),
        tagType,
        itemId: matchedItem.id,
        sku: matchedItem.sku,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setTagCode('');
      onNotify(`Mapping tag ${tagCode.trim()} -> ${matchedItem.sku} tersimpan.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `item_tags/${id}`);
    }
  };

  const handleImportItemsCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canEdit) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let count = 0;
    for (let idx = 0; idx < lines.length; idx++) {
      const cols = lines[idx].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      if (idx === 0 && cols[0]?.toLowerCase() === 'sku') continue;
      const [sku, name, category = 'Imported', unitLabel = 'UNIT', vol = '1'] = cols;
      if (!sku || !name) continue;
      const id = safeId('item', sku);
      await setDoc(doc(db, 'items', id), {
        id,
        warehouseId: whId,
        sku: sku.toUpperCase(),
        name,
        category,
        unitLabel,
        unitVolumeM3: Number(vol) || 1,
        defaultRackId: '',
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      count++;
    }
    e.target.value = '';
    onNotify(`Import CSV Item selesai: ${count} SKU ditambahkan.`);
  };

  const handleImportTagsCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canEdit) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let count = 0;
    for (let idx = 0; idx < lines.length; idx++) {
      const cols = lines[idx].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      if (idx === 0 && cols[0]?.toLowerCase().includes('tag')) continue;
      const [tagOrCode, rawType = 'RFID', sku] = cols;
      const matched = items.find((i) => i.sku.toUpperCase() === (sku || '').toUpperCase());
      if (!tagOrCode || !matched) continue;
      const tType: TagType =
        rawType.toUpperCase() === 'BARCODE'
          ? 'BARCODE'
          : rawType.toUpperCase() === 'QR'
          ? 'QR'
          : 'RFID';
      const id = safeId('tag', tagOrCode);
      await setDoc(doc(db, 'item_tags', id), {
        id,
        warehouseId: whId,
        tagOrCode,
        tagType: tType,
        itemId: matched.id,
        sku: matched.sku,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      count++;
    }
    e.target.value = '';
    onNotify(`Import CSV Tag selesai: ${count} mapping ditambahkan.`);
  };

  const handleDelete = async (col: string, id: string, label: string) => {
    if (!canEdit) return;
    try {
      await deleteDoc(doc(collection(db, col), id));
      onNotify(`${label} dihapus.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `${col}/${id}`);
    }
  };

  const handleUpdateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouse || role !== 'ADMIN') return;
    try {
      await updateDoc(doc(db, 'warehouses', warehouse.id), {
        name: whName.trim() || warehouse.name,
        location: whLoc.trim(),
        updatedAt: serverTimestamp(),
      });
      onNotify('Profil warehouse diperbarui.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `warehouses/${warehouse.id}`);
    }
  };

  return (
    <div className="space-y-5">
      {/* Segmented Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl w-fit flex-wrap">
        {(
          [
            ['RACKS', `Rak (${racks.length})`],
            ['GATES', `Gate (${gates.length})`],
            ['ZONES', `Zona (${zones.length})`],
            ['ITEMS', `Item / SKU (${items.length})`],
            ['TAGS', `Tag Mapping (${itemTags.length})`],
            ['WAREHOUSE', 'Warehouse'],
          ] as Array<[TabKey, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* RACKS */}
      {tab === 'RACKS' && (
        <div className="space-y-4">
          {canEdit && (
            <form
              onSubmit={handleCreateRack}
              className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-6 gap-3 items-end"
            >
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Kode Rak</label>
                <input
                  value={rackCode}
                  onChange={(e) => setRackCode(e.target.value)}
                  placeholder="RACK-D1"
                  required
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Rak</label>
                <input
                  value={rackName}
                  onChange={(e) => setRackName(e.target.value)}
                  placeholder="D1 High Bay"
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Zona</label>
                <select
                  value={rackZoneId || zones[0]?.id || ''}
                  onChange={(e) => setRackZoneId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.code}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Satuan</label>
                <select
                  value={rackUnit}
                  onChange={(e) => setRackUnit(e.target.value as RackUnitType)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="PALLET_SLOT">Slot Pallet</option>
                  <option value="UNIT">Jumlah Unit</option>
                  <option value="M3">Volume (m³)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Kapasitas Max</label>
                <input
                  type="number"
                  min={1}
                  value={rackMax}
                  onChange={(e) => setRackMax(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Tambah Rak
              </button>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-3 px-4">Kode</th>
                  <th className="py-3 px-4">Nama</th>
                  <th className="py-3 px-4">Zona</th>
                  <th className="py-3 px-4">Satuan</th>
                  <th className="py-3 px-4 text-right">Terpakai / Maks</th>
                  <th className="py-3 px-4 w-40">Utilisasi</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {racks.map((r) => {
                  const isEditing = editingRackId === r.id;
                  const liveUsed = isEditing ? editUsedCap : r.usedCapacity;
                  const liveMax = isEditing ? Math.max(1, editMaxCap) : r.maxCapacity;
                  const pct = computeRackPct(liveUsed, liveMax);
                  const liveStatus = computeStatusColor(liveUsed, liveMax, greenMax, yellowMax);
                  const tone = getCapacityTone(pct, liveStatus, greenMax, yellowMax);
                  const badgeStyle =
                    liveStatus === 'GREEN'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                      : liveStatus === 'YELLOW'
                      ? 'bg-amber-50 text-amber-800 border border-amber-200/80'
                      : 'bg-rose-50 text-rose-700 border border-rose-200/80';

                  return (
                    <tr key={r.id}>
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">{r.code}</td>
                      <td className="py-2.5 px-4 text-slate-700">{r.name}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-600">
                        {zones.find((z) => z.id === r.zoneId)?.code || r.zoneId}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-600">
                        {r.unitType === 'UNIT' ? 'kg / UNIT' : r.unitType}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1 justify-end">
                            <input
                              type="number"
                              min={0}
                              value={editUsedCap}
                              onChange={(e) => setEditUsedCap(Number(e.target.value))}
                              className="w-20 px-2 py-1 text-right text-xs font-mono border border-slate-300 rounded"
                            />
                            <span className="text-slate-400">/</span>
                            <input
                              type="number"
                              min={1}
                              value={editMaxCap}
                              onChange={(e) => setEditMaxCap(Number(e.target.value))}
                              className="w-20 px-2 py-1 text-right text-xs font-mono border border-slate-300 rounded"
                            />
                          </div>
                        ) : (
                          `${r.usedCapacity} / ${r.maxCapacity}`
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-200"
                              style={{ width: `${pct}%`, backgroundColor: tone.hexMain }}
                            />
                          </div>
                          <span className="font-mono font-semibold text-slate-700 w-9 text-right tabular-nums">
                            {pct}%
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${badgeStyle}`}
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: tone.hexMain }}
                          />
                          {tone.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {canEdit &&
                          (isEditing ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void handleSaveRackCapacity(r)}
                                className="p-1 text-emerald-600 hover:bg-emerald-50 rounded cursor-pointer"
                                title="Simpan kapasitas"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingRackId(null)}
                                className="p-1 text-slate-400 hover:bg-slate-100 rounded cursor-pointer"
                                title="Batal"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRackId(r.id);
                                  setEditUsedCap(r.usedCapacity);
                                  setEditMaxCap(r.maxCapacity);
                                }}
                                className="p-1 text-slate-400 hover:text-[#1D63ED] cursor-pointer"
                                title="Ubah kapasitas rak"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDelete('racks', r.id, r.code)}
                                className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                                title="Hapus rak"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* GATES */}
      {tab === 'GATES' && (
        <div className="space-y-4">
          {canEdit && (
            <form
              onSubmit={handleCreateGate}
              className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-6 gap-3 items-end"
            >
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Kode Gate</label>
                <input
                  value={gateCode}
                  onChange={(e) => setGateCode(e.target.value)}
                  placeholder="GATE-D"
                  required
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Gate</label>
                <input
                  value={gateName}
                  onChange={(e) => setGateName(e.target.value)}
                  placeholder="Gate D Cross-Dock"
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Zona</label>
                <select
                  value={gateZoneId || zones[0]?.id || ''}
                  onChange={(e) => setGateZoneId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.code}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipe</label>
                <select
                  value={gateType}
                  onChange={(e) => setGateType(e.target.value as GateType)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="INBOUND">INBOUND</option>
                  <option value="OUTBOUND">OUTBOUND</option>
                  <option value="BIDIRECTIONAL">BIDIRECTIONAL</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Debounce (detik)</label>
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={gateDebounce}
                  onChange={(e) => setGateDebounce(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Tambah Gate
              </button>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-3 px-4">Kode</th>
                  <th className="py-3 px-4">Nama Gate</th>
                  <th className="py-3 px-4">Zona</th>
                  <th className="py-3 px-4">Tipe</th>
                  <th className="py-3 px-4 text-right">Debounce</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gates.map((g) => (
                  <tr key={g.id}>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">{g.code}</td>
                    <td className="py-2.5 px-4 text-slate-700">{g.name}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">
                      {zones.find((z) => z.id === g.zoneId)?.code || g.zoneId}
                    </td>
                    <td className="py-2.5 px-4 font-mono">{g.gateType}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{g.debounceWindowSec}s</td>
                    <td className="py-2.5 px-4 text-right">
                      {canEdit && (
                        <button
                          onClick={() => void handleDelete('gates', g.id, g.code)}
                          className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ZONES */}
      {tab === 'ZONES' && (
        <div className="space-y-4">
          {canEdit && (
            <form
              onSubmit={handleCreateZone}
              className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
            >
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Kode Zona</label>
                <input
                  value={zoneCode}
                  onChange={(e) => setZoneCode(e.target.value)}
                  placeholder="ZONE-HAZ"
                  required
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Zona</label>
                <input
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  placeholder="Zona D · Bahan Khusus"
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Tambah Zona
              </button>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-3 px-4">Kode</th>
                  <th className="py-3 px-4">Nama Zona</th>
                  <th className="py-3 px-4">Deskripsi</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {zones.map((z) => (
                  <tr key={z.id}>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">{z.code}</td>
                    <td className="py-2.5 px-4 text-slate-800">{z.name}</td>
                    <td className="py-2.5 px-4 text-slate-500">{z.description || '-'}</td>
                    <td className="py-2.5 px-4 text-right">
                      {canEdit && (
                        <button
                          onClick={() => void handleDelete('zones', z.id, z.code)}
                          className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ITEMS / SKU */}
      {tab === 'ITEMS' && (
        <div className="space-y-4">
          {canEdit && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
              <form
                onSubmit={handleCreateItem}
                className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end"
              >
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">SKU</label>
                  <input
                    value={itemSku}
                    onChange={(e) => setItemSku(e.target.value)}
                    placeholder="SKU-NEW-021"
                    required
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nama Barang</label>
                  <input
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="Industrial Barcode Printer"
                    required
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Kategori</label>
                  <input
                    value={itemCat}
                    onChange={(e) => setItemCat(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Rak Default</label>
                  <select
                    value={itemDefRack}
                    onChange={(e) => setItemDefRack(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Otomatis</option>
                    {racks.map((r) => (
                      <option key={r.id} value={r.id}>{r.code}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah SKU
                </button>
              </form>

              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-500">
                  Import CSV massal format: <code className="font-mono text-slate-700">sku,name,category,unitLabel,unitVolumeM3</code>
                </span>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  Import CSV SKU
                  <input type="file" accept=".csv" onChange={handleImportItemsCsv} className="hidden" />
                </label>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-3 px-4">SKU</th>
                  <th className="py-3 px-4">Nama Barang</th>
                  <th className="py-3 px-4">Kategori</th>
                  <th className="py-3 px-4 text-right">Vol (m³)</th>
                  <th className="py-3 px-4">Rak Default</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">{it.sku}</td>
                    <td className="py-2.5 px-4 text-slate-800">{it.name}</td>
                    <td className="py-2.5 px-4 text-slate-600">{it.category}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{it.unitVolumeM3}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">
                      {racks.find((r) => r.id === it.defaultRackId)?.code || 'Auto'}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {canEdit && (
                        <button
                          onClick={() => void handleDelete('items', it.id, it.sku)}
                          className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAG MAPPING */}
      {tab === 'TAGS' && (
        <div className="space-y-4">
          {canEdit && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
              <form
                onSubmit={handleCreateTag}
                className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
              >
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">RFID EPC / Barcode</label>
                  <input
                    value={tagCode}
                    onChange={(e) => setTagCode(e.target.value)}
                    placeholder="E28011606000..."
                    required
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipe Tag</label>
                  <select
                    value={tagType}
                    onChange={(e) => setTagType(e.target.value as TagType)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="RFID">RFID</option>
                    <option value="BARCODE">BARCODE</option>
                    <option value="QR">QR</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Mapping ke SKU</label>
                  <select
                    value={tagItemId || items[0]?.id || ''}
                    onChange={(e) => setTagItemId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Simpan Mapping
                </button>
              </form>

              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-500">
                  Import CSV format: <code className="font-mono text-slate-700">tagOrCode,tagType,sku</code>
                </span>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  Import CSV Tag
                  <input type="file" accept=".csv" onChange={handleImportTagsCsv} className="hidden" />
                </label>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-3 px-4">Tag / Kode</th>
                  <th className="py-3 px-4">Tipe</th>
                  <th className="py-3 px-4">SKU Terkait</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itemTags.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">{t.tagOrCode}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">{t.tagType}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-800">{t.sku}</td>
                    <td className="py-2.5 px-4 text-right">
                      {canEdit && (
                        <button
                          onClick={() => void handleDelete('item_tags', t.id, t.tagOrCode)}
                          className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* WAREHOUSE */}
      {tab === 'WAREHOUSE' && warehouse && (
        <form
          onSubmit={handleUpdateWarehouse}
          className="bg-white border border-slate-200 rounded-xl p-6 max-w-xl space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Kode Warehouse</label>
            <input
              value={warehouse.code}
              disabled
              className="w-full px-3 py-2 text-xs font-mono bg-slate-100 border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nama Gudang</label>
            <input
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              disabled={role !== 'ADMIN'}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Lokasi</label>
            <input
              value={whLoc}
              onChange={(e) => setWhLoc(e.target.value)}
              disabled={role !== 'ADMIN'}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          {role === 'ADMIN' && (
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              Simpan Profil Warehouse
            </button>
          )}
        </form>
      )}
    </div>
  );
};
