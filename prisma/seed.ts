/**
 * Prisma Seed Script for PostgreSQL Deployment
 * Seeds: 1 Warehouse, 3 Zones, 3 Gates, 12 Racks, 20 SKUs, Tag Mappings, 4 IoT Devices, Settings, and 3 Users.
 * Run with: npx tsx prisma/seed.ts
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

async function main() {
  // Dynamically import @prisma/client when running in PostgreSQL environments
  const { PrismaClient } = await import('@prisma/client' as string);
  const prisma = new PrismaClient();

  const wh = await prisma.warehouse.upsert({
    where: { code: 'WH-JKT-01' },
    update: {},
    create: {
      code: 'WH-JKT-01',
      name: 'Gudang Distribusi Cikarang Utara',
      location: 'Kawasan Industri Jababeka II, Bekasi',
      description: 'Main IoT-enabled regional fulfillment & cold-chain storage facility.',
    },
  });

  await prisma.setting.upsert({
    where: { warehouseId: wh.id },
    update: {},
    create: {
      warehouseId: wh.id,
      greenMaxPct: 69,
      yellowMaxPct: 94,
      heartbeatTimeoutSec: 60,
      defaultDebounceSec: 5,
      allowOverCapacity: false,
    },
  });

  const zonesData = [
    { code: 'ZONE-RCV', name: 'Zona A · Inbound & Fast-Moving', description: 'High-turnover pallet staging near Gate A' },
    { code: 'ZONE-BULK', name: 'Zona B · Bulk Heavy Rack', description: 'High-bay unit & pallet storage' },
    { code: 'ZONE-COLD', name: 'Zona C · Cold & Precision Storage', description: 'Volume-metered m3 climate storage' },
  ];

  const zones: Record<string, any> = {};
  for (const z of zonesData) {
    zones[z.code] = await prisma.zone.upsert({
      where: { warehouseId_code: { warehouseId: wh.id, code: z.code } },
      update: {},
      create: { warehouseId: wh.id, ...z },
    });
  }

  const gatesData = [
    { code: 'GATE-A', name: 'Gate A (Dock Inbound)', zoneCode: 'ZONE-RCV', gateType: 'INBOUND', debounceWindowSec: 5 },
    { code: 'GATE-B', name: 'Gate B (Dock Outbound)', zoneCode: 'ZONE-BULK', gateType: 'OUTBOUND', debounceWindowSec: 5 },
    { code: 'GATE-C', name: 'Gate C (Cross-Dock Bidirectional)', zoneCode: 'ZONE-COLD', gateType: 'BIDIRECTIONAL', debounceWindowSec: 5 },
  ];

  const gates: Record<string, any> = {};
  for (const g of gatesData) {
    gates[g.code] = await prisma.gate.upsert({
      where: { warehouseId_code: { warehouseId: wh.id, code: g.code } },
      update: {},
      create: {
        warehouseId: wh.id,
        zoneId: zones[g.zoneCode].id,
        code: g.code,
        name: g.name,
        gateType: g.gateType,
        debounceWindowSec: g.debounceWindowSec,
      },
    });
  }

  const racksData = [
    { code: 'RACK-A1', name: 'A1 Pallet Bay', zoneCode: 'ZONE-RCV', unitType: 'PALLET_SLOT', maxCapacity: 40, usedCapacity: 18, statusColor: 'GREEN', rowIndex: 0, colIndex: 0 },
    { code: 'RACK-A2', name: 'A2 Pallet Bay', zoneCode: 'ZONE-RCV', unitType: 'PALLET_SLOT', maxCapacity: 40, usedCapacity: 31, statusColor: 'YELLOW', rowIndex: 0, colIndex: 1 },
    { code: 'RACK-A3', name: 'A3 Staging Rack', zoneCode: 'ZONE-RCV', unitType: 'UNIT', maxCapacity: 200, usedCapacity: 90, statusColor: 'GREEN', rowIndex: 1, colIndex: 0 },
    { code: 'RACK-A4', name: 'A4 Overflow Bay', zoneCode: 'ZONE-RCV', unitType: 'PALLET_SLOT', maxCapacity: 30, usedCapacity: 29, statusColor: 'RED', rowIndex: 1, colIndex: 1 },
    { code: 'RACK-B1', name: 'B1 Heavy Rack', zoneCode: 'ZONE-BULK', unitType: 'PALLET_SLOT', maxCapacity: 60, usedCapacity: 24, statusColor: 'GREEN', rowIndex: 0, colIndex: 0 },
    { code: 'RACK-B2', name: 'B2 Heavy Rack', zoneCode: 'ZONE-BULK', unitType: 'PALLET_SLOT', maxCapacity: 60, usedCapacity: 48, statusColor: 'YELLOW', rowIndex: 0, colIndex: 1 },
    { code: 'RACK-B3', name: 'B3 Carton Rack', zoneCode: 'ZONE-BULK', unitType: 'UNIT', maxCapacity: 500, usedCapacity: 180, statusColor: 'GREEN', rowIndex: 1, colIndex: 0 },
    { code: 'RACK-B4', name: 'B4 Dispatch Staging', zoneCode: 'ZONE-BULK', unitType: 'UNIT', maxCapacity: 300, usedCapacity: 291, statusColor: 'RED', rowIndex: 1, colIndex: 1 },
    { code: 'RACK-C1', name: 'C1 Chiller m3', zoneCode: 'ZONE-COLD', unitType: 'M3', maxCapacity: 120, usedCapacity: 48, statusColor: 'GREEN', rowIndex: 0, colIndex: 0 },
    { code: 'RACK-C2', name: 'C2 Chiller m3', zoneCode: 'ZONE-COLD', unitType: 'M3', maxCapacity: 120, usedCapacity: 96, statusColor: 'YELLOW', rowIndex: 0, colIndex: 1 },
    { code: 'RACK-C3', name: 'C3 Precision Bay', zoneCode: 'ZONE-COLD', unitType: 'UNIT', maxCapacity: 250, usedCapacity: 80, statusColor: 'GREEN', rowIndex: 1, colIndex: 0 },
    { code: 'RACK-C4', name: 'C4 Deep Freeze', zoneCode: 'ZONE-COLD', unitType: 'M3', maxCapacity: 80, usedCapacity: 77, statusColor: 'RED', rowIndex: 1, colIndex: 1 },
  ];

  const racks: Record<string, any> = {};
  for (const r of racksData) {
    racks[r.code] = await prisma.rack.upsert({
      where: { warehouseId_code: { warehouseId: wh.id, code: r.code } },
      update: {},
      create: {
        warehouseId: wh.id,
        zoneId: zones[r.zoneCode].id,
        code: r.code,
        name: r.name,
        unitType: r.unitType,
        maxCapacity: r.maxCapacity,
        usedCapacity: r.usedCapacity,
        statusColor: r.statusColor,
        rowIndex: r.rowIndex,
        colIndex: r.colIndex,
      },
    });
  }

  const skus = [
    ['SKU-ELC-001', 'Industrial Servo Motor 2kW', 'Electronics', 'UNIT', 0.4, 'RACK-A1'],
    ['SKU-ELC-002', 'PLC Controller Module S7', 'Electronics', 'UNIT', 0.2, 'RACK-A1'],
    ['SKU-ELC-003', 'UHF RFID Antenna Panel', 'Electronics', 'UNIT', 0.3, 'RACK-A2'],
    ['SKU-ELC-004', '24V DIN Rail Power Supply', 'Electronics', 'UNIT', 0.15, 'RACK-A3'],
    ['SKU-PKG-005', 'Euro Pallet Shrink Wrap Roll', 'Packaging', 'PALLET', 1.2, 'RACK-A4'],
    ['SKU-PKG-006', 'Corrugated Carton Box 60x40', 'Packaging', 'PALLET', 1.0, 'RACK-B1'],
    ['SKU-PKG-007', 'Heavy Duty Strapping Band', 'Packaging', 'PALLET', 0.8, 'RACK-B1'],
    ['SKU-CHM-008', 'Hydraulic Oil ISO VG 46 (Drum)', 'Lubricants', 'PALLET', 1.4, 'RACK-B2'],
    ['SKU-CHM-009', 'Synthetic Gear Grease 20L', 'Lubricants', 'UNIT', 0.25, 'RACK-B2'],
    ['SKU-MCH-010', 'Ball Bearing SKF 6205-2RS', 'Mechanical', 'UNIT', 0.05, 'RACK-B3'],
    ['SKU-MCH-011', 'Stainless Valve DN50', 'Mechanical', 'UNIT', 0.18, 'RACK-B3'],
    ['SKU-MCH-012', 'Pneumatic Cylinder 100mm', 'Mechanical', 'UNIT', 0.22, 'RACK-B4'],
    ['SKU-CLD-013', 'Biologics Reagent Pack A', 'Cold Chain', 'M3', 1.5, 'RACK-C1'],
    ['SKU-CLD-014', 'Vaccine Thermal Tote 40L', 'Cold Chain', 'M3', 1.0, 'RACK-C1'],
    ['SKU-CLD-015', 'Dairy Concentrate 200L Vat', 'Cold Chain', 'M3', 2.0, 'RACK-C2'],
    ['SKU-CLD-016', 'Cryo Gel Pack Case', 'Cold Chain', 'M3', 0.75, 'RACK-C2'],
    ['SKU-SNS-017', 'Ultrasonic Distance Sensor', 'IoT Sensors', 'UNIT', 0.04, 'RACK-C3'],
    ['SKU-SNS-018', 'ESP32-S3 Gateway Node', 'IoT Sensors', 'UNIT', 0.05, 'RACK-C3'],
    ['SKU-CLD-019', 'Frozen Seafood Grade A', 'Cold Chain', 'M3', 2.5, 'RACK-C4'],
    ['SKU-CLD-020', 'Pharma Cold Gel Cartridge', 'Cold Chain', 'M3', 1.2, 'RACK-C4'],
  ] as const;

  for (let i = 0; i < skus.length; i++) {
    const [sku, name, category, unitLabel, unitVolumeM3, defaultRackCode] = skus[i];
    const item = await prisma.item.upsert({
      where: { sku },
      update: {},
      create: {
        warehouseId: wh.id,
        sku,
        name,
        category,
        unitLabel,
        unitVolumeM3,
        defaultRackId: racks[defaultRackCode].id,
      },
    });
    const epc = `E2801160600002054C2A1B${String(i + 10).padStart(2, '0')}`;
    await prisma.itemTag.upsert({
      where: { tagOrCode: epc },
      update: {},
      create: { tagOrCode: epc, tagType: 'RFID', itemId: item.id },
    });
    const barcode = `899100200${String(100 + i)}`;
    await prisma.itemTag.upsert({
      where: { tagOrCode: barcode },
      update: {},
      create: { tagOrCode: barcode, tagType: 'BARCODE', itemId: item.id },
    });
  }

  const devicesData = [
    { deviceCode: 'RFID-GATE-A-01', name: 'UHF RFID Portal Gate A', gateCode: 'GATE-A', sourceType: 'RFID', apiKey: 'wh-rfid-a-key-01', mqttTopic: 'warehouse/WH-JKT-01/gate/GATE-A/event', firmwareVersion: 'v2.4.1' },
    { deviceCode: 'BARCODE-GATE-B-01', name: 'Zebra Fixed Barcode Gate B', gateCode: 'GATE-B', sourceType: 'BARCODE', apiKey: 'wh-barcode-b-key-02', mqttTopic: 'warehouse/WH-JKT-01/gate/GATE-B/event', firmwareVersion: 'v1.9.0' },
    { deviceCode: 'PROX-GATE-C-01', name: 'ESP32 Dual-IR Proximity Gate C', gateCode: 'GATE-C', sourceType: 'PROXIMITY', apiKey: 'wh-prox-c-key-03', mqttTopic: 'warehouse/WH-JKT-01/gate/GATE-C/event', firmwareVersion: 'v3.1.0' },
    { deviceCode: 'RFID-GATE-C-02', name: 'PN532 Secondary Gate C Reader', gateCode: 'GATE-C', sourceType: 'RFID', apiKey: 'wh-rfid-c-key-04', mqttTopic: 'warehouse/WH-JKT-01/gate/GATE-C/event', firmwareVersion: 'v2.0.5' },
  ];

  for (const d of devicesData) {
    const apiKeyHash = crypto.createHash('sha256').update(d.apiKey).digest('hex');
    await prisma.device.upsert({
      where: { deviceCode: d.deviceCode },
      update: {},
      create: {
        warehouseId: wh.id,
        gateId: gates[d.gateCode].id,
        deviceCode: d.deviceCode,
        name: d.name,
        sourceType: d.sourceType,
        apiKeyHash,
        mqttTopic: d.mqttTopic,
        status: 'ONLINE',
        lastHeartbeatAt: new Date(),
        firmwareVersion: d.firmwareVersion,
      },
    });
  }

  const users = [
    { email: 'admin@smartwarehouse.local', displayName: 'Warehouse Admin', role: 'ADMIN', pass: 'Admin@12345' },
    { email: 'operator@smartwarehouse.local', displayName: 'Dock Operator', role: 'OPERATOR', pass: 'Operator@12345' },
    { email: 'viewer@smartwarehouse.local', displayName: 'Audit Viewer', role: 'VIEWER', pass: 'Viewer@12345' },
  ];

  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.pass, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        displayName: u.displayName,
        passwordHash,
        role: u.role,
      },
    });
  }

  console.log('Seed completed: 1 Warehouse, 3 Zones, 3 Gates, 12 Racks, 20 SKUs, 4 Devices, 3 Users.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
