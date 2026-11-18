# Smart Warehouse Inventory — IoT Gate & Visual Rack Capacity System

Sistem monitoring pergerakan barang masuk/keluar gudang berbasis IoT (RFID, Barcode/QR, Dual-Sensor Proximity ESP32, dan Input Manual) dengan pembaruan kapasitas rak secara visual dan real-time via WebSocket. Sistem berfokus murni pada logistik pergerakan fisik dan utilisasi ruang rak (tanpa modul penjualan, invoice, atau purchasing).

---

## 1. Struktur Folder Proyek

```text
├── server.ts                          # Express + Socket.IO + Vite runtime server (port 3000)
├── src/
│   ├── server/
│   │   ├── adapters/                  # Pluggable Input Adapters (RFID, Barcode, Proximity, Manual)
│   │   └── services/
│   │       ├── eventProcessor.ts      # Validasi Zod, idempotency hash, debounce window, audit log
│   │       └── mqttService.ts         # Mosquitto MQTT subscriber (events + device heartbeats)
│   ├── shared/
│   │   └── types.ts                   # Kontrak event standar JSON & model domain
│   ├── lib/
│   │   ├── firebase.ts                # Firebase Auth + Firestore SDK + error handler
│   │   ├── capacityEngine.ts          # Penempatan rak otomatis, threshold HIJAU/KUNING/MERAH, proteksi over-capacity
│   │   └── seedFirestore.ts           # Seed 1 Warehouse, 3 Zona, 3 Gate, 12 Rak, 20 SKU, 4 Device
│   └── components/                    # Dashboard Floorplan, Gate Terminal, Movement Logs, Master Data, Devices, Reports, Users, Settings
├── prisma/
│   ├── schema.prisma                  # Skema PostgreSQL (12 tabel + index movements)
│   └── seed.ts                        # Seed script PostgreSQL
├── simulator/
│   └── mqtt-simulator.ts              # Simulator event Node.js (mode MQTT & HTTP Webhook)
├── firmware/
│   ├── esp32_proximity_gate/          # Firmware Arduino C++ ESP32 2-sensor arah (A->B = IN, B->A = OUT)
│   └── esp32_rfid_rc522_pn532/        # Firmware Arduino C++ ESP32 RFID RC522 / PN532 -> MQTT
├── mosquitto/config/mosquitto.conf    # Konfigurasi broker MQTT Mosquitto
├── docker-compose.yml                 # Stack Docker: PostgreSQL, Mosquitto, Backend, Frontend
├── Dockerfile                         # Container production Node.js
└── .env.example                       # Template environment variables
```

---

## 2. Asumsi Desain & Arsitektur

1. **Idempotency & Debounce**: Setiap event wajib memiliki `event_id` unik. Server juga menghitung SHA-256 `payloadHash` dan menyimpan cache debounce per `(gate_id, tag_or_code)` selama `debounceWindowSec` (default 5 detik, dapat diatur per gate) agar pembacaan ganda RFID dalam beberapa milidetik tidak tercatat berulang.
2. **Deteksi Arah Dual-Sensor Proximity**: Untuk gate bertipe `BIDIRECTIONAL` dengan 2 sensor (Sensor A di sisi luar dock, Sensor B di sisi dalam gudang), adapter `ProximityAdapter` melacak state mesin per gate dengan timeout 3,5 detik: urutan `A -> B` menghasilkan `IN`, urutan `B -> A` menghasilkan `OUT`.
3. **Aturan Penempatan Rak Otomatis**: Bila event masuk (`IN`) tidak menyertakan `rack_id`, sistem memilih:
   - (a) `defaultRackId` dari SKU terkait jika kapasitasnya masih mencukupi, atau
   - (b) Rak pertama di zona gate tersebut yang masih berstatus `HIJAU` (ruang masih banyak).
   - Jika tidak ada rak yang memenuhi syarat, pergerakan dicatat sebagai `UNASSIGNED` dan alert peringatan dibuat.
4. **Proteksi Over-Capacity**: Secara default (`allowOverCapacity = false`), event `IN` yang menyebabkan `usedCapacity + quantity > maxCapacity` ditolak sebagai `OVER_CAPACITY_REJECTED` dan memicu alert kritis. Kebijakan ini dapat diubah di halaman **Settings**.
5. **Cloud & Local Persistence**: Aplikasi web preview terhubung ke Firebase Firestore & Google Auth untuk persistensi real-time multi-sesi yang aman (`firestore.rules`), sementara `prisma/schema.prisma`, `prisma/seed.ts`, dan `docker-compose.yml` disediakan lengkap untuk deployment infrastruktur mandiri berbasis PostgreSQL + Mosquitto.

---

## 3. Cara Instalasi & Menjalankan

### A. Menjalankan Lokal (Development)
```bash
npm install
cp .env.example .env
npm run dev
```
Buka `http://localhost:3000`. Login menggunakan akun Google Anda; workspace akan terinisialisasi otomatis dengan 1 Warehouse (`WH-JKT-01`), 3 Gate, 12 Rak, 20 SKU, dan 4 Perangkat IoT.

### B. Menjalankan Stack Lengkap dengan Docker Compose (PostgreSQL + Mosquitto + App)
```bash
cp .env.example .env
docker compose up -d --build
```
Untuk menjalankan migrasi & seed PostgreSQL di container:
```bash
npx prisma migrate deploy
npx tsx prisma/seed.ts
```

---

## 4. Menjalankan Simulator Event (Tanpa Hardware)

**Mode MQTT** (membutuhkan Mosquitto berjalan di `localhost:1883`):
```bash
npm run sim:mqtt
```

**Mode HTTP Webhook** (langsung ke server API `POST /api/v1/events`):
```bash
npx tsx simulator/mqtt-simulator.ts --http http://localhost:3000
```

Atau gunakan panel **Quick Hardware Simulator** langsung di dalam Dashboard aplikasi web untuk memicu event RFID, Barcode, maupun Dual-Sensor Proximity A→B / B→A secara instan.

---

## 5. Menghubungkan Hardware Nyata

### HTTP Webhook Alternatif (`POST /api/v1/events`)
Kirim JSON standar dengan header `X-API-Key`:
```bash
curl -X POST http://localhost:3000/api/v1/events \
  -H "Content-Type: application/json" \
  -H "X-API-Key: wh-rfid-a-key-01" \
  -d '{
    "event_id": "550e8400-e29b-41d4-a716-446655440000",
    "device_id": "RFID-GATE-A-01",
    "gate_id": "GATE-A",
    "source": "RFID",
    "direction": "IN",
    "tag_or_code": "E2801160600002054C2A1B10",
    "quantity": 2,
    "rack_id": null,
    "timestamp": "2026-11-18T09:15:30Z"
  }'
```

### MQTT Topics
- Event Gate: `warehouse/{warehouse_id}/gate/{gate_id}/event`
- Sensor Proximity Mentah: `warehouse/{warehouse_id}/gate/{gate_id}/proximity` (`{"device_id":"PROX-GATE-C-01","gate_id":"GATE-C","sensor":"A"}` lalu `"B"`)
- Heartbeat Perangkat: `warehouse/{warehouse_id}/device/{device_id}/heartbeat`

### Firmware ESP32
1. Buka `firmware/esp32_proximity_gate/esp32_proximity_gate.ino` atau `firmware/esp32_rfid_rc522_pn532/esp32_rfid_rc522_pn532.ino` di Arduino IDE.
2. Instal library `PubSubClient` dan `ArduinoJson` (serta `MFRC522` atau `Adafruit PN532` untuk RFID).
3. Sesuaikan `WIFI_SSID`, `WIFI_PASS`, `MQTT_HOST`, `GATE_ID`, dan `DEVICE_ID`, lalu flash ke board ESP32.
