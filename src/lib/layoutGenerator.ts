import {
  doc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase.ts';
import { computeStatusColor } from './capacityEngine.ts';
import type {
  GateDoc,
  RackDoc,
  RackUnitType,
  SettingDoc,
  WarehouseDoc,
  ZoneDoc,
} from '../shared/types.ts';

export interface LayoutConfigInput {
  areaCount: number;
  racksPerArea: number;
  aislesPerArea: number;
  defaultRackCapacity: number;
  defaultRackUnit: RackUnitType;
  populateSampleFill: boolean;
  areaNames?: string[];
}

export async function applyWarehouseLayoutToFirestore(params: {
  config: LayoutConfigInput;
  currentUid: string;
  warehouse: WarehouseDoc;
  existingZones: ZoneDoc[];
  existingRacks: RackDoc[];
  existingGates: GateDoc[];
  settings: SettingDoc | null;
}) {
  const {
    config,
    currentUid,
    warehouse,
    existingZones,
    existingRacks,
    existingGates,
    settings,
  } = params;

  const greenMax = settings?.greenMaxPct ?? 69;
  const yellowMax = settings?.yellowMaxPct ?? 94;
  const memberUids = warehouse.memberUids.includes(currentUid)
    ? warehouse.memberUids
    : [...warehouse.memberUids.slice(0, 24), currentUid];

  // 1. Delete existing racks & zones in chunked batches (max 15 ops)
  const deleteOps: Array<{ col: string; id: string }> = [
    ...existingRacks.map((r) => ({ col: 'racks', id: r.id })),
    ...existingZones.map((z) => ({ col: 'zones', id: z.id })),
  ];
  for (let i = 0; i < deleteOps.length; i += 75) {
    const wave = deleteOps.slice(i, i + 75);
    const chunks: Array<typeof deleteOps> = [];
    for (let j = 0; j < wave.length; j += 15) {
      chunks.push(wave.slice(j, j + 15));
    }
    await Promise.all(
      chunks.map(async (chunk) => {
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.delete(doc(db, item.col, item.id));
        }
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `${chunk[0].col}/${chunk[0].id}`);
        }
      })
    );
  }

  // 2. Build new Zones
  const newZones: Array<{ id: string; code: string; name: string; description: string }> = [];
  for (let a = 0; a < config.areaCount; a++) {
    const letter = String.fromCharCode(65 + a);
    const customName = config.areaNames?.[a]?.trim();
    newZones.push({
      id: `zone-area-${letter.toLowerCase()}`,
      code: `AREA-${letter}`,
      name: customName || `Area ${letter}`,
      description: `Zona penyimpanan ${customName || `Area ${letter}`} (${config.racksPerArea} rak)`,
    });
  }

  const metaBatch = writeBatch(db);
  for (const z of newZones) {
    metaBatch.set(doc(db, 'zones', z.id), {
      ...z,
      warehouseId: warehouse.id,
      ownerUid: warehouse.ownerUid,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  for (let gIdx = 0; gIdx < existingGates.length; gIdx++) {
    const gate = existingGates[gIdx];
    const targetZone = newZones[gIdx % newZones.length];
    metaBatch.update(doc(db, 'gates', gate.id), {
      zoneId: targetZone.id,
      updatedAt: serverTimestamp(),
    });
  }
  if (settings) {
    metaBatch.update(doc(db, 'settings', settings.id), {
      defaultAreaCount: config.areaCount,
      defaultRacksPerArea: config.racksPerArea,
      defaultAislesPerArea: config.aislesPerArea,
      defaultRackCapacity: config.defaultRackCapacity,
      defaultRackUnit: config.defaultRackUnit,
      updatedAt: serverTimestamp(),
    });
  }
  try {
    await metaBatch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'zones');
  }

  // 3. Build and commit new Racks in parallel waves of 15-op batches
  const rackWrites: Array<{ id: string; data: Record<string, unknown> }> = [];
  const aisles = Math.max(1, config.aislesPerArea);
  const rowsPerAisle = Math.max(1, Math.ceil(config.racksPerArea / aisles));

  for (let a = 0; a < newZones.length; a++) {
    const z = newZones[a];
    const letter = String.fromCharCode(65 + a);
    for (let r = 0; r < config.racksPerArea; r++) {
      const rackNum = String(r + 1).padStart(2, '0');
      const rackCode = `${letter}-${rackNum}`;
      const rackId = `rack-${letter.toLowerCase()}-${rackNum}`;
      const colIndex = Math.min(aisles - 1, Math.floor(r / rowsPerAisle));
      const rowIndex = r % rowsPerAisle;

      let used = 0;
      if (config.populateSampleFill) {
        const seedVal = (a * 17 + r * 7) % 20;
        if (rackCode === 'B-12') {
          used = Math.round(config.defaultRackCapacity * 0.8);
        } else if (seedVal === 3 || seedVal === 14) {
          used = Math.round(config.defaultRackCapacity * 0.95);
        } else if (seedVal === 6 || seedVal === 11 || seedVal === 18) {
          used = Math.round(config.defaultRackCapacity * 0.8);
        } else {
          used = Math.round(config.defaultRackCapacity * (0.25 + (seedVal % 5) * 0.08));
        }
      }

      const statusColor = computeStatusColor(
        used,
        config.defaultRackCapacity,
        greenMax,
        yellowMax
      );

      rackWrites.push({
        id: rackId,
        data: {
          id: rackId,
          warehouseId: warehouse.id,
          zoneId: z.id,
          code: rackCode,
          name: `Rak ${rackCode} (${z.name})`,
          unitType: config.defaultRackUnit,
          maxCapacity: config.defaultRackCapacity,
          usedCapacity: used,
          statusColor,
          rowIndex,
          colIndex,
          ownerUid: warehouse.ownerUid,
          memberUids,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
    }
  }

  for (let i = 0; i < rackWrites.length; i += 75) {
    const wave = rackWrites.slice(i, i + 75);
    const chunks: Array<typeof rackWrites> = [];
    for (let j = 0; j < wave.length; j += 15) {
      chunks.push(wave.slice(j, j + 15));
    }
    await Promise.all(
      chunks.map(async (chunk) => {
        const batch = writeBatch(db);
        for (const rw of chunk) {
          batch.set(doc(db, 'racks', rw.id), rw.data);
        }
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `racks/${chunk[0].id}`);
        }
      })
    );
  }
}
