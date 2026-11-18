import {
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase.ts';
import type {
  AlertDoc,
  GateDoc,
  ItemDoc,
  ItemTagDoc,
  NormalizedGateEvent,
  PlacementStatus,
  RackDoc,
  RackStockDoc,
  SettingDoc,
  StatusColor,
} from '../shared/types.ts';

export function computeRackPct(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

export function computeStatusColor(
  used: number,
  max: number,
  greenMaxPct = 69,
  yellowMaxPct = 90
): StatusColor {
  const pct = max > 0 ? (used / max) * 100 : 0;
  if (pct <= greenMaxPct) return 'GREEN';
  if (pct <= yellowMaxPct) return 'YELLOW';
  return 'RED';
}

export type EffectiveStatusColor = StatusColor | 'OFFLINE';

export interface CapacityTone {
  status: EffectiveStatusColor;
  label: string;
  tier:
    | 'GREEN_LOW'
    | 'GREEN_MID'
    | 'GREEN_HIGH'
    | 'YELLOW_LOW'
    | 'YELLOW_HIGH'
    | 'RED_HIGH'
    | 'RED_CRITICAL'
    | 'OFFLINE';
  hexLight: string;
  hexMain: string;
  hexDark: string;
  hexLip: string;
  textDark: boolean;
}

export function getCapacityTone(
  pct: number,
  status: EffectiveStatusColor,
  greenMaxPct = 69,
  yellowMaxPct = 90
): CapacityTone {
  if (status === 'OFFLINE') {
    return {
      status: 'OFFLINE',
      label: 'Offline',
      tier: 'OFFLINE',
      hexLight: '#cbd5e1',
      hexMain: '#94a3b8',
      hexDark: '#64748b',
      hexLip: '#334155',
      textDark: false,
    };
  }

  if (status === 'GREEN') {
    const lowCut = Math.max(15, Math.round(greenMaxPct * 0.42));
    const midCut = Math.max(lowCut + 10, Math.round(greenMaxPct * 0.72));
    if (pct <= lowCut) {
      return {
        status: 'GREEN',
        label: 'Normal',
        tier: 'GREEN_LOW',
        hexLight: '#86efac',
        hexMain: '#4ade80',
        hexDark: '#22c55e',
        hexLip: '#15803d',
        textDark: true,
      };
    }
    if (pct <= midCut) {
      return {
        status: 'GREEN',
        label: 'Normal',
        tier: 'GREEN_MID',
        hexLight: '#4ade80',
        hexMain: '#22c55e',
        hexDark: '#16a34a',
        hexLip: '#166534',
        textDark: false,
      };
    }
    return {
      status: 'GREEN',
      label: 'Normal',
      tier: 'GREEN_HIGH',
      hexLight: '#22c55e',
      hexMain: '#16a34a',
      hexDark: '#15803d',
      hexLip: '#14532d',
      textDark: false,
    };
  }

  if (status === 'YELLOW') {
    const midYellow = (greenMaxPct + yellowMaxPct) / 2;
    if (pct <= midYellow) {
      return {
        status: 'YELLOW',
        label: 'Hampir Penuh',
        tier: 'YELLOW_LOW',
        hexLight: '#fde047',
        hexMain: '#facc15',
        hexDark: '#eab308',
        hexLip: '#a16207',
        textDark: true,
      };
    }
    return {
      status: 'YELLOW',
      label: 'Hampir Penuh',
      tier: 'YELLOW_HIGH',
      hexLight: '#fbbf24',
      hexMain: '#f97316',
      hexDark: '#ea580c',
      hexLip: '#9a3412',
      textDark: false,
    };
  }

  const midRed = yellowMaxPct + (100 - yellowMaxPct) * 0.5;
  if (pct <= midRed) {
    return {
      status: 'RED',
      label: 'Perlu Perhatian',
      tier: 'RED_HIGH',
      hexLight: '#fb7185',
      hexMain: '#ef4444',
      hexDark: '#dc2626',
      hexLip: '#991b1b',
      textDark: false,
    };
  }

  return {
    status: 'RED',
    label: 'Perlu Perhatian',
    tier: 'RED_CRITICAL',
    hexLight: '#ef4444',
    hexMain: '#dc2626',
    hexDark: '#b91c1c',
    hexLip: '#7f1d1d',
    textDark: false,
  };
}

export interface ProcessEventContext {
  currentUid: string;
  warehouseId: string;
  memberUids: string[];
  ownerUid: string;
  gates: GateDoc[];
  racks: RackDoc[];
  items: ItemDoc[];
  itemTags: ItemTagDoc[];
  rackStocks: RackStockDoc[];
  settings: SettingDoc | null;
}

export interface ProcessEventOutcome {
  ok: boolean;
  movementId: string;
  placementStatus: PlacementStatus;
  rackCode?: string;
  sku?: string;
  newStatusColor?: StatusColor;
  previousStatusColor?: StatusColor;
  alertMessage?: string;
  alertSeverity?: 'INFO' | 'WARNING' | 'CRITICAL';
}

function makeSafeId(prefix: string, raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
  return `${prefix}_${cleaned}`;
}

export async function processNormalizedEventInFirestore(
  event: NormalizedGateEvent,
  ctx: ProcessEventContext
): Promise<ProcessEventOutcome> {
  const greenMax = ctx.settings?.greenMaxPct ?? 69;
  const yellowMax = ctx.settings?.yellowMaxPct ?? 90;
  const allowOverCapacity = ctx.settings?.allowOverCapacity ?? false;

  // 1. Resolve Gate
  const gate =
    ctx.gates.find((g) => g.id === event.gate_id || g.code === event.gate_id) ||
    ctx.gates[0];
  if (!gate) {
    throw new Error(`Gate ${event.gate_id} not found in warehouse.`);
  }

  // 2. Resolve Item via ItemTag or SKU
  const matchedTag = ctx.itemTags.find(
    (t) => t.tagOrCode.toUpperCase() === event.tag_or_code.toUpperCase()
  );
  const item = matchedTag
    ? ctx.items.find((i) => i.id === matchedTag.itemId)
    : ctx.items.find((i) => i.sku.toUpperCase() === event.tag_or_code.toUpperCase());

  // 3. Resolve Target Rack according to Section 4 Placement Rules
  let targetRack: RackDoc | undefined;
  if (event.rack_id) {
    targetRack = ctx.racks.find((r) => r.id === event.rack_id || r.code === event.rack_id);
  }

  if (!targetRack && event.direction === 'IN') {
    // Rule (a): Default rack for the SKU
    if (item?.defaultRackId) {
      const defRack = ctx.racks.find((r) => r.id === item.defaultRackId);
      if (defRack) {
        const delta =
          defRack.unitType === 'M3' ? event.quantity * (item.unitVolumeM3 || 1) : event.quantity;
        if (allowOverCapacity || defRack.usedCapacity + delta <= defRack.maxCapacity) {
          targetRack = defRack;
        }
      }
    }
    // Rule (b): First GREEN rack in the gate's zone
    if (!targetRack) {
      const zoneGreenRacks = ctx.racks
        .filter((r) => r.zoneId === gate.zoneId && r.statusColor === 'GREEN')
        .sort((a, b) => a.code.localeCompare(b.code));
      for (const candidate of zoneGreenRacks) {
        const delta =
          candidate.unitType === 'M3'
            ? event.quantity * (item?.unitVolumeM3 || 1)
            : event.quantity;
        if (allowOverCapacity || candidate.usedCapacity + delta <= candidate.maxCapacity) {
          targetRack = candidate;
          break;
        }
      }
    }
  } else if (!targetRack && event.direction === 'OUT') {
    if (item) {
      const stockWithQty = ctx.rackStocks.find((rs) => rs.itemId === item.id && rs.quantity > 0);
      if (stockWithQty) {
        targetRack = ctx.racks.find((r) => r.id === stockWithQty.rackId);
      }
      if (!targetRack && item.defaultRackId) {
        targetRack = ctx.racks.find((r) => r.id === item.defaultRackId);
      }
    }
    if (!targetRack) {
      targetRack = ctx.racks.find((r) => r.zoneId === gate.zoneId && r.usedCapacity > 0);
    }
  }

  const movementId = makeSafeId('mov', event.event_id);
  const memberUids = ctx.memberUids.includes(ctx.currentUid)
    ? ctx.memberUids
    : [...ctx.memberUids.slice(0, 24), ctx.currentUid];

  // Case: Unassigned (no suitable green/default rack available)
  if (!targetRack) {
    const movRef = doc(db, 'movements', movementId);
    const alertId = makeSafeId('alt', `${event.event_id}_unassigned`);
    const alertRef = doc(db, 'alerts', alertId);

    try {
      await setDoc(movRef, {
        id: movementId,
        eventId: event.event_id,
        payloadHash: event.payload_hash,
        warehouseId: ctx.warehouseId,
        gateId: gate.id,
        gateCode: gate.code,
        direction: event.direction,
        itemId: item?.id || '',
        sku: item?.sku || event.tag_or_code,
        itemName: item?.name || 'Unmapped Tag / SKU',
        quantity: event.quantity,
        source: event.source,
        deviceId: event.device_id,
        rackId: '',
        rackCode: 'UNASSIGNED',
        placementStatus: 'UNASSIGNED',
        tagOrCode: event.tag_or_code,
        rawPayload: event.raw_payload,
        eventTimestamp: event.timestamp,
        createdByUid: ctx.currentUid,
        ownerUid: ctx.ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
      });

      await setDoc(alertRef, {
        id: alertId,
        warehouseId: ctx.warehouseId,
        rackId: '',
        rackCode: 'UNASSIGNED',
        severity: 'WARNING',
        type: 'UNASSIGNED_RACK',
        message: `Event ${event.direction} (${item?.sku || event.tag_or_code} x${event.quantity}) di ${gate.code} tidak mendapat rak hijau dan dicatat UNASSIGNED.`,
        acknowledged: false,
        ownerUid: ctx.ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `movements/${movementId}`);
    }

    return {
      ok: true,
      movementId,
      placementStatus: 'UNASSIGNED',
      rackCode: 'UNASSIGNED',
      sku: item?.sku || event.tag_or_code,
      alertSeverity: 'WARNING',
      alertMessage: `Tidak ada rak tersedia di zona ${gate.code}; tercatat sebagai UNASSIGNED.`,
    };
  }

  // Compute capacity delta respecting rack unitType
  const capacityDelta =
    targetRack.unitType === 'M3'
      ? Number((event.quantity * (item?.unitVolumeM3 || 1)).toFixed(2))
      : event.quantity;

  let outcome: ProcessEventOutcome = {
    ok: true,
    movementId,
    placementStatus: 'ASSIGNED',
    rackCode: targetRack.code,
    sku: item?.sku || event.tag_or_code,
  };

  try {
    await runTransaction(db, async (tx) => {
      const rackRef = doc(db, 'racks', targetRack.id);
      const rackSnap = await tx.get(rackRef);
      if (!rackSnap.exists()) {
        throw new Error(`Rack ${targetRack.code} missing in Firestore.`);
      }
      const liveRack = rackSnap.data() as RackDoc;
      const prevColor = liveRack.statusColor;

      let stockSnapData: RackStockDoc | null = null;
      const stockId = item ? makeSafeId('stk', `${liveRack.id}_${item.id}`) : null;
      const stockRef = stockId ? doc(db, 'rack_stock', stockId) : null;
      if (stockRef) {
        const sSnap = await tx.get(stockRef);
        if (sSnap.exists()) {
          stockSnapData = sSnap.data() as RackStockDoc;
        }
      }

      if (event.direction === 'IN' && !allowOverCapacity && liveRack.usedCapacity + capacityDelta > liveRack.maxCapacity) {
        // Reject over-capacity event and log alert
        const movRef = doc(db, 'movements', movementId);
        tx.set(movRef, {
          id: movementId,
          eventId: event.event_id,
          payloadHash: event.payload_hash,
          warehouseId: ctx.warehouseId,
          gateId: gate.id,
          gateCode: gate.code,
          direction: event.direction,
          itemId: item?.id || '',
          sku: item?.sku || event.tag_or_code,
          itemName: item?.name || 'Unmapped Tag / SKU',
          quantity: event.quantity,
          source: event.source,
          deviceId: event.device_id,
          rackId: liveRack.id,
          rackCode: liveRack.code,
          placementStatus: 'OVER_CAPACITY_REJECTED',
          tagOrCode: event.tag_or_code,
          rawPayload: event.raw_payload,
          eventTimestamp: event.timestamp,
          createdByUid: ctx.currentUid,
          ownerUid: ctx.ownerUid,
          memberUids,
          createdAt: serverTimestamp(),
        });

        const alertId = makeSafeId('alt', `${event.event_id}_overcap`);
        tx.set(doc(db, 'alerts', alertId), {
          id: alertId,
          warehouseId: ctx.warehouseId,
          rackId: liveRack.id,
          rackCode: liveRack.code,
          severity: 'CRITICAL',
          type: 'OVER_CAPACITY',
          message: `Event IN ke ${liveRack.code} ditolak: ${liveRack.usedCapacity + capacityDelta} melebihi batas maksimum ${liveRack.maxCapacity}.`,
          acknowledged: false,
          ownerUid: ctx.ownerUid,
          memberUids,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        outcome = {
          ok: false,
          movementId,
          placementStatus: 'OVER_CAPACITY_REJECTED',
          rackCode: liveRack.code,
          sku: item?.sku || event.tag_or_code,
          previousStatusColor: prevColor,
          newStatusColor: prevColor,
          alertSeverity: 'CRITICAL',
          alertMessage: `Ditolak: Rak ${liveRack.code} akan melebihi kapasitas (${liveRack.usedCapacity + capacityDelta}/${liveRack.maxCapacity}).`,
        };
        return;
      }

      const newUsed =
        event.direction === 'IN'
          ? Number((liveRack.usedCapacity + capacityDelta).toFixed(2))
          : Number(Math.max(0, liveRack.usedCapacity - capacityDelta).toFixed(2));

      const newColor = computeStatusColor(newUsed, liveRack.maxCapacity, greenMax, yellowMax);

      tx.update(rackRef, {
        usedCapacity: newUsed,
        statusColor: newColor,
        updatedAt: serverTimestamp(),
      });

      if (stockRef && item) {
        const currentQty = stockSnapData?.quantity ?? 0;
        const nextQty =
          event.direction === 'IN'
            ? currentQty + event.quantity
            : Math.max(0, currentQty - event.quantity);

        if (stockSnapData) {
          tx.update(stockRef, {
            quantity: nextQty,
            itemName: item.name,
            sku: item.sku,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(stockRef, {
            id: stockId!,
            warehouseId: ctx.warehouseId,
            rackId: liveRack.id,
            itemId: item.id,
            sku: item.sku,
            itemName: item.name,
            quantity: nextQty,
            ownerUid: ctx.ownerUid,
            memberUids,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      tx.set(doc(db, 'movements', movementId), {
        id: movementId,
        eventId: event.event_id,
        payloadHash: event.payload_hash,
        warehouseId: ctx.warehouseId,
        gateId: gate.id,
        gateCode: gate.code,
        direction: event.direction,
        itemId: item?.id || '',
        sku: item?.sku || event.tag_or_code,
        itemName: item?.name || 'Unmapped Tag / SKU',
        quantity: event.quantity,
        source: event.source,
        deviceId: event.device_id,
        rackId: liveRack.id,
        rackCode: liveRack.code,
        placementStatus: 'ASSIGNED',
        tagOrCode: event.tag_or_code,
        rawPayload: event.raw_payload,
        eventTimestamp: event.timestamp,
        createdByUid: ctx.currentUid,
        ownerUid: ctx.ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
      });

      let alertMsg: string | undefined;
      let alertSev: 'WARNING' | 'CRITICAL' | undefined;

      if (newColor !== prevColor && (newColor === 'YELLOW' || newColor === 'RED')) {
        const pct = computeRackPct(newUsed, liveRack.maxCapacity);
        const alertId = makeSafeId('alt', `${event.event_id}_${newColor}`);
        const alertType: AlertDoc['type'] =
          newColor === 'RED' ? 'THRESHOLD_RED' : 'THRESHOLD_YELLOW';
        alertSev = newColor === 'RED' ? 'CRITICAL' : 'WARNING';
        alertMsg =
          newColor === 'RED'
            ? `Rak ${liveRack.code} mencapai status MERAH (${pct}% terisi: ${newUsed}/${liveRack.maxCapacity}).`
            : `Rak ${liveRack.code} memasuki status KUNING (${pct}% terisi: ${newUsed}/${liveRack.maxCapacity}).`;

        tx.set(doc(db, 'alerts', alertId), {
          id: alertId,
          warehouseId: ctx.warehouseId,
          rackId: liveRack.id,
          rackCode: liveRack.code,
          severity: alertSev,
          type: alertType,
          message: alertMsg,
          acknowledged: false,
          ownerUid: ctx.ownerUid,
          memberUids,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      outcome = {
        ok: true,
        movementId,
        placementStatus: 'ASSIGNED',
        rackCode: liveRack.code,
        sku: item?.sku || event.tag_or_code,
        previousStatusColor: prevColor,
        newStatusColor: newColor,
        alertSeverity: alertSev,
        alertMessage: alertMsg,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `racks/${targetRack.id}`);
  }

  return outcome;
}
