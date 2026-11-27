# BitVoid Server Desktop Administration Application (Qt 6 / QML)

This directory contains the **native cross-platform desktop administration application** for Windows, Linux, and macOS, built with **C++17 and Qt 6 / QML** (per the approved Phase 1 Architecture Audit).

## Architecture Rules Enforced

- **No browser, no WebView, no Electron, no web admin server:** renders natively via Qt 6 Quick / Controls.
- **Protected local IPC only:** connects to the BitVoid Server background service over `QLocalSocket` using newline-delimited JSON-RPC 2.0. Development and macOS use an owner-only Unix socket (`0600`). The Debian package uses a dedicated `bitvoid-admin` group (`0660` socket, `0640` first-run enrollment file); the installer adds the invoking user when available. Windows uses the `\\\\.\\pipe\\bitvoid-server-admin` named pipe.
- **Independent of background service:** if the background service fails or stops, the desktop app stays responsive, reads disk logs directly via `ServiceController`, and provides Start/Restart/Stop actions via Windows SCM (`sc.exe`), Linux `systemd` (`systemctl`), or macOS `launchd` (`launchctl`).
- **Closing the dashboard does not stop the Server:** explicit Stop Server confirmation is required.
- **No default administrator passwords:** first-run setup requires the single-use local enrollment code. It is owner-only by default; packaged Linux installs grant read access only to the dedicated `bitvoid-admin` group.

## Build Requirements

- CMake 3.21+
- C++17 compiler (MSVC 2022, GCC 11+, or Clang 14+)
- Qt 6.5+ (`Core`, `Gui`, `Widgets`, `Quick`, `QuickControls2`, `Network`)

## Build Commands

```bash
cmake -S desktop -B desktop/build -DCMAKE_BUILD_TYPE=Release
cmake --build desktop/build --config Release
```

Automated cross-platform desktop compilation is configured in `.github/workflows/ci.yml` and `.github/workflows/release.yml`.
