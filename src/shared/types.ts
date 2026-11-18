export type GateType = 'INBOUND' | 'OUTBOUND' | 'BIDIRECTIONAL';
export type Direction = 'IN' | 'OUT';
export type EventSource = 'RFID' | 'BARCODE' | 'PROXIMITY' | 'MANUAL';
export type RackUnitType = 'PALLET_SLOT' | 'UNIT' | 'M3';
export type StatusColor = 'GREEN' | 'YELLOW' | 'RED';
export type PlacementStatus = 'ASSIGNED' | 'UNASSIGNED' | 'OVER_CAPACITY_REJECTED';
export type DeviceStatus = 'ONLINE' | 'OFFLINE';
export type TagType = 'RFID' | 'BARCODE' | 'QR';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertType =
  | 'THRESHOLD_YELLOW'
  | 'THRESHOLD_RED'
  | 'OVER_CAPACITY'
  | 'UNASSIGNED_RACK'
  | 'DEVICE_OFFLINE';
export type UserRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';

/**
 * Standard Gate Event Payload (Section 6)
 */
export interface StandardGateEvent {
  event_id: string;
  device_id: string;
  gate_id: string;
  source: EventSource;
  direction: Direction;
  tag_or_code: string;
  quantity: number;
  rack_id: string | null;
  timestamp: string;
}

export interface NormalizedGateEvent extends StandardGateEvent {
  payload_hash: string;
  raw_payload: string;
}

export interface EventIngestResult {
  status: 'ACCEPTED' | 'DEBOUNCED' | 'DUPLICATE' | 'PENDING_SEQUENCE' | 'REJECTED';
  reason?: string;
  event?: NormalizedGateEvent;
  sequenceState?: {
    gateId: string;
    waitingFor: 'A' | 'B';
    firstSensor: 'A' | 'B';
  };
}

export interface ServerAuditEntry {
  id: string;
  timestamp: string;
  eventId: string;
  deviceId: string;
  gateId: string;
  source: EventSource | 'SYSTEM';
  status: string;
  detail: string;
}

export interface WarehouseDoc {
  id: string;
  code: string;
  name: string;
  location?: string;
  description?: string;
  ownerUid: string;
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ZoneDoc {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  description?: string;
  ownerUid: string;
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GateDoc {
  id: string;
  warehouseId: string;
  zoneId: string;
  code: string;
  name: string;
  gateType: GateType;
  debounceWindowSec: number;
  isActive: boolean;
  ownerUid: string;
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RackDoc {
  id: string;
  warehouseId: string;
  zoneId: string;
  code: string;
  name: string;
  unitType: RackUnitType;
  maxCapacity: number;
  usedCapacity: number;
  statusColor: StatusColor;
  rowIndex: number;
  colIndex: number;
  ownerUid: string;
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ItemDoc {
  id: string;
  warehouseId: string;
  sku: string;
  name: string;
  category: string;
  unitLabel: string;
  unitVolumeM3: number;
  defaultRackId?: string;
  ownerUid: string;
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ItemTagDoc {
  id: string;
  warehouseId: string;
  tagOrCode: string;
  tagType: TagType;
  itemId: string;
  sku: string;
  ownerUid: string;
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DeviceDoc {
  id: string;
  warehouseId: string;
  gateId: string;
  deviceCode: string;
  name: string;
  sourceType: 'RFID' | 'BARCODE' | 'PROXIMITY';
  apiKeyPreview?: string;
  mqttTopic?: string;
  status: DeviceStatus;
  lastHeartbeatIso: string;
  firmwareVersion?: string;
  ownerUid: string;
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RackStockDoc {
  id: string;
  warehouseId: string;
  rackId: string;
  itemId: string;
  sku: string;
  itemName: string;
  quantity: number;
  ownerUid: string;
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MovementDoc {
  id: string;
  eventId: string;
  payloadHash: string;
  warehouseId: string;
  gateId: string;
  gateCode: string;
  direction: Direction;
  itemId?: string;
  sku?: string;
  itemName?: string;
  quantity: number;
  source: EventSource;
  deviceId?: string;
  rackId?: string;
  rackCode?: string;
  placementStatus: PlacementStatus;
  tagOrCode?: string;
  rawPayload?: string;
  eventTimestamp: string;
  createdByUid: string;
  ownerUid: string;
  memberUids: string[];
  createdAt?: unknown;
}

export interface AlertDoc {
  id: string;
  warehouseId: string;
  rackId?: string;
  rackCode?: string;
  severity: AlertSeverity;
  type: AlertType;
  message: string;
  acknowledged: boolean;
  ownerUid: string;
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SettingDoc {
  id: string;
  warehouseId: string;
  greenMaxPct: number;
  yellowMaxPct: number;
  heartbeatTimeoutSec: number;
  defaultDebounceSec: number;
  allowOverCapacity: boolean;
  defaultAreaCount?: number;
  defaultRacksPerArea?: number;
  defaultAislesPerArea?: number;
  defaultRackCapacity?: number;
  defaultRackUnit?: RackUnitType;
  ownerUid: string;
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserProfileDoc {
  uid: string;
  displayName: string;
  role: UserRole;
  status: 'ACTIVE' | 'SUSPENDED';
  warehouseId?: string;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
