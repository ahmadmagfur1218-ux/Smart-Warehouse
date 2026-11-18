import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { io, type Socket } from 'socket.io-client';
import {
  Activity,
  BarChart3,
  Boxes,
  Cpu,
  Database,
  History,
  LayoutGrid,
  LogOut,
  Menu,
  Plus,
  ScanBarcode,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase.ts';
import { processNormalizedEventInFirestore } from './lib/capacityEngine.ts';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  ensureUserProfile,
  resetWorkspaceToFactoryPreset,
  seedWarehouseWorkspace,
} from './lib/seedFirestore.ts';
import { AuthGate } from './components/AuthGate.tsx';
import { DashboardFloorplanView } from './components/DashboardFloorplanView.tsx';
import { GateTerminalView } from './components/GateTerminalView.tsx';
import { MovementLogsView } from './components/MovementLogsView.tsx';
import { MasterDataView } from './components/MasterDataView.tsx';
import { DevicesView } from './components/DevicesView.tsx';
import { ReportsView } from './components/ReportsView.tsx';
import { SettingsView, UsersView } from './components/UsersSettingsView.tsx';
import type {
  AlertDoc,
  DeviceDoc,
  GateDoc,
  ItemDoc,
  ItemTagDoc,
  MovementDoc,
  NormalizedGateEvent,
  RackDoc,
  RackStockDoc,
  SettingDoc,
  UserProfileDoc,
  UserRole,
  WarehouseDoc,
  ZoneDoc,
} from './shared/types.ts';

type NavTab =
  | 'floorplan'
  | 'terminal'
  | 'movements'
  | 'master'
  | 'devices'
  | 'reports'
  | 'users'
  | 'settings';

interface ToastItem {
  id: string;
  message: string;
  tone: 'info' | 'warn' | 'error';
}

const NAV_ITEMS: Array<{ key: NavTab; label: string; icon: React.FC<{ className?: string }> }> = [
  { key: 'floorplan', label: 'Denah & Kapasitas', icon: LayoutGrid },
  { key: 'terminal', label: 'Terminal Gate & Scan', icon: ScanBarcode },
  { key: 'movements', label: 'Log Pergerakan', icon: History },
  { key: 'master', label: 'Master Data', icon: Database },
  { key: 'devices', label: 'Perangkat IoT', icon: Cpu },
  { key: 'reports', label: 'Laporan', icon: BarChart3 },
  { key: 'users', label: 'Manajemen User', icon: Users },
  { key: 'settings', label: 'Pengaturan', icon: Settings },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [role, setRole] = useState<UserRole>('VIEWER');
  const [activeTab, setActiveTab] = useState<NavTab>('floorplan');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Firestore Live Collections
  const [warehouses, setWarehouses] = useState<WarehouseDoc[]>([]);
  const [zones, setZones] = useState<ZoneDoc[]>([]);
  const [gates, setGates] = useState<GateDoc[]>([]);
  const [racks, setRacks] = useState<RackDoc[]>([]);
  const [items, setItems] = useState<ItemDoc[]>([]);
  const [itemTags, setItemTags] = useState<ItemTagDoc[]>([]);
  const [devices, setDevices] = useState<DeviceDoc[]>([]);
  const [rackStocks, setRackStocks] = useState<RackStockDoc[]>([]);
  const [movements, setMovements] = useState<MovementDoc[]>([]);
  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [settingsList, setSettingsList] = useState<SettingDoc[]>([]);
  const [userProfiles, setUserProfiles] = useState<UserProfileDoc[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const processedClientEventsRef = useRef<Set<string>>(new Set());

  const notify = useCallback((message: string, tone: 'info' | 'warn' | 'error' = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [{ id, message, tone }, ...prev].slice(0, 5));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }, []);

  // Keep latest context in ref for Socket.IO callback
  const liveCtxRef = useRef({
    user,
    warehouses,
    gates,
    racks,
    items,
    itemTags,
    devices,
    rackStocks,
    settingsList,
  });
  liveCtxRef.current = {
    user,
    warehouses,
    gates,
    racks,
    items,
    itemTags,
    devices,
    rackStocks,
    settingsList,
  };

  // Auth Lifecycle + Initial Seeding
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setWorkspaceReady(false);
        setAuthLoading(false);
        return;
      }

      try {
        const userRole = await ensureUserProfile(nextUser);
        setRole(userRole);

        const qWh = query(
          collection(db, 'warehouses'),
          where('memberUids', 'array-contains', nextUser.uid)
        );
        const qRacks = query(
          collection(db, 'racks'),
          where('memberUids', 'array-contains', nextUser.uid)
        );
        const [whSnap, rackSnap, settingsSnap] = await Promise.all([
          getDocs(qWh),
          getDocs(qRacks),
          getDocs(
            query(
              collection(db, 'settings'),
              where('memberUids', 'array-contains', nextUser.uid)
            )
          ),
        ]);
        if (whSnap.empty || rackSnap.empty) {
          await seedWarehouseWorkspace(nextUser);
        } else {
          const whDoc = whSnap.docs[0].data() as WarehouseDoc;
          const firstSetting = settingsSnap.docs[0]?.data() as SettingDoc | undefined;
          const isLegacyStarterSeed =
            !firstSetting?.defaultAreaCount &&
            rackSnap.size <= 12 &&
            (userRole === 'ADMIN' || whDoc.ownerUid === nextUser.uid);

          if (isLegacyStarterSeed) {
            const byMember = (colName: string) =>
              getDocs(
                query(
                  collection(db, colName),
                  where('memberUids', 'array-contains', nextUser.uid)
                )
              );
            const [zS, gS, iS, tS, stS, dS, mS, aS] = await Promise.all([
              byMember('zones'),
              byMember('gates'),
              byMember('items'),
              byMember('item_tags'),
              byMember('rack_stock'),
              byMember('devices'),
              byMember('movements'),
              byMember('alerts'),
            ]);
            await resetWorkspaceToFactoryPreset({
              user: nextUser,
              ownerUid: whDoc.ownerUid,
              warehouseId: whDoc.id,
              memberUids: whDoc.memberUids,
              existingZones: zS.docs.map((d) => d.data() as ZoneDoc),
              existingRacks: rackSnap.docs.map((d) => d.data() as RackDoc),
              existingGates: gS.docs.map((d) => d.data() as GateDoc),
              existingItems: iS.docs.map((d) => d.data() as ItemDoc),
              existingTags: tS.docs.map((d) => d.data() as ItemTagDoc),
              existingStocks: stS.docs.map((d) => d.data() as RackStockDoc),
              existingDevices: dS.docs.map((d) => d.data() as DeviceDoc),
              existingMovements: mS.docs.map((d) => d.data() as MovementDoc),
              existingAlerts: aS.docs.map((d) => d.data() as AlertDoc),
              existingSettings: firstSetting || null,
            });
          }
        }
        setWorkspaceReady(true);
      } catch (err) {
        console.error('Auth initialization error:', err);
      } finally {
        setAuthLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // Firestore Realtime Listeners
  useEffect(() => {
    if (!user || !workspaceReady) return;
    const uid = user.uid;
    const isBootAdmin =
      user.emailVerified &&
      user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

    const listenMemberCol = <T,>(colName: string, setter: (rows: T[]) => void) => {
      const q = query(
        collection(db, colName),
        where('memberUids', 'array-contains', uid)
      );
      return onSnapshot(
        q,
        (snap) => {
          setter(snap.docs.map((d) => d.data() as T));
        },
        (error) => handleFirestoreError(error, OperationType.LIST, colName)
      );
    };

    const unsubs = [
      listenMemberCol<WarehouseDoc>('warehouses', setWarehouses),
      listenMemberCol<ZoneDoc>('zones', setZones),
      listenMemberCol<GateDoc>('gates', setGates),
      listenMemberCol<RackDoc>('racks', setRacks),
      listenMemberCol<ItemDoc>('items', setItems),
      listenMemberCol<ItemTagDoc>('item_tags', setItemTags),
      listenMemberCol<DeviceDoc>('devices', setDevices),
      listenMemberCol<RackStockDoc>('rack_stock', setRackStocks),
      listenMemberCol<MovementDoc>('movements', (rows) => {
        const sorted = [...rows].sort((a, b) =>
          b.eventTimestamp.localeCompare(a.eventTimestamp)
        );
        setMovements(sorted);
      }),
      listenMemberCol<AlertDoc>('alerts', (rows) => {
        const sorted = [...rows].sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged));
        setAlerts(sorted);
      }),
      listenMemberCol<SettingDoc>('settings', setSettingsList),
      onSnapshot(
        isBootAdmin
          ? collection(db, 'users')
          : query(collection(db, 'users'), where('uid', '==', uid)),
        (snap) => {
          setUserProfiles(snap.docs.map((d) => d.data() as UserProfileDoc));
        },
        (error) => handleFirestoreError(error, OperationType.LIST, 'users')
      ),
    ];

    return () => {
      for (const u of unsubs) u();
    };
  }, [user, workspaceReady]);

  // Socket.IO Realtime Connection
  useEffect(() => {
    if (!user || !workspaceReady) return;

    const socket = io({
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setWsConnected(true);
    });

    socket.on('disconnect', () => {
      setWsConnected(false);
    });

    socket.on('warehouse:event', async (event: NormalizedGateEvent) => {
      if (processedClientEventsRef.current.has(event.event_id)) return;
      processedClientEventsRef.current.add(event.event_id);

      const snap = liveCtxRef.current;
      const wh = snap.warehouses[0];
      if (!snap.user || !wh) return;

      try {
        const outcome = await processNormalizedEventInFirestore(event, {
          currentUid: snap.user.uid,
          warehouseId: wh.id,
          memberUids: wh.memberUids,
          ownerUid: wh.ownerUid,
          gates: snap.gates,
          racks: snap.racks,
          items: snap.items,
          itemTags: snap.itemTags,
          rackStocks: snap.rackStocks,
          settings: snap.settingsList[0] || null,
        });

        if (outcome.alertMessage) {
          notify(
            outcome.alertMessage,
            outcome.alertSeverity === 'CRITICAL' ? 'error' : 'warn'
          );
        } else {
          notify(
            `${event.direction} ${outcome.sku} x${event.quantity} -> ${outcome.rackCode} (${event.source})`,
            'info'
          );
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Gagal memproses event', 'error');
      }
    });

    socket.on('device:heartbeat', async (hb: { deviceId: string; timestamp: string }) => {
      const snap = liveCtxRef.current;
      const dev = snap.devices.find(
        (d) => d.deviceCode === hb.deviceId || d.id === hb.deviceId
      );
      if (!dev) return;
      try {
        await updateDoc(doc(db, 'devices', dev.id), {
          status: 'ONLINE',
          lastHeartbeatIso: hb.timestamp || new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Ignore transient write conflicts on heartbeat
      }
    });

    socket.on('proximity:sequence', (seq: { gateId: string; firstSensor: string; waitingFor: string }) => {
      notify(
        `Gate ${seq.gateId}: Sensor ${seq.firstSensor} aktif, menunggu Sensor ${seq.waitingFor}...`,
        'info'
      );
    });

    socket.on('event:filtered', (info: { status: string; reason?: string }) => {
      notify(`${info.status}: ${info.reason || 'Event disaring oleh debounce/idempotensi.'}`, 'warn');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, workspaceReady, notify]);

  // Sync per-gate debounce window to backend whenever gates update
  useEffect(() => {
    if (socketRef.current && gates.length > 0) {
      socketRef.current.emit(
        'gate:debounce:sync',
        gates.map((g) => ({
          gateCode: g.code,
          debounceWindowSec: g.debounceWindowSec,
        }))
      );
    }
  }, [gates]);

  const submitEventToApi = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/v1/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Warehouse-Client': 'dashboard',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.reason || data.error || 'Event ditolak server.', 'error');
    }
  };

  const triggerSimulatedEvent = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/v1/simulator/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.reason || data.error || 'Simulasi gagal.', 'error');
    }
  };

  const pingDeviceHeartbeat = async (deviceCode: string) => {
    try {
      await fetch(`/api/v1/devices/${encodeURIComponent(deviceCode)}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manualPing: true }),
      });
    } catch {
      // Proceed with direct Firestore status sync
    }
    const dev = devices.find((d) => d.deviceCode === deviceCode || d.id === deviceCode);
    if (dev) {
      try {
        await updateDoc(doc(db, 'devices', dev.id), {
          status: 'ONLINE',
          lastHeartbeatIso: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `devices/${dev.id}`);
      }
    }
    notify(`Heartbeat terkirim untuk ${deviceCode}.`);
  };

  const acknowledgeAlert = async (alertId: string) => {
    try {
      await updateDoc(doc(db, 'alerts', alertId), {
        acknowledged: true,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `alerts/${alertId}`);
    }
  };

  const activeWarehouse = warehouses[0] || null;
  const activeSettings = settingsList[0] || null;
  const activeTabLabel = useMemo(
    () => NAV_ITEMS.find((n) => n.key === activeTab)?.label || 'Dashboard',
    [activeTab]
  );

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Memuat sesi Smart Warehouse Inventory...
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  if (!workspaceReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Menyiapkan data gudang pabrik (5 Area, 100 Rak, 160 Produk Barang Jadi)...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f7fb] flex text-slate-900">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 bg-white border-r border-slate-200">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#1D63ED] text-white flex items-center justify-center shrink-0">
            <Boxes className="w-4 h-4" />
          </div>
          <span className="font-display text-sm font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Smart Warehouse
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs font-medium rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#1D63ED] text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="text-xs">
            <div className="font-semibold text-slate-900 truncate">
              {user.displayName || user.email}
            </div>
            <div className="text-slate-500 font-mono text-[11px] mt-0.5">
              Role: {role} · {activeWarehouse?.code || 'WH-JKT-01'}
            </div>
          </div>
          <button
            onClick={() => void signOut(auth)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Keluar
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 bg-white h-full border-r border-slate-200 flex flex-col">
            <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
              <span className="font-display text-sm font-bold text-slate-900">
                Smart Warehouse
              </span>
              <button onClick={() => setMobileNavOpen(false)} className="p-1 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      setActiveTab(item.key);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs font-medium rounded-xl ${
                      active ? 'bg-[#1D63ED] text-white' : 'text-slate-600'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
          <div
            className="flex-1 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-4 lg:px-7 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Menu navigasi"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm font-medium text-slate-500 truncate">
              <span>{activeWarehouse?.name || 'Gudang Utama'}</span>
              <span className="mx-2 text-slate-300">/</span>
              <span className="text-slate-900 font-semibold">{activeTabLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600">
              <span
                className={`w-2 h-2 rounded-full ${
                  wsConnected ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              <Activity className="w-3.5 h-3.5 text-slate-400" />
              <span className="whitespace-nowrap">
                {wsConnected ? 'WebSocket Terhubung' : 'Menyambung WS...'}
              </span>
            </div>

            <button
              onClick={() => setActiveTab('terminal')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#1D63ED] rounded-xl hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Scan / Input Gate
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {activeTab === 'floorplan' && (
            <DashboardFloorplanView
              role={role}
              wsConnected={wsConnected}
              zones={zones}
              gates={gates}
              racks={racks}
              items={items}
              itemTags={itemTags}
              devices={devices}
              rackStocks={rackStocks}
              movements={movements}
              alerts={alerts}
              settings={activeSettings}
              onAcknowledgeAlert={acknowledgeAlert}
              onTriggerSimulatedEvent={triggerSimulatedEvent}
              onNavigateToLogs={() => setActiveTab('movements')}
              onOpenLayoutSettings={() => setActiveTab('settings')}
            />
          )}

          {activeTab === 'terminal' && (
            <GateTerminalView
              role={role}
              gates={gates}
              racks={racks}
              items={items}
              itemTags={itemTags}
              onSubmitEvent={submitEventToApi}
            />
          )}

          {activeTab === 'movements' && (
            <MovementLogsView movements={movements} gates={gates} />
          )}

          {activeTab === 'master' && (
            <MasterDataView
              role={role}
              currentUid={user.uid}
              warehouse={activeWarehouse}
              zones={zones}
              gates={gates}
              racks={racks}
              items={items}
              itemTags={itemTags}
              settings={activeSettings}
              onNotify={notify}
            />
          )}

          {activeTab === 'devices' && (
            <DevicesView
              role={role}
              currentUid={user.uid}
              warehouse={activeWarehouse}
              gates={gates}
              devices={devices}
              settings={activeSettings}
              onPingDevice={pingDeviceHeartbeat}
              onNotify={notify}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsView
              movements={movements}
              gates={gates}
              racks={racks}
              settings={activeSettings}
            />
          )}

          {activeTab === 'users' && (
            <UsersView
              role={role}
              currentUid={user.uid}
              users={userProfiles}
              onNotify={notify}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              role={role}
              currentUid={user.uid}
              warehouse={activeWarehouse}
              zones={zones}
              gates={gates}
              settings={activeSettings}
              racks={racks}
              onNotify={notify}
              onLayoutApplied={() => setActiveTab('floorplan')}
              onResetFactoryPreset={async () => {
                if (!activeWarehouse) return;
                await resetWorkspaceToFactoryPreset({
                  user,
                  ownerUid: activeWarehouse.ownerUid,
                  warehouseId: activeWarehouse.id,
                  memberUids: activeWarehouse.memberUids,
                  existingZones: zones,
                  existingRacks: racks,
                  existingGates: gates,
                  existingItems: items,
                  existingTags: itemTags,
                  existingStocks: rackStocks,
                  existingDevices: devices,
                  existingMovements: movements,
                  existingAlerts: alerts,
                  existingSettings: activeSettings,
                });
                notify('Data gudang dipulihkan ke Preset Pabrik Besar (5 Area, 100 Rak, 160 Produk).');
                setActiveTab('floorplan');
              }}
            />
          )}
        </main>
      </div>

      {/* Live Notification Toasts */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full px-4 sm:px-0">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`p-3.5 rounded-xl border shadow-sm text-xs flex items-start justify-between gap-3 bg-white ${
                t.tone === 'error'
                  ? 'border-rose-300 text-rose-900'
                  : t.tone === 'warn'
                  ? 'border-amber-300 text-amber-900'
                  : 'border-slate-200 text-slate-800'
              }`}
            >
              <span>{t.message}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
