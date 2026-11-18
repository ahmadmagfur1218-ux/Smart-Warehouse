/**
 * Smart Warehouse Inventory — ESP32 Dual-Sensor Proximity Gate Controller
 *
 * Detects movement direction using 2 sequential IR / Ultrasonic beam sensors:
 *   - Sensor A (outer) triggered, then Sensor B (inner) => direction = "IN"
 *   - Sensor B (inner) triggered, then Sensor A (outer) => direction = "OUT"
 *
 * Publishes standard JSON event + heartbeat to Mosquitto MQTT broker.
 * Libraries required (Arduino Library Manager):
 *   - PubSubClient by Nick O'Leary
 *   - ArduinoJson by Benoit Blanchon (v7+)
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// --- WiFi & MQTT Config ---
const char* WIFI_SSID     = "YOUR_WAREHOUSE_WIFI";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* MQTT_HOST     = "192.168.1.50";
const int   MQTT_PORT     = 1883;
const char* MQTT_USER     = "warehouse_iot";
const char* MQTT_PASS     = "iot_broker_password";

// --- Warehouse & Device Identity ---
const char* WAREHOUSE_ID  = "WH-JKT-01";
const char* GATE_ID       = "GATE-C";
const char* DEVICE_ID     = "PROX-GATE-C-01";
const char* DEFAULT_SKU   = "SKU-CLD-013"; // Optional fallback SKU for conveyor lane

// --- Hardware Pins (IR Break-beam / Digital Proximity Output, LOW = object detected) ---
const int PIN_SENSOR_A = 32; // Outer dock side
const int PIN_SENSOR_B = 33; // Inner warehouse side
const int PIN_LED_STATUS = 2;

// --- Timing Constants ---
const unsigned long SEQUENCE_TIMEOUT_MS = 3500;
const unsigned long DEBOUNCE_MS         = 600;
const unsigned long HEARTBEAT_INTERVAL  = 20000;

WiFiClient espClient;
PubSubClient mqtt(espClient);

enum SeqState { IDLE, WAIT_B_FOR_IN, WAIT_A_FOR_OUT };
SeqState seqState = IDLE;
unsigned long seqStartTime = 0;
unsigned long lastTriggerA = 0;
unsigned long lastTriggerB = 0;
unsigned long lastHeartbeat = 0;

bool prevA = HIGH;
bool prevB = HIGH;

String generateEventId() {
  uint32_t r1 = esp_random();
  uint32_t r2 = esp_random();
  char buf[40];
  snprintf(buf, sizeof(buf), "esp32-%08lx-%08lx", (unsigned long)r1, (unsigned long)r2);
  return String(buf);
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println(" connected: " + WiFi.localIP().toString());
}

void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("Connecting MQTT...");
    if (mqtt.connect(DEVICE_ID, MQTT_USER, MQTT_PASS)) {
      Serial.println("connected");
    } else {
      Serial.printf("failed rc=%d, retrying in 2s\n", mqtt.state());
      delay(2000);
    }
  }
}

void publishEvent(const char* direction) {
  char topic[128];
  snprintf(topic, sizeof(topic), "warehouse/%s/gate/%s/event", WAREHOUSE_ID, GATE_ID);

  JsonDocument doc;
  doc["event_id"]    = generateEventId();
  doc["device_id"]   = DEVICE_ID;
  doc["gate_id"]     = GATE_ID;
  doc["source"]      = "PROXIMITY";
  doc["direction"]   = direction;
  doc["tag_or_code"] = DEFAULT_SKU;
  doc["quantity"]    = 1;
  doc["rack_id"]     = nullptr;
  doc["timestamp"]   = ""; // Server stamps UTC if empty, or attach NTP ISO-8601

  char payload[384];
  serializeJson(doc, payload);
  mqtt.publish(topic, payload, true);
  Serial.printf("[EVENT] %s -> %s\n", topic, payload);

  digitalWrite(PIN_LED_STATUS, HIGH);
  delay(80);
  digitalWrite(PIN_LED_STATUS, LOW);
}

void publishHeartbeat() {
  char topic[128];
  snprintf(topic, sizeof(topic), "warehouse/%s/device/%s/heartbeat", WAREHOUSE_ID, DEVICE_ID);

  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["uptime_ms"] = millis();
  doc["rssi"]      = WiFi.RSSI();
  doc["firmware"]  = "v3.1.0";

  char payload[192];
  serializeJson(doc, payload);
  mqtt.publish(topic, payload);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_SENSOR_A, INPUT_PULLUP);
  pinMode(PIN_SENSOR_B, INPUT_PULLUP);
  pinMode(PIN_LED_STATUS, OUTPUT);

  connectWiFi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
}

void loop() {
  connectWiFi();
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  unsigned long now = millis();

  // Timeout incomplete A->B or B->A crossing
  if (seqState != IDLE && (now - seqStartTime > SEQUENCE_TIMEOUT_MS)) {
    seqState = IDLE;
  }

  bool currA = digitalRead(PIN_SENSOR_A);
  bool currB = digitalRead(PIN_SENSOR_B);

  // Falling edge on Sensor A (object entered beam A)
  if (prevA == HIGH && currA == LOW && (now - lastTriggerA > DEBOUNCE_MS)) {
    lastTriggerA = now;
    if (seqState == IDLE) {
      seqState = WAIT_B_FOR_IN;
      seqStartTime = now;
    } else if (seqState == WAIT_A_FOR_OUT) {
      publishEvent("OUT");
      seqState = IDLE;
    }
  }

  // Falling edge on Sensor B (object entered beam B)
  if (prevB == HIGH && currB == LOW && (now - lastTriggerB > DEBOUNCE_MS)) {
    lastTriggerB = now;
    if (seqState == IDLE) {
      seqState = WAIT_A_FOR_OUT;
      seqStartTime = now;
    } else if (seqState == WAIT_B_FOR_IN) {
      publishEvent("IN");
      seqState = IDLE;
    }
  }

  prevA = currA;
  prevB = currB;

  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = now;
    publishHeartbeat();
  }

  delay(15);
}
