# BitVoid Server

BitVoid's server repository is being expanded into a browser-first audio communication architecture with cloud identity and a campus-local service.

## New cloud foundation

- `cloud-backend/`: Render-deployable Fastify API with PostgreSQL account storage, authentication, profile endpoints, device registration, versioned data-sync primitives, and WebSocket signaling relay.
- `cloud-backend/web/`: lightweight sign-in/create-account portal prototype.
- `cloud-backend/render.yaml`: Render Blueprint template.
- `local-backend/` (planned next): campus server designed to keep data locally and synchronize with cloud whenever connectivity is available.
- `gateway/` (planned): microcontroller gateway firmware and lightweight captive web view. ESP-12E is not capable of hosting the full application backend or WebRTC stack.

## Architecture vision

Campus devices use the local backend and campus LAN without requiring internet for local operations. User account/data sync happens in the background when cloud access exists. Outside campus, users authenticate against the cloud account store and access cloud services.

Local registration during an outage should be queued for cloud account reconciliation. Conflict policy and identity security must be finalized before local/cloud sync is enabled.

## Existing components

The original PC-server and ESP12E gateway code are retained in their existing folders. The redesign is staged in a separate branch and must not be confused with a complete, validated replacement.

## Cloud deploy

See cloud-backend/README.md. Deployment has not yet occurred; the Render service URL is not established. Do not use the placeholder API URL in the web portal until the service is deployed.

## Current cloud milestone limitations

No completed WebRTC browser client, TURN service, account email verification, password reset, secure call ticketing, end-to-end encryption, robust sync reconciliation, or physical offline-campus test yet. Cloud API source has not been run in a test environment.
