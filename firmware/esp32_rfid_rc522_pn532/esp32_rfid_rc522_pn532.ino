/**
 * Smart Warehouse Inventory — ESP32 RFID Reader (RC522 / PN532) MQTT Publisher
 *
 * Reads RFID UID/EPC and publishes standard JSON movement event + heartbeat to MQTT.
 * Toggle USE_PN532 to switch between MFRC522 (SPI) and Adafruit PN532 (I2C/SPI).
 *
 * Libraries required:
 *   - MFRC522 by GithubCommunity (when USE_PN532 == 0)
 *   - Adafruit PN532 (when USE_PN532 == 1)
 *   - PubSubClient by Nick O'Leary
 *   - ArduinoJson by Benoit Blanchon (v7+)
 */

#define USE_PN532 0

#include <WiFi.h>
#include <SPI.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

#if USE_PN532
  #include <Wire.h>
  #include <Adafruit_PN532.h>
  #define PN532_IRQ   4
  #define PN532_RESET 5
  Adafruit_PN532 nfc(PN532_IRQ, PN532_RESET);
#else
  #include <MFRC522.h>
  #define SS_PIN  5
  #define RST_PIN 22
  MFRC522 mfrc522(SS_PIN, RST_PIN);
#endif

// --- WiFi & MQTT Config ---
const char* WIFI_SSID     = "YOUR_WAREHOUSE_WIFI";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* MQTT_HOST     = "192.168.1.50";
const int   MQTT_PORT     = 1883;
const char* MQTT_USER     = "warehouse_iot";
const char* MQTT_PASS     = "iot_broker_password";

// --- Warehouse & Gate Identity ---
const char* WAREHOUSE_ID  = "WH-JKT-01";
const char* GATE_ID       = "GATE-A";
const char* DEVICE_ID     = "RFID-GATE-A-01";
const char* DIRECTION     = "IN"; // IN for Inbound Gate A, OUT for Outbound Gate B

// --- Local Debounce ---
const unsigned long TAG_DEBOUNCE_MS    = 5000;
const unsigned long HEARTBEAT_INTERVAL = 20000;

WiFiClient espClient;
PubSubClient mqtt(espClient);

String lastTag = "";
unsigned long lastTagTime = 0;
unsigned long lastHeartbeat = 0;

String generateEventId() {
  char buf[40];
  snprintf(buf, sizeof(buf), "rfid-%08lx-%08lx", (unsigned long)esp_random(), (unsigned long)esp_random());
  return String(buf);
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
}

void connectMQTT() {
  while (!mqtt.connected()) {
    if (mqtt.connect(DEVICE_ID, MQTT_USER, MQTT_PASS)) {
      Serial.println("MQTT connected");
    } else {
      delay(2000);
    }
  }
}

void publishTagEvent(const String& tagHex) {
  unsigned long now = millis();
  if (tagHex == lastTag && (now - lastTagTime < TAG_DEBOUNCE_MS)) {
    return; // Local debounce filter
  }
  lastTag = tagHex;
  lastTagTime = now;

  char topic[128];
  snprintf(topic, sizeof(topic), "warehouse/%s/gate/%s/event", WAREHOUSE_ID, GATE_ID);

  JsonDocument doc;
  doc["event_id"]    = generateEventId();
  doc["device_id"]   = DEVICE_ID;
  doc["gate_id"]     = GATE_ID;
  doc["source"]      = "RFID";
  doc["direction"]   = DIRECTION;
  doc["tag_or_code"] = tagHex;
  doc["quantity"]    = 1;
  doc["rack_id"]     = nullptr;
  doc["timestamp"]   = "";

  char payload[384];
  serializeJson(doc, payload);
  mqtt.publish(topic, payload, true);
  Serial.printf("[RFID] Published %s -> %s\n", topic, payload);
}

void publishHeartbeat() {
  char topic[128];
  snprintf(topic, sizeof(topic), "warehouse/%s/device/%s/heartbeat", WAREHOUSE_ID, DEVICE_ID);

  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["uptime_ms"] = millis();
  doc["rssi"]      = WiFi.RSSI();
  doc["firmware"]  = "v2.4.1";

  char payload[192];
  serializeJson(doc, payload);
  mqtt.publish(topic, payload);
}

void setup() {
  Serial.begin(115200);
  connectWiFi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);

#if USE_PN532
  nfc.begin();
  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    Serial.println("PN532 not detected!");
  }
  nfc.SAMConfig();
#else
  SPI.begin();
  mfrc522.PCD_Init();
  Serial.println("RC522 initialized");
#endif
}

void loop() {
  connectWiFi();
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

#if USE_PN532
  uint8_t uid[7] = { 0 };
  uint8_t uidLength = 0;
  if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 50)) {
    String tagHex = "";
    for (uint8_t i = 0; i < uidLength; i++) {
      if (uid[i] < 0x10) tagHex += "0";
      tagHex += String(uid[i], HEX);
    }
    tagHex.toUpperCase();
    publishTagEvent(tagHex);
  }
#else
  if (mfrc522.PICC_IsNewCardPresent() && mfrc522.PICC_ReadCardSerial()) {
    String tagHex = "";
    for (byte i = 0; i < mfrc522.uid.size; i++) {
      if (mfrc522.uid.uidByte[i] < 0x10) tagHex += "0";
      tagHex += String(mfrc522.uid.uidByte[i], HEX);
    }
    tagHex.toUpperCase();
    publishTagEvent(tagHex);
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
  }
#endif

  unsigned long now = millis();
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = now;
    publishHeartbeat();
  }
}
