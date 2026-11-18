import type { User } from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase.ts';
import type {
  AlertDoc,
  DeviceDoc,
  GateDoc,
  GateType,
  ItemDoc,
  ItemTagDoc,
  MovementDoc,
  RackDoc,
  RackStockDoc,
  SettingDoc,
  StatusColor,
  UserRole,
  ZoneDoc,
} from '../shared/types.ts';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'ahmadmagfur1218@gmail.com';

export async function ensureUserProfile(user: User): Promise<UserRole> {
  const userRef = doc(db, 'users', user.uid);
  const privRef = doc(db, 'users', user.uid, 'private', 'info');
  const isBootstrapped =
    user.emailVerified &&
    user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

  try {
    const snap = await getDoc(userRef);
    let role: UserRole = isBootstrapped ? 'ADMIN' : 'VIEWER';

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName: user.displayName || user.email?.split('@')[0] || 'Warehouse User',
        role,
        status: 'ACTIVE',
        warehouseId: 'wh-jkt-01',
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingRole = snap.data().role as UserRole | undefined;
      role = isBootstrapped ? 'ADMIN' : existingRole || 'VIEWER';
    }

    const privSnap = await getDoc(privRef);
    if (!privSnap.exists() && user.email) {
      await setDoc(privRef, {
        uid: user.uid,
        email: user.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    return role;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
  }
}

interface PendingWrite {
  col: string;
  id: string;
  data: Record<string, unknown>;
}

async function commitWritesChunked(writes: PendingWrite[], chunkSize = 15) {
  const batches: PendingWrite[][] = [];
  for (let i = 0; i < writes.length; i += chunkSize) {
    batches.push(writes.slice(i, i + chunkSize));
  }
  // Commit in parallel waves of 5 batches for fast seeding while respecting 20-lookup rule limit per batch
  for (let w = 0; w < batches.length; w += 5) {
    const wave = batches.slice(w, w + 5);
    await Promise.all(
      wave.map(async (chunk) => {
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, item.col, item.id), item.data);
        }
        try {
          await batch.commit();
        } catch (error) {
          const first = chunk[0];
          handleFirestoreError(error, OperationType.WRITE, `${first.col}/${first.id}`);
        }
      })
    );
  }
}

async function commitDeletesChunked(
  deletes: Array<{ col: string; id: string }>,
  chunkSize = 15
) {
  const batches: Array<Array<{ col: string; id: string }>> = [];
  for (let i = 0; i < deletes.length; i += chunkSize) {
    batches.push(deletes.slice(i, i + chunkSize));
  }
  for (let w = 0; w < batches.length; w += 5) {
    const wave = batches.slice(w, w + 5);
    await Promise.all(
      wave.map(async (chunk) => {
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.delete(doc(db, item.col, item.id));
        }
        try {
          await batch.commit();
        } catch (error) {
          const first = chunk[0];
          handleFirestoreError(error, OperationType.DELETE, `${first.col}/${first.id}`);
        }
      })
    );
  }
}

const FINISHED_GOODS_CATALOG: Array<{
  prefix: string;
  category: string;
  unitLabel: string;
  unitVolumeM3: number;
  names: string[];
}> = [
  {
    prefix: 'ELC',
    category: 'Elektronik Industri',
    unitLabel: 'KG',
    unitVolumeM3: 0.35,
    names: [
      'Industrial Servo Motor 2kW',
      'PLC Controller Module S7',
      'UHF RFID Antenna Panel',
      '24V DIN Rail Power Supply',
      'Inverter VFD 5.5kW 3-Phase',
      'HMI Touch Panel 10 Inch',
      'Stepper Drive Module 4A',
      'Industrial Ethernet Switch 8P',
      'Solid State Relay 40A',
      'Rotary Encoder 1024 PPR',
      'Smart Breaker MCCB 100A',
      'Surge Arrester Panel AC',
      'DC Brushless Spindle 1.5kW',
      'Panel Meter Digital 3P',
      'Optical Isolator Module',
      'Busbar Copper Distribution',
      'Contactor Magnetic 32A',
      'Thermocouple Transmitter',
      'Frequency Converter 7.5kW',
      'Photoelectric Beam Sensor',
      'Capacitive Proximity M18',
      'Laser Distance Gauge 30m',
      'Safety Light Curtain 800mm',
      'Terminal Block Kit 100pcs',
      'EMI Line Filter 30A',
      'Industrial UPS Battery 48V',
      'Modbus RTU Gateway Box',
    ],
  },
  {
    prefix: 'OTM',
    category: 'Komponen Otomotif',
    unitLabel: 'KG',
    unitVolumeM3: 0.55,
    names: [
      'Brake Caliper Assembly F1',
      'Alloy Wheel Hub Bearing',
      'Turbo Intercooler Core',
      'Aluminum Radiator 2-Ply',
      'Timing Belt Tensioner Kit',
      'Fuel Injector Rail Set',
      'Electronic Throttle Body',
      'Clutch Pressure Plate 240mm',
      'Steering Rack Housing',
      'ABS Wheel Speed Sensor',
      'Shock Absorber Gas Twin',
      'Drive Shaft CV Joint',
      'Alternator 12V 130A',
      'Starter Motor Heavy Duty',
      'Exhaust Manifold Gasket',
      'Oil Cooler Plate Assembly',
      'Flywheel Dual Mass Steel',
      'Control Arm Forged Lower',
      'Camshaft Position Actuator',
      'Brake Master Cylinder',
      'Power Steering Pump Unit',
      'Ignition Coil Pack V6',
      'Catalytic Converter Core',
      'Air Intake Plenum Molded',
      'Thermostat Housing Alloy',
      'Hydraulic Brake Hose Set',
      'Piston Ring Set Forged',
    ],
  },
  {
    prefix: 'PKG',
    category: 'Kemasan Barang Jadi',
    unitLabel: 'KG',
    unitVolumeM3: 0.85,
    names: [
      'Corrugated Carton Box 60x40',
      'Heavy Duty Strapping Band',
      'Euro Pallet Shrink Wrap',
      'Export Master Carton Double',
      'Vacuum Barrier Pouch Roll',
      'Anti-Static Bubble Bag',
      'Kraft Paper Corner Board',
      'Thermal Label Roll 100x150',
      'High-Barrier Foil Sack 25kg',
      'Tamper Evident Security Seal',
      'Polypropylene Woven Bag',
      'Foam Insert Die-Cut Tray',
      'HDPE Jerrycan 20L Natural',
      'PET Preform Bottle 500ml',
      'Aluminum Aerosol Can 250ml',
      'Corrugated Divider Grid',
      'Desiccant Silica Pack 50g',
      'Stretch Hood Film UV',
      'Steel Drum Lid Gasket',
      'Insulated EPS Shipping Box',
      'EPE Foam Edge Protector',
      'VCI Anti-Rust Wrap Roll',
      'Molded Pulp Protective Tray',
      'Laminated Standup Pouch',
      'BOPP Packing Tape 48mm',
      'Pallet Top Cap Sheet',
      'Cleanroom Poly Bag Sterile',
    ],
  },
  {
    prefix: 'MCH',
    category: 'Mesin & Mekanikal',
    unitLabel: 'KG',
    unitVolumeM3: 0.45,
    names: [
      'Ball Bearing SKF 6205-2RS',
      'Stainless Valve DN50',
      'Pneumatic Cylinder 100mm',
      'Helical Gearbox Ratio 1:20',
      'Linear Guide Rail HGR20',
      'Ballscrew Nut SFU1605',
      'Hydraulic Gear Pump 16cc',
      'Check Valve Brass 2 Inch',
      'Solenoid Valve 5/2 Way',
      'Coupling Jaw Flexible',
      'Pillow Block Bearing UCP208',
      'Roller Chain Duplex 16B',
      'Sprocket Hardened 24T',
      'Pressure Relief Valve 300Bar',
      'Rotary Union High Speed',
      'Air Filter Regulator FRL',
      'Worm Gear Reducer NMRV063',
      'Spindle Bearing Angular',
      'Cast Iron Pulley 3-Groove',
      'Taper Lock Bushing 2012',
      'Hydraulic Hose SAE 100R2',
      'Diaphragm Pump 1 Inch',
      'Butterfly Valve Wafer PN16',
      'Needle Roller Bearing NK30',
      'Precision Shaft Chrome 25mm',
      'Pneumatic Gripper Parallel',
      'Vibration Damper Mount',
    ],
  },
  {
    prefix: 'CHM',
    category: 'Kimia & Pelumas Jadi',
    unitLabel: 'KG',
    unitVolumeM3: 0.7,
    names: [
      'Hydraulic Oil ISO VG 46',
      'Synthetic Gear Grease 20L',
      'Cutting Fluid Semi-Synth',
      'Epoxy Coating Primer Part A',
      'Polyurethane Topcoat Clear',
      'Industrial Degreaser 25L',
      'Coolant Radiator Concentrate',
      'Rust Preventive Spray Bulk',
      'Silicone Mold Release Agent',
      'Transformer Insulating Oil',
      'Compressor Oil SAE 30',
      'Food Grade White Mineral Oil',
      'Hot Melt Adhesive Pellet',
      'Water Treatment Flocculant',
      'Isopropyl Alcohol 99.9% Drum',
      'Powder Coating Resin Matt',
      'Thermal Transfer Paste 5kg',
      'Anti-Seize Copper Compound',
      'Solvent Cleaner Low-VOC',
      'Acrylic Emulsion Binder',
      'Polyester Resin Unsaturated',
      'Lithium Complex Grease NLGI2',
      'Turbine Oil ISO VG 32',
      'Brake Fluid DOT 4 Drum',
      'Defoamer Silicone Industrial',
      'Flux Soldering No-Clean 20L',
    ],
  },
  {
    prefix: 'CLD',
    category: 'Produk Jadi Presisi & Cold',
    unitLabel: 'KG',
    unitVolumeM3: 0.65,
    names: [
      'Biologics Reagent Pack A',
      'Vaccine Thermal Tote 40L',
      'Dairy Concentrate 200L Vat',
      'Cryo Gel Pack Case',
      'Pharma Cold Gel Cartridge',
      'Sterile Saline Bag Batch',
      'Probiotic Culture Freeze',
      'Diagnostic Strip Box 500s',
      'Medical Vial Borosilicate',
      'Cleanroom HEPA Filter H14',
      'Infusion Pump Set Sterile',
      'Enzyme Blend Granule 25kg',
      'Whey Protein Isolate Sack',
      'Cocoa Butter Block 25kg',
      'Essential Oil Pure Drum',
      'Gelatin Capsule Empty Box',
      'Surgical Glove Nitrile Case',
      'PCR Reagent Cold Box',
      'Vitamin Premix Foil Bag',
      'Flavor Extract Concentrate',
      'UHT Cream Base Aseptic',
      'Maltodextrin Food Grade',
      'Collagen Peptide Powder',
      'Insulin Pen Carrier Tray',
      'Sterile Filter Membrane 0.22u',
      'Cold Chain Data Logger Pack',
    ],
  },
];

function buildFactorySkus(total = 160) {
  const result: Array<{
    id: string;
    sku: string;
    name: string;
    category: string;
    unitLabel: string;
    unitVolumeM3: number;
  }> = [];

  let counter = 0;
  let round = 0;
  while (result.length < total) {
    let addedInRound = false;
    for (const group of FINISHED_GOODS_CATALOG) {
      if (round < group.names.length && result.length < total) {
        counter++;
        const seq = String(counter).padStart(3, '0');
        result.push({
          id: `item-${seq}`,
          sku: `BRG-${group.prefix}-${seq}`,
          name: group.names[round],
          category: group.category,
          unitLabel: group.unitLabel,
          unitVolumeM3: group.unitVolumeM3,
        });
        addedInRound = true;
      }
    }
    if (!addedInRound) break;
    round++;
  }
  return result;
}

async function seedFactoryContent(params: {
  uid: string;
  ownerUid: string;
  whId: string;
  memberUids: string[];
}) {
  const { uid, ownerUid, whId, memberUids } = params;

  const stage1: PendingWrite[] = [];
  const stage2: PendingWrite[] = [];

  // 1. Settings: 5 Areas, 20 Racks/Area = 100 Racks, 1000 kg capacity per rack
  stage1.push({
    col: 'settings',
    id: 'set-wh-jkt-01',
    data: {
      id: 'set-wh-jkt-01',
      warehouseId: whId,
      greenMaxPct: 69,
      yellowMaxPct: 90,
      heartbeatTimeoutSec: 60,
      defaultDebounceSec: 5,
      allowOverCapacity: false,
      defaultAreaCount: 5,
      defaultRacksPerArea: 20,
      defaultAislesPerArea: 4,
      defaultRackCapacity: 1000,
      defaultRackUnit: 'UNIT',
      ownerUid,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  });

  // 2. 5 Zones (Area A .. Area E)
  const zones = [
    { id: 'zone-area-a', code: 'AREA-A', name: 'Area A', description: 'Produk Jadi Elektronik & Otomasi (20 Rak)' },
    { id: 'zone-area-b', code: 'AREA-B', name: 'Area B', description: 'Produk Jadi Komponen Otomotif & Fast-Moving (20 Rak)' },
    { id: 'zone-area-c', code: 'AREA-C', name: 'Area C', description: 'Produk Jadi Mesin & Kemasan Ekspor (20 Rak)' },
    { id: 'zone-area-d', code: 'AREA-D', name: 'Area D', description: 'Produk Jadi Pelumas & Kimia Industri (20 Rak)' },
    { id: 'zone-area-e', code: 'AREA-E', name: 'Area E', description: 'Produk Jadi Presisi & Cold-Chain (20 Rak)' },
  ];
  for (const z of zones) {
    stage1.push({
      col: 'zones',
      id: z.id,
      data: {
        ...z,
        warehouseId: whId,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }

  // 3. 5 Gates (1 per Area)
  const gates: Array<{
    id: string;
    zoneId: string;
    code: string;
    name: string;
    gateType: GateType;
    debounceWindowSec: number;
  }> = [
    { id: 'gate-a', zoneId: 'zone-area-a', code: 'GATE-A', name: 'Gate A · Receiving RFID', gateType: 'INBOUND', debounceWindowSec: 5 },
    { id: 'gate-b', zoneId: 'zone-area-b', code: 'GATE-B', name: 'Gate B · Loading Dock Outbound', gateType: 'OUTBOUND', debounceWindowSec: 5 },
    { id: 'gate-c', zoneId: 'zone-area-c', code: 'GATE-C', name: 'Gate C · Cross-Dock Proximity', gateType: 'BIDIRECTIONAL', debounceWindowSec: 5 },
    { id: 'gate-d', zoneId: 'zone-area-d', code: 'GATE-D', name: 'Gate D · Bulk Dispatch RFID', gateType: 'BIDIRECTIONAL', debounceWindowSec: 5 },
    { id: 'gate-e', zoneId: 'zone-area-e', code: 'GATE-E', name: 'Gate E · Precision Dispatch', gateType: 'BIDIRECTIONAL', debounceWindowSec: 5 },
  ];
  for (const g of gates) {
    stage1.push({
      col: 'gates',
      id: g.id,
      data: {
        ...g,
        warehouseId: whId,
        isActive: true,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }

  // 4. 100 Racks (5 Areas x 20 Racks, 4 aisles x 5 rows per area, 1000 kg maxCapacity)
  // Distribution across the 100 racks:
  //   - Last 3 racks of Area C (C-18, C-19, C-20) are monitored by offline sensor dev-rfid-c2 -> 3 Offline (3%)
  //   - Out of remaining 97 online racks:
  //     * 12 Yellow (12%), specifically including B-12 at 800/1000 (80%)
  //     * 7 Red (7%), >90%
  //     * 78 Green (78%), 22% - 66%
  const yellowCodes = new Set([
    'A-03', 'A-09', 'A-15',
    'B-04', 'B-12', 'B-19',
    'C-05', 'C-11',
    'D-02', 'D-14',
    'E-06', 'E-17',
  ]);
  const redCodes = new Set([
    'A-07', 'A-18',
    'B-08', 'B-16',
    'C-09',
    'D-12',
    'E-19',
  ]);
  const offlineTargetCodes = new Set(['C-18', 'C-19', 'C-20']);

  const rackList: Array<{
    id: string;
    zoneId: string;
    code: string;
    usedCapacity: number;
    statusColor: StatusColor;
  }> = [];

  for (let a = 0; a < zones.length; a++) {
    const z = zones[a];
    const letter = String.fromCharCode(65 + a);
    for (let r = 0; r < 20; r++) {
      const rackNum = String(r + 1).padStart(2, '0');
      const code = `${letter}-${rackNum}`;
      const id = `rack-${letter.toLowerCase()}-${rackNum}`;
      const colIndex = Math.floor(r / 5); // 4 vertical aisles (0..3), 5 racks per aisle
      const rowIndex = r % 5;

      let usedCapacity = 250 + ((a * 73 + r * 47) % 41) * 10; // 250..650 kg (Green)
      let statusColor: StatusColor = 'GREEN';

      if (code === 'B-12') {
        usedCapacity = 800;
        statusColor = 'YELLOW';
      } else if (yellowCodes.has(code)) {
        usedCapacity = 720 + ((a * 19 + r * 11) % 15) * 10; // 720..860 kg
        statusColor = 'YELLOW';
      } else if (redCodes.has(code)) {
        usedCapacity = 920 + ((a * 13 + r * 7) % 7) * 10; // 920..980 kg
        statusColor = 'RED';
      } else if (offlineTargetCodes.has(code)) {
        usedCapacity = 420 + r * 10;
        statusColor = 'GREEN';
      }

      rackList.push({ id, zoneId: z.id, code, usedCapacity, statusColor });
      stage1.push({
        col: 'racks',
        id,
        data: {
          id,
          warehouseId: whId,
          zoneId: z.id,
          code,
          name: `Rak ${code} (${z.name})`,
          unitType: 'UNIT',
          maxCapacity: 1000,
          usedCapacity,
          statusColor,
          rowIndex,
          colIndex,
          ownerUid,
          memberUids,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
    }
  }

  await commitWritesChunked(stage1, 15);

  // 5. 160 Finished-Goods SKUs + 320 RFID/Barcode Tags + Distributed Rack Stock (45 varieties inside B-12!)
  const skuCatalog = buildFactorySkus(160);
  const b12Rack = rackList.find((r) => r.code === 'B-12')!;
  const otherRacks = rackList.filter((r) => r.code !== 'B-12');

  for (let i = 0; i < skuCatalog.length; i++) {
    const item = skuCatalog[i];
    const assignedRack = i < 45 ? b12Rack : otherRacks[(i - 45) % otherRacks.length];

    stage2.push({
      col: 'items',
      id: item.id,
      data: {
        id: item.id,
        warehouseId: whId,
        sku: item.sku,
        name: item.name,
        category: item.category,
        unitLabel: item.unitLabel,
        unitVolumeM3: item.unitVolumeM3,
        defaultRackId: assignedRack.id,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });

    const epc = `E2801160600002054C2A${String(1000 + i)}`;
    const rfidTagId = `tag-rfid-${String(i + 1).padStart(3, '0')}`;
    stage2.push({
      col: 'item_tags',
      id: rfidTagId,
      data: {
        id: rfidTagId,
        warehouseId: whId,
        tagOrCode: epc,
        tagType: 'RFID',
        itemId: item.id,
        sku: item.sku,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });

    const barcode = `89910020${String(1000 + i)}`;
    const barTagId = `tag-bar-${String(i + 1).padStart(3, '0')}`;
    stage2.push({
      col: 'item_tags',
      id: barTagId,
      data: {
        id: barTagId,
        warehouseId: whId,
        tagOrCode: barcode,
        tagType: 'BARCODE',
        itemId: item.id,
        sku: item.sku,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });

    // Give B-12 exactly 45 finished-goods varieties summing to 800 kg (40 * 18kg + 5 * 16kg = 800kg)
    const qty = i < 45 ? (i < 40 ? 18 : 16) : 120 + (i % 6) * 25;
    const stockId = `stk_${assignedRack.id}_${item.id}`;
    stage2.push({
      col: 'rack_stock',
      id: stockId,
      data: {
        id: stockId,
        warehouseId: whId,
        rackId: assignedRack.id,
        itemId: item.id,
        sku: item.sku,
        itemName: item.name,
        quantity: qty,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }

  // 6. 6 IoT Devices (5 Online for Gate A..E + 1 Offline sensor in Area C covering 3 racks)
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - 240 * 1000).toISOString();
  const devices = [
    {
      id: 'dev-rfid-a1',
      gateId: 'gate-a',
      deviceCode: 'RFID-GATE-A-01',
      name: 'UHF RFID Portal Gate A',
      sourceType: 'RFID' as const,
      apiKeyPreview: 'wh-rfid-...01',
      mqttTopic: 'warehouse/WH-JKT-01/gate/GATE-A/event',
      status: 'ONLINE' as const,
      lastHeartbeatIso: nowIso,
      firmwareVersion: 'v2.4.1',
    },
    {
      id: 'dev-bar-b1',
      gateId: 'gate-b',
      deviceCode: 'BARCODE-GATE-B-01',
      name: 'Zebra Fixed Barcode Gate B',
      sourceType: 'BARCODE' as const,
      apiKeyPreview: 'wh-barc-...02',
      mqttTopic: 'warehouse/WH-JKT-01/gate/GATE-B/event',
      status: 'ONLINE' as const,
      lastHeartbeatIso: nowIso,
      firmwareVersion: 'v1.9.0',
    },
    {
      id: 'dev-prox-c1',
      gateId: 'gate-c',
      deviceCode: 'PROX-GATE-C-01',
      name: 'ESP32 Dual-IR Proximity Gate C',
      sourceType: 'PROXIMITY' as const,
      apiKeyPreview: 'wh-prox-...03',
      mqttTopic: 'warehouse/WH-JKT-01/gate/GATE-C/event',
      status: 'ONLINE' as const,
      lastHeartbeatIso: nowIso,
      firmwareVersion: 'v3.1.0',
    },
    {
      id: 'dev-rfid-c2',
      gateId: 'gate-c',
      deviceCode: 'RFID-GATE-C-02',
      name: 'PN532 Secondary Gate C Reader (3 Rak)',
      sourceType: 'RFID' as const,
      apiKeyPreview: 'wh-rfid-...04',
      mqttTopic: 'warehouse/WH-JKT-01/gate/GATE-C/event',
      status: 'OFFLINE' as const,
      lastHeartbeatIso: staleIso,
      firmwareVersion: 'v2.0.5',
    },
    {
      id: 'dev-rfid-d1',
      gateId: 'gate-d',
      deviceCode: 'RFID-GATE-D-01',
      name: 'UHF RFID Portal Gate D',
      sourceType: 'RFID' as const,
      apiKeyPreview: 'wh-rfid-...05',
      mqttTopic: 'warehouse/WH-JKT-01/gate/GATE-D/event',
      status: 'ONLINE' as const,
      lastHeartbeatIso: nowIso,
      firmwareVersion: 'v2.4.1',
    },
    {
      id: 'dev-prox-e1',
      gateId: 'gate-e',
      deviceCode: 'PROX-GATE-E-01',
      name: 'Ultrasonic Gate E Chiller',
      sourceType: 'PROXIMITY' as const,
      apiKeyPreview: 'wh-prox-...06',
      mqttTopic: 'warehouse/WH-JKT-01/gate/GATE-E/event',
      status: 'ONLINE' as const,
      lastHeartbeatIso: nowIso,
      firmwareVersion: 'v3.1.0',
    },
  ];
  for (const d of devices) {
    stage2.push({
      col: 'devices',
      id: d.id,
      data: {
        ...d,
        warehouseId: whId,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }

  // 7. Initial Historical Movements (aligned with B-12, C-07, A-21 / A-18)
  const initialMovements = [
    { id: 'mov-seed-01', gateId: 'gate-b', gateCode: 'GATE-B', dir: 'IN', item: skuCatalog[0], qty: 50, source: 'RFID', deviceId: 'RFID-GATE-A-01', rackId: 'rack-b-12', rackCode: 'B-12', minsAgo: 4 },
    { id: 'mov-seed-02', gateId: 'gate-c', gateCode: 'GATE-C', dir: 'IN', item: skuCatalog[45], qty: 50, source: 'BARCODE', deviceId: 'BARCODE-GATE-B-01', rackId: 'rack-c-07', rackCode: 'C-07', minsAgo: 12 },
    { id: 'mov-seed-03', gateId: 'gate-a', gateCode: 'GATE-A', dir: 'OUT', item: skuCatalog[46], qty: 30, source: 'PROXIMITY', deviceId: 'PROX-GATE-C-01', rackId: 'rack-a-18', rackCode: 'A-18', minsAgo: 25 },
    { id: 'mov-seed-04', gateId: 'gate-d', gateCode: 'GATE-D', dir: 'IN', item: skuCatalog[47], qty: 40, source: 'RFID', deviceId: 'RFID-GATE-D-01', rackId: 'rack-d-12', rackCode: 'D-12', minsAgo: 55 },
    { id: 'mov-seed-05', gateId: 'gate-e', gateCode: 'GATE-E', dir: 'OUT', item: skuCatalog[48], qty: 20, source: 'MANUAL', deviceId: 'MANUAL-CONSOLE', rackId: 'rack-e-19', rackCode: 'E-19', minsAgo: 95 },
    { id: 'mov-seed-06', gateId: 'gate-a', gateCode: 'GATE-A', dir: 'IN', item: skuCatalog[49], qty: 65, source: 'RFID', deviceId: 'RFID-GATE-A-01', rackId: 'rack-a-07', rackCode: 'A-07', minsAgo: 1500 },
  ];

  for (const m of initialMovements) {
    const ts = new Date(Date.now() - m.minsAgo * 60 * 1000).toISOString();
    stage2.push({
      col: 'movements',
      id: m.id,
      data: {
        id: m.id,
        eventId: m.id,
        payloadHash: `seed-hash-${m.id}`,
        warehouseId: whId,
        gateId: m.gateId,
        gateCode: m.gateCode,
        direction: m.dir,
        itemId: m.item.id,
        sku: m.item.sku,
        itemName: m.item.name,
        quantity: m.qty,
        source: m.source,
        deviceId: m.deviceId,
        rackId: m.rackId,
        rackCode: m.rackCode,
        placementStatus: 'ASSIGNED',
        tagOrCode: m.item.sku,
        rawPayload: JSON.stringify({ seeded: true, sku: m.item.sku }),
        eventTimestamp: ts,
        createdByUid: uid,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
      },
    });
  }

  // 8. Initial Alerts
  const alerts = [
    { id: 'alt-seed-b12', rackId: 'rack-b-12', rackCode: 'B-12', severity: 'WARNING', type: 'THRESHOLD_YELLOW', message: 'Rak B-12 hampir penuh (80% terisi: 800 / 1.000 kg).' },
    { id: 'alt-seed-a07', rackId: 'rack-a-07', rackCode: 'A-07', severity: 'CRITICAL', type: 'THRESHOLD_RED', message: 'Rak A-07 memerlukan perhatian (>90% kapasitas terpakai).' },
    { id: 'alt-seed-e19', rackId: 'rack-e-19', rackCode: 'E-19', severity: 'CRITICAL', type: 'THRESHOLD_RED', message: 'Rak E-19 memerlukan perhatian (>90% kapasitas terpakai).' },
    { id: 'alt-seed-devc2', rackId: 'rack-c-18', rackCode: 'C-18', severity: 'WARNING', type: 'DEVICE_OFFLINE', message: 'Perangkat RFID-GATE-C-02 offline (>60 detik tanpa heartbeat).' },
  ];
  for (const a of alerts) {
    stage2.push({
      col: 'alerts',
      id: a.id,
      data: {
        ...a,
        warehouseId: whId,
        acknowledged: false,
        ownerUid,
        memberUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }

  await commitWritesChunked(stage2, 15);
}

export async function seedWarehouseWorkspace(user: User): Promise<void> {
  const uid = user.uid;
  const whId = 'wh-jkt-01';
  const memberUids = [uid];

  try {
    await setDoc(doc(db, 'warehouses', whId), {
      id: whId,
      code: 'WH-JKT-01',
      name: 'Gudang Pabrik Barang Jadi Cikarang',
      location: 'Kawasan Industri Jababeka II, Bekasi',
      description: 'Gudang distribusi pabrik skala besar (5 Area, 100 Rak, 160+ SKU barang jadi) termonitor via RFID, Barcode & Sensor Proximity.',
      ownerUid: uid,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `warehouses/${whId}`);
  }

  await seedFactoryContent({ uid, ownerUid: uid, whId, memberUids });
}

export async function resetWorkspaceToFactoryPreset(params: {
  user: User;
  ownerUid: string;
  warehouseId: string;
  memberUids: string[];
  existingZones: ZoneDoc[];
  existingRacks: RackDoc[];
  existingGates: GateDoc[];
  existingItems: ItemDoc[];
  existingTags: ItemTagDoc[];
  existingStocks: RackStockDoc[];
  existingDevices: DeviceDoc[];
  existingMovements: MovementDoc[];
  existingAlerts: AlertDoc[];
  existingSettings: SettingDoc | null;
}) {
  const {
    user,
    ownerUid,
    warehouseId,
    memberUids,
    existingZones,
    existingRacks,
    existingGates,
    existingItems,
    existingTags,
    existingStocks,
    existingDevices,
    existingMovements,
    existingAlerts,
    existingSettings,
  } = params;

  const deletes: Array<{ col: string; id: string }> = [
    ...existingStocks.map((x) => ({ col: 'rack_stock', id: x.id })),
    ...existingTags.map((x) => ({ col: 'item_tags', id: x.id })),
    ...existingItems.map((x) => ({ col: 'items', id: x.id })),
    ...existingMovements.map((x) => ({ col: 'movements', id: x.id })),
    ...existingAlerts.map((x) => ({ col: 'alerts', id: x.id })),
    ...existingDevices.map((x) => ({ col: 'devices', id: x.id })),
    ...existingRacks.map((x) => ({ col: 'racks', id: x.id })),
    ...existingGates.map((x) => ({ col: 'gates', id: x.id })),
    ...existingZones.map((x) => ({ col: 'zones', id: x.id })),
    ...(existingSettings ? [{ col: 'settings', id: existingSettings.id }] : []),
  ];

  await commitDeletesChunked(deletes, 15);
  await seedFactoryContent({
    uid: user.uid,
    ownerUid,
    whId: warehouseId,
    memberUids: memberUids.includes(user.uid) ? memberUids : [...memberUids.slice(0, 24), user.uid],
  });
}
