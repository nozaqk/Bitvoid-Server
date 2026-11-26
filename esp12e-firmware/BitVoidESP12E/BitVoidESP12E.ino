#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>
#include <ArduinoJson.h>
#include "config.h"

#if !defined(BITVOID_AP_SSID) || !defined(BITVOID_AP_PASSWORD) || !defined(BITVOID_GATEWAY_ID) || !defined(BITVOID_GATEWAY_NAME) || !defined(BITVOID_PC_SERVER_ID) || !defined(BITVOID_ESP_TRUST_SECRET) || !defined(BITVOID_MAX_CLIENTS)
#error "Create config.h from config.example.h and set all BitVoid gateway credentials."
#endif

ESP8266WebServer server(80);
const IPAddress gatewayIp(192, 168, 4, 1);
const IPAddress subnetMask(255, 255, 255, 0);
const char* gatewayHostname = "bitvoid-gateway";
const char* identityMode = "local-identity-v1";
unsigned long bootMillis = 0;
bool mdnsReady = false;

void sendJson(int status, JsonDocument& doc) {
  String body;
  serializeJson(doc, body);
  server.sendHeader("Cache-Control", "no-store");
  server.sendHeader("X-BitVoid-Server-Id", BITVOID_GATEWAY_ID);
  server.sendHeader("X-BitVoid-Trust-Protocol", "BVT-1");
  server.send(status, "application/json; charset=utf-8", body);
}

bool requireTrustedServer() {
  const String suppliedId = server.header("X-BitVoid-Server-Id");
  const String suppliedKey = server.header("X-BitVoid-Server-Key");
  const String expectedKey = BITVOID_ESP_TRUST_SECRET;
  if (suppliedId == BITVOID_PC_SERVER_ID &&
      suppliedKey.length() == expectedKey.length() &&
      suppliedKey == expectedKey) return true;

  StaticJsonDocument<192> error;
  error["error"] = "server_identity_rejected";
  error["message"] = "A registered server identity and valid server key are required.";
  sendJson(401, error);
  return false;
}

void sendRoot() {
  StaticJsonDocument<256> doc;
  doc["service"] = "BitVoid Gateway";
  doc["role"] = "wifi-ap-and-discovery";
  doc["messagingServer"] = false;
  doc["gatewayIp"] = WiFi.softAPIP().toString();
  doc["health"] = "/api/v1/health";
  doc["discovery"] = "/api/node";
  sendJson(200, doc);
}

void sendHealth() {
  StaticJsonDocument<256> doc;
  doc["ok"] = true;
  doc["status"] = "ready";
  doc["gatewayId"] = BITVOID_GATEWAY_ID;
  doc["ssid"] = BITVOID_AP_SSID;
  doc["ip"] = WiFi.softAPIP().toString();
  doc["clients"] = WiFi.softAPgetStationNum();
  doc["maxClients"] = BITVOID_MAX_CLIENTS;
  doc["uptimeSeconds"] = (millis() - bootMillis) / 1000;
  doc["freeHeapBytes"] = ESP.getFreeHeap();
  sendJson(200, doc);
}

void sendGatewayInfo() {
  StaticJsonDocument<768> doc;
  doc["service"] = "bitvoid";
  doc["gatewayId"] = BITVOID_GATEWAY_ID;
  doc["displayName"] = BITVOID_GATEWAY_NAME;
  doc["ssid"] = BITVOID_AP_SSID;
  doc["ip"] = WiFi.softAPIP().toString();

  JsonObject hardware = doc.createNestedObject("hardware");
  hardware["family"] = "esp8266";
  hardware["model"] = "esp-12e";

  JsonObject protocol = doc.createNestedObject("protocol");
  protocol["name"] = "bitvoid-gateway";
  protocol["major"] = 1;
  protocol["minor"] = 0;

  JsonObject identity = doc.createNestedObject("identity");
  identity["mode"] = identityMode;
  identity["verified"] = false;

  JsonArray caps = doc.createNestedArray("capabilities");
  caps.add("wifi-ap");
  caps.add("discovery");
  caps.add("health");

  JsonObject limits = doc.createNestedObject("limits");
  limits["maxClients"] = BITVOID_MAX_CLIENTS;

  JsonObject links = doc.createNestedObject("links");
  links["health"] = "/api/v1/health";
  links["services"] = "/api/v1/services";
  links["devices"] = "/api/v1/devices";
  sendJson(200, doc);
}

void sendServices() {
  StaticJsonDocument<384> doc;
  JsonArray services = doc.createNestedArray("services");
  JsonObject ap = services.createNestedObject();
  ap["id"] = "wifi-ap";
  ap["available"] = true;
  JsonObject discovery = services.createNestedObject();
  discovery["id"] = "discovery";
  discovery["available"] = true;
  JsonObject health = services.createNestedObject();
  health["id"] = "health";
  health["available"] = true;
  JsonObject messaging = services.createNestedObject();
  messaging["id"] = "messaging";
  messaging["available"] = false;
  sendJson(200, doc);
}

void sendDevices() {
  StaticJsonDocument<256> doc;
  JsonArray devices = doc.createNestedArray("devices");
  const uint8_t count = WiFi.softAPgetStationNum();
  for (uint8_t i = 0; i < count && i < BITVOID_MAX_CLIENTS; ++i) {
    JsonObject item = devices.createNestedObject();
    item["connected"] = true;
    item["index"] = i + 1;
  }
  doc["count"] = count;
  doc["maxClients"] = BITVOID_MAX_CLIENTS;
  sendJson(200, doc);
}

void sendInternalStatus() {
  if (!requireTrustedServer()) return;

  StaticJsonDocument<512> doc;
  doc["status"] = "online";
  doc["gatewayId"] = BITVOID_GATEWAY_ID;
  doc["hostname"] = "bitvoid-gateway.local";
  doc["ssid"] = BITVOID_AP_SSID;
  doc["ip"] = WiFi.softAPIP().toString();
  doc["mac"] = WiFi.softAPmacAddress();
  doc["clients"] = WiFi.softAPgetStationNum();
  doc["maxClients"] = BITVOID_MAX_CLIENTS;
  doc["uptimeSeconds"] = (millis() - bootMillis) / 1000;
  doc["freeHeapBytes"] = ESP.getFreeHeap();
  doc["chipId"] = String(ESP.getChipId(), HEX);
  doc["flashBytes"] = ESP.getFlashChipRealSize();
  doc["coreVersion"] = ESP.getCoreVersion();
  sendJson(200, doc);
}

void sendNodeIdentity() {
  StaticJsonDocument<384> doc;
  doc["service"] = "bitvoid";
  doc["nodeId"] = BITVOID_GATEWAY_ID;
  doc["nodeType"] = "esp8266-access-point";
  doc["protocolVersion"] = 2;
  doc["coordinator"] = true;
  doc["portalAvailable"] = false;
  doc["messagingServer"] = false;
  server.sendHeader("X-BitVoid-Node", "1");
  server.sendHeader("X-BitVoid-Protocol", "2");
  server.sendHeader("X-BitVoid-Identity", identityMode);
  sendJson(200, doc);
}

void sendNotImplemented() {
  StaticJsonDocument<192> doc;
  doc["error"] = "not_implemented";
  doc["message"] = "The gateway provides Wi-Fi and discovery only. Run BitVoid application services on the server.";
  sendJson(501, doc);
}

void sendNotFound() {
  StaticJsonDocument<160> doc;
  doc["error"] = "not_found";
  doc["message"] = "Unknown BitVoid gateway endpoint.";
  sendJson(404, doc);
}

void setupRoutes() {
  server.on("/", HTTP_GET, sendRoot);
  server.on("/api/node", HTTP_GET, sendNodeIdentity);
  server.on("/api/v1/gateway/info", HTTP_GET, sendGatewayInfo);
  server.on("/api/v1/health", HTTP_GET, sendHealth);
  server.on("/health", HTTP_GET, sendHealth);
  server.on("/api/v1/services", HTTP_GET, sendServices);
  server.on("/api/v1/devices", HTTP_GET, sendDevices);
  server.on("/api/v1/internal/status", HTTP_GET, sendInternalStatus);

  // The gateway must never impersonate the application server.
  server.on("/api/v1/pairing/request", HTTP_POST, sendNotImplemented);
  server.on("/api/v1/pairing/approve", HTTP_POST, sendNotImplemented);
  server.onNotFound(sendNotFound);
}

void fatalError(const __FlashStringHelper* message) {
  Serial.println();
  Serial.print(F("FATAL: "));
  Serial.println(message);
  Serial.println(F("Correct config.h or power/wiring, then reset the ESP."));
  while (true) delay(1000);
}

void setup() {
  Serial.begin(115200);
  delay(250);
  Serial.println();
  Serial.println(F("===================================="));
  Serial.println(F(" BitVoid Gateway Test Build"));
  Serial.println(F("===================================="));

  bootMillis = millis();

  const String password = BITVOID_AP_PASSWORD;
  const String trustSecret = BITVOID_ESP_TRUST_SECRET;
  if (password.length() < 8 || password.length() > 63 ||
      password == "CHANGE_ME_12345") {
    fatalError(F("Set BITVOID_AP_PASSWORD in config.h (8-63 characters)."));
  }
  if (trustSecret.length() < 32 || trustSecret.startsWith("REPLACE_")) {
    fatalError(F("Set a unique 32+ character BITVOID_ESP_TRUST_SECRET in config.h."));
  }
  if (String(BITVOID_GATEWAY_ID).length() < 3 ||
      String(BITVOID_PC_SERVER_ID).length() < 3) {
    fatalError(F("Set valid gateway and server IDs in config.h."));
  }
  if (BITVOID_MAX_CLIENTS < 1 || BITVOID_MAX_CLIENTS > 8) {
    fatalError(F("BITVOID_MAX_CLIENTS must be between 1 and 8."));
  }

  WiFi.persistent(false);
  WiFi.mode(WIFI_AP);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);

  Serial.print(F("Configuring gateway IP ... "));
  if (!WiFi.softAPConfig(gatewayIp, gatewayIp, subnetMask)) {
    fatalError(F("WiFi.softAPConfig failed."));
  }
  Serial.println(F("OK"));

  Serial.print(F("Starting WPA2 access point ... "));
  if (!WiFi.softAP(BITVOID_AP_SSID, BITVOID_AP_PASSWORD, 1, false, BITVOID_MAX_CLIENTS)) {
    fatalError(F("WiFi.softAP failed. Check the 3.3V supply and credentials."));
  }
  Serial.println(F("OK"));

  mdnsReady = MDNS.begin(gatewayHostname);
  if (mdnsReady) {
    MDNS.addService("http", "tcp", 80);
    Serial.println(F("mDNS: bitvoid-gateway.local"));
  } else {
    Serial.println(F("WARNING: mDNS unavailable; use http://192.168.4.1"));
  }

  // ESP8266WebServer 3.1.2 uses a variadic String-compatible API here.
  server.collectHeaders("X-BitVoid-Server-Id", "X-BitVoid-Server-Key");
  setupRoutes();
  server.begin();

  Serial.println();
  Serial.println(F("GATEWAY READY"));
  Serial.print(F("SSID: ")); Serial.println(BITVOID_AP_SSID);
  Serial.print(F("Gateway: http://")); Serial.println(WiFi.softAPIP());
  Serial.print(F("Health: http://")); Serial.print(WiFi.softAPIP()); Serial.println(F("/api/v1/health"));
  Serial.print(F("Discovery: http://")); Serial.print(WiFi.softAPIP()); Serial.println(F("/api/node"));
  Serial.print(F("Max clients: ")); Serial.println(BITVOID_MAX_CLIENTS);
  Serial.println(F("Role: Wi-Fi AP + discovery + health only"));
  Serial.println(F("Messaging service: application server (TCP 8787)"));
  Serial.println(F("Connect the server and phone to this Wi-Fi for the next test."));
}

void loop() {
  server.handleClient();
  if (mdnsReady) MDNS.update();
  yield();
}
