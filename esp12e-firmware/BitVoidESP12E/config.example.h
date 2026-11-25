#pragma once
// Copy to config.h and edit before upload. Never commit config.h.
#define BITVOID_AP_SSID "BitVoid_Local"
#define BITVOID_AP_PASSWORD "CHANGE_ME_12345"
#define BITVOID_GATEWAY_ID "bv-esp12e-gateway-001"
#define BITVOID_GATEWAY_NAME "BitVoid ESP-12E WiFi"
#define BITVOID_MAX_CLIENTS 4

// Authorized PC server identity and private key (must match the PC server .env).
// Keep the secret private. Use the same 32+ character random value in the PC server .env and this ESP config.
#define BITVOID_PC_SERVER_ID "bv-pc-server-001"
#define BITVOID_ESP_TRUST_SECRET "REPLACE_WITH_A_UNIQUE_ESP_TRUST_SECRET"

// Independent ESP gateway dashboard credentials (HTTP Basic Authentication).
// Use a unique username and a password of at least 12 characters.
#define BITVOID_ADMIN_USERNAME "admin"
#define BITVOID_ADMIN_PASSWORD "CHANGE_THIS_ADMIN_PASSWORD"
