#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>
#include <ArduinoJson.h>
#include "config.h"

#if !defined(BITVOID_AP_SSID) || !defined(BITVOID_AP_PASSWORD) || !defined(BITVOID_GATEWAY_ID) || !defined(BITVOID_PC_SERVER_ID) || !defined(BITVOID_ESP_TRUST_SECRET) || !defined(BITVOID_ADMIN_USERNAME) || !defined(BITVOID_ADMIN_PASSWORD)
#error "Create config.h from config.example.h and set Wi-Fi and dashboard credentials."
#endif

ESP8266WebServer server(80);
const IPAddress gatewayIp(192, 168, 4, 1);
const IPAddress subnetMask(255, 255, 255, 0);
const char* identityMode = "local-identity-v1";
const char* dashboardHostname = "esp-server.local";
unsigned long bootMillis = 0;

const char ADMIN_PAGE[] PROGMEM = R"rawliteral(
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#090d18"><title>BitVoid · ESP Gateway</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui,Segoe UI,sans-serif;background:#090d18;color:#e8edf8}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,#142746 0,transparent 34%),#090d18;min-height:100vh}.wrap{max-width:1050px;margin:auto;padding:32px 20px}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:28px}.brand{font-weight:800;letter-spacing:.08em}.tag{font-size:12px;color:#9fb0c9;border:1px solid #263751;border-radius:99px;padding:7px 11px}.eyebrow{color:#68d9bd;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}h1{font-size:clamp(28px,5vw,42px);margin:8px 0}p{color:#9eacc2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:24px 0}.card{background:#111a2b;border:1px solid #24334b;border-radius:16px;padding:20px;min-height:112px}.label{color:#93a5bf;font-size:12px;text-transform:uppercase;letter-spacing:.08em}.value{font-size:25px;font-weight:750;margin-top:12px;overflow-wrap:anywhere}.wide{grid-column:1/-1}.rows{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #24334b;color:#aab8cc}.row strong{color:#edf3ff;text-align:right;overflow-wrap:anywhere}.status{color:#68d9bd}.foot{font-size:12px;margin-top:24px;color:#7587a1}button{background:#183d43;color:#8ef0d5;border:1px solid #27645d;padding:9px 13px;border-radius:10px}
</style></head><body><main class="wrap"><div class="top"><div class="brand">BITVOID / GATEWAY</div><div class="tag">ESP-12E · ADMIN</div></div>
<div class="eyebrow">Network control plane</div><h1>ESP Gateway Dashboard</h1><p>Live diagnostics for the BitVoid Wi-Fi access point. This dashboard is independent of the PC application server.</p>
<div class="grid"><section class="card"><div class="label">Gateway status</div><div class="value status" id="status">Checking…</div></section><section class="card"><div class="label">Connected clients</div><div class="value" id="clients">—</div></section><section class="card"><div class="label">Uptime</div><div class="value" id="uptime">—</div></section><section class="card"><div class="label">Free heap</div><div class="value" id="heap">—</div></section>
<section class="card wide"><div class="label">Gateway information</div><div class="rows" id="details"></div></section></div>
<button id="refresh">Refresh status</button><div class="foot">Auto-refreshes every 5 seconds · Local network only · Never share your administrator credentials.</div></main>
<script>
const el=id=>document.getElementById(id);function duration(s){s=Number(s)||0;const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),sec=s%60;return (d?d+'d ':'')+h+'h '+m+'m '+sec+'s'}
async function refresh(){try{const r=await fetch('/admin/api/status',{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();el('status').textContent=d.status;el('clients').textContent=d.clients+' / '+d.maxClients;el('uptime').textContent=duration(d.uptimeSeconds);el('heap').textContent=(d.freeHeapBytes/1024).toFixed(1)+' KB';const pairs=[['Gateway ID',d.gatewayId],['Hostname',d.hostname],['Access point SSID',d.ssid],['Gateway address',d.ip],['MAC address',d.mac],['Chip ID',d.chipId],['Flash size',d.flashBytes.toLocaleString()+' bytes'],['ESP8266 core',d.coreVersion]];el('details').innerHTML=pairs.map(([k,v])=>'<div class="row"><span>'+k+'</span><strong>'+String(v)+'</strong></div>').join('')}catch(e){el('status').textContent='Unavailable';console.error(e)}}
el('refresh').addEventListener('click',refresh);refresh();setInterval(refresh,5000);
</script></body></html>
)rawliteral";

void sendJson(int status, JsonDocument& doc) {
  String body;
  serializeJson(doc, body);
  server.sendHeader("Cache-Control", "no-store");
  server.sendHeader("X-BitVoid-Server-Id", BITVOID_GATEWAY_ID);
  server.sendHeader("X-BitVoid-Protocol", "BVT-1");
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(status, "application/json; charset=utf-8", body);
}

bool requireAdmin() {
  if (server.authenticate(BITVOID_ADMIN_USERNAME, BITVOID_ADMIN_PASSWORD)) return true;
  server.requestAuthentication(BASIC_AUTH, "BitVoid ESP Gateway Admin");
  return false;
}

void sendAdminStatus() {
  if (!requireAdmin()) return;
  StaticJsonDocument<512> doc;
  doc["status"] = "online";
  doc["gatewayId"] = BITVOID_GATEWAY_ID;
  doc["hostname"] = dashboardHostname;
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

bool requireTrustedPcServer() {
  String suppliedId = server.header("X-BitVoid-Server-Id");
  String suppliedKey = server.header("X-BitVoid-Server-Key");
  if (suppliedId == BITVOID_PC_SERVER_ID && suppliedKey.length() == String(BITVOID_PC_SERVER_SECRET).length() &&
      suppliedKey == BITVOID_PC_SERVER_SECRET) return true;
  StaticJsonDocument<160> error;
  error["error"] = "server_identity_rejected";
  error["message"] = "A registered PC server identity and valid server key are required.";
  sendJson(401, error);
  return false;
}

void sendInternalStatus() {
  if (!requireTrustedPcServer()) return;
  StaticJsonDocument<512> doc;
  doc["status"] = "online";
  doc["gatewayId"] = BITVOID_GATEWAY_ID;
  doc["hostname"] = dashboardHostname;
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
  server.on("/",HTTP_GET,[](){ server.send(200,"text/plain; charset=utf-8","BitVoid ESP-12E Wi-Fi gateway is online. Admin dashboard: http://esp-server.local/admin"); });
  server.on("/admin",HTTP_GET,[](){ if(!requireAdmin())return; server.send_P(200,"text/html; charset=utf-8",ADMIN_PAGE); });
  server.on("/admin/api/status",HTTP_GET,sendAdminStatus);
  server.on("/api/v1/internal/status",HTTP_GET,sendInternalStatus);
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
  String adminPassword=BITVOID_ADMIN_PASSWORD;
  if(password.length()<8 || password.length()>63 || password=="CHANGE_ME_12345") {
    Serial.println("FATAL: Set a unique WPA2 password in config.h (8-63 characters).");
    while(true) delay(1000);
  }
  String pcServerSecret = BITVOID_PC_SERVER_SECRET;
  if (pcServerSecret.length() < 32 || pcServerSecret.startsWith("REPLACE_") ||
      String(BITVOID_PC_SERVER_ID).length() < 3 || String(BITVOID_GATEWAY_ID).length() < 3) {
    Serial.println("FATAL: Configure a valid PC server ID and a unique secret of at least 32 characters in config.h.");
    while(true) delay(1000);
  }
  if(adminPassword.length()<12 || adminPassword=="CHANGE_THIS_ADMIN_PASSWORD") {
    Serial.println("FATAL: Set a unique dashboard password in config.h (at least 12 characters).");
    while(true) delay(1000);
  }
  WiFi.persistent(false);
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(gatewayIp,gatewayIp,subnetMask);
  if(!WiFi.softAP(BITVOID_AP_SSID,BITVOID_AP_PASSWORD,1,false,BITVOID_MAX_CLIENTS)) {
    Serial.println("FATAL: Could not start BitVoid Wi-Fi access point.");
    while(true) delay(1000);
  }
  if (!MDNS.begin("esp-server")) {
    Serial.println("WARNING: Could not start ESP mDNS responder; use the gateway IP as a fallback.");
  } else {
    MDNS.addService("http","tcp",80);
  }
  const char* trustedHeaders[] = {"X-BitVoid-Server-Id", "X-BitVoid-Server-Key"};
  server.collectHeaders(trustedHeaders, 2);
  setupRoutes();
  server.begin();
  Serial.println();
  Serial.println("BitVoid ESP-12E Gateway API v1");
  Serial.print("Wi-Fi SSID: "); Serial.println(BITVOID_AP_SSID);
  Serial.print("Gateway IP: "); Serial.println(WiFi.softAPIP());
  Serial.print("Max clients: "); Serial.println(BITVOID_MAX_CLIENTS);
  Serial.println("ESP admin dashboard: http://esp-server.local/admin");
  Serial.println("Fallback dashboard: http://192.168.4.1/admin");
  Serial.println("Gateway info: http://192.168.4.1/api/v1/gateway/info");
  Serial.println("Connect the PC to this Wi-Fi, then run pc-server.");
}

void loop() {
  server.handleClient();
  MDNS.update();
  yield();
}
