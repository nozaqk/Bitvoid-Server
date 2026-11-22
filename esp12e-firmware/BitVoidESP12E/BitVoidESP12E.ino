#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>
#include <ArduinoJson.h>
#include "config.h"

#if !defined(BITVOID_AP_SSID) || !defined(BITVOID_AP_PASSWORD) || !defined(BITVOID_GATEWAY_ID)
#error "Create config.h from config.example.h and set gateway credentials."
#endif

ESP8266WebServer server(80);
const IPAddress gatewayIp(192, 168, 4, 1);
const IPAddress subnetMask(255, 255, 255, 0);
const char* identityMode = "local-identity-v1";
unsigned long bootMillis = 0;

void sendJson(int status, JsonDocument& doc) {
  String body;
  serializeJson(doc, body);
  server.sendHeader("Cache-Control", "no-store");
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(status, "application/json; charset=utf-8", body);
}

void sendGatewayInfo() {
  StaticJsonDocument<768> doc;
  doc["service"] = "bitvoid";
  doc["gatewayId"] = BITVOID_GATEWAY_ID;
  doc["displayName"] = BITVOID_GATEWAY_NAME;
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
  caps.add("wifi-ap"); caps.add("discovery"); caps.add("health");
  JsonObject limits = doc.createNestedObject("limits");
  limits["maxClients"] = BITVOID_MAX_CLIENTS;
  JsonObject links = doc.createNestedObject("links");
  links["health"] = "/api/v1/health";
  links["services"] = "/api/v1/services";
  sendJson(200, doc);
}

void sendHealth() {
  StaticJsonDocument<192> doc;
  doc["ok"] = true;
  doc["status"] = "ready";
  doc["uptimeSeconds"] = (millis() - bootMillis) / 1000;
  doc["freeHeapBytes"] = ESP.getFreeHeap();
  sendJson(200, doc);
}

void sendServices() {
  StaticJsonDocument<384> doc;
  JsonArray services = doc.createNestedArray("services");
  JsonObject ap = services.createNestedObject(); ap["id"]="wifi-ap"; ap["available"]=true;
  JsonObject discovery = services.createNestedObject(); discovery["id"]="discovery"; discovery["available"]=true;
  JsonObject health = services.createNestedObject(); health["id"]="health"; health["available"]=true;
  JsonObject messaging = services.createNestedObject(); messaging["id"]="messaging"; messaging["available"]=false;
  sendJson(200, doc);
}

void sendDevices() {
  StaticJsonDocument<256> doc;
  JsonArray devices = doc.createNestedArray("devices");
  uint8_t count = WiFi.softAPgetStationNum();
  for (uint8_t i=0; i<count && i<BITVOID_MAX_CLIENTS; i++) {
    JsonObject item = devices.createNestedObject();
    item["connected"] = true;
    item["index"] = i+1;
  }
  sendJson(200, doc);
}

void sendNodeIdentity() {
  server.sendHeader("X-BitVoid-Node","1");
  server.sendHeader("X-BitVoid-Protocol","2");
  server.sendHeader("X-BitVoid-Identity",identityMode);
  StaticJsonDocument<384> doc;
  doc["service"]="bitvoid"; doc["nodeId"]=BITVOID_GATEWAY_ID;
  doc["nodeType"]="esp8266-access-point"; doc["protocolVersion"]=2;
  doc["coordinator"]=true; doc["portalAvailable"]=false;
  sendJson(200,doc);
}

void sendNotImplemented() {
  StaticJsonDocument<160> doc;
  doc["error"]="not_implemented";
  doc["message"]="ESP-12E provides Wi-Fi and discovery only. Run BitVoid application services on the PC.";
  sendJson(501,doc);
}

void setupRoutes() {
  server.on("/",HTTP_GET,[](){ server.send(200,"text/plain; charset=utf-8","BitVoid ESP-12E Wi-Fi gateway is online. Connect your PC and clients to this Wi-Fi."); });
  server.on("/api/node",HTTP_GET,sendNodeIdentity);
  server.on("/api/v1/gateway/info",HTTP_GET,sendGatewayInfo);
  server.on("/api/v1/health",HTTP_GET,sendHealth);
  server.on("/health",HTTP_GET,sendHealth);
  server.on("/api/v1/services",HTTP_GET,sendServices);
  server.on("/api/v1/devices",HTTP_GET,sendDevices);
  server.on("/api/v1/pairing/request",HTTP_POST,sendNotImplemented);
  server.on("/api/v1/pairing/approve",HTTP_POST,sendNotImplemented);
  server.onNotFound([](){
    StaticJsonDocument<128> doc; doc["error"]="not_found"; sendJson(404,doc);
  });
}

void setup() {
  Serial.begin(115200);
  delay(150);
  bootMillis=millis();
  String password=BITVOID_AP_PASSWORD;
  if(password.length()<8 || password.length()>63 || password=="CHANGE_ME_12345") {
    Serial.println("FATAL: Set a unique WPA2 password in config.h (8-63 characters).");
    while(true) delay(1000);
  }
  WiFi.persistent(false);
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(gatewayIp,gatewayIp,subnetMask);
  if(!WiFi.softAP(BITVOID_AP_SSID,BITVOID_AP_PASSWORD,1,false,BITVOID_MAX_CLIENTS)) {
    Serial.println("FATAL: Could not start BitVoid Wi-Fi access point.");
    while(true) delay(1000);
  }
  MDNS.begin("bitvoid");
  MDNS.addService("http","tcp",80);
  setupRoutes();
  server.begin();
  Serial.println();
  Serial.println("BitVoid ESP-12E Gateway API v1");
  Serial.print("Wi-Fi SSID: "); Serial.println(BITVOID_AP_SSID);
  Serial.print("Gateway IP: "); Serial.println(WiFi.softAPIP());
  Serial.print("Max clients: "); Serial.println(BITVOID_MAX_CLIENTS);
  Serial.println("Gateway info: http://192.168.4.1/api/v1/gateway/info");
  Serial.println("Connect the PC to this Wi-Fi, then run pc-server.");
}

void loop() {
  server.handleClient();
  MDNS.update();
  yield();
}
