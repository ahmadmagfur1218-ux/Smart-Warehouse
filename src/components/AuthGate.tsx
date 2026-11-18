import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { Boxes, Cpu, Radio, ShieldCheck, ArrowRight } from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase.ts';

export const AuthGate: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk dengan Google.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center px-6 py-12">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="lg:col-span-7 p-8 lg:p-10 flex flex-col justify-between bg-slate-900 text-slate-100">
          <div>
            <div className="flex items-center gap-2.5 text-slate-300 text-sm font-medium mb-6">
              <Boxes className="w-5 h-5 text-emerald-400" />
              <span>Smart Warehouse Inventory</span>
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-white mb-4 leading-tight">
              Kontrol Pergerakan Gate IoT & Kapasitas Rak Real-Time
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed max-w-md">
              Sistem logistik terpusat untuk pencatatan arus masuk dan keluar barang melalui gerbang RFID, Barcode, dan sensor Proximity ESP32 dengan pemantauan kapasitas visual per zona.
            </p>
          </div>

          <div className="mt-10 pt-6 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-5 text-xs">
            <div>
              <div className="flex items-center gap-1.5 font-medium text-white mb-1">
                <Radio className="w-3.5 h-3.5 text-emerald-400" />
                <span>Pluggable IoT</span>
              </div>
              <p className="text-slate-400">Adapter RFID, Barcode Wedge, & Dual Proximity</p>
            </div>
            <div>
              <div className="flex items-center gap-1.5 font-medium text-white mb-1">
                <Cpu className="w-3.5 h-3.5 text-amber-400" />
                <span>Debounce & Idempoten</span>
              </div>
              <p className="text-slate-400">Filter bacaan ganda & validasi kapasitas otomatis</p>
            </div>
            <div>
              <div className="flex items-center gap-1.5 font-medium text-white mb-1">
                <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                <span>RBAC Terlindungi</span>
              </div>
              <p className="text-slate-400">Hak akses Admin, Operator, dan Viewer</p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 p-8 lg:p-10 flex flex-col justify-center">
          <h2 className="font-display text-xl font-semibold text-slate-900 mb-2">
            Masuk ke Console Gudang
          </h2>
          <p className="text-sm text-slate-600 mb-6">
            Gunakan akun Google terverifikasi untuk mengakses denah rak, log gate, dan telemetri perangkat.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-3 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer"
          >
            <span>{loading ? 'Menghubungkan...' : 'Masuk dengan Google'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <p className="mt-6 text-xs text-slate-500 leading-relaxed">
            Saat login pertama kali, workspace contoh (1 Warehouse, 3 Gate, 12 Rak, 20 SKU, dan 4 Perangkat IoT) akan disiapkan secara otomatis.
          </p>
        </div>
      </div>
    </div>
  );
};
