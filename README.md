<p align="center">
  <img src="https://img.shields.io/badge/Barrel-Android_Research_Workbench-e94560?style=for-the-badge" alt="Barrel">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-059669?style=for-the-badge" alt="Platforms">
</p>

---

<p align="center">
  <strong>A lightweight desktop application for Android security research and debugging.</strong><br>
  Integrated shell, real-time logcat, file explorer, process & network inspection, screen capture, and Frida server management — all in one package.
</p>

---

## Features

| Tool | Description |
|------|-------------|
| **Dashboard** | Device detection, wireless ADB pairing, device info viewer, custom command builder |
| **Shell** | Multi-tab interactive terminal (local bash + device adb shell) with xterm.js PTY |
| **Logcat** | Real-time streaming with per-tab filters, level selection, start/stop/clear, export to file |
| **File Explorer** | Collapsible tree view with `su` fallback for protected dirs, pull/push files |
| **Package Manager** | List, filter, install, and uninstall APKs with glass confirmation dialogs |
| **Process Explorer** | Real-time process list with PID/PPID/UID/name, kill support |
| **Network Inspector** | TCP/UDP connection table with color-coded states and protocol badges |
| **Screen Tools** | Screenshot, screen recording, and scrcpy mirroring |
| **Frida Integration** | Version check, arch detection, server download/deploy/start/stop/status |
| **Session Save/Load** | Persist shell + logcat tab configs and per-module device overrides |
| **Custom Commands** | Build and save adb command shortcuts with inline output |
| **Wireless ADB** | Pair and connect over Wi-Fi directly from the UI |
| **Updates** | In-app update checker with download link to releases page |

---

## Quick Start

1. **Connect a device** via USB with USB debugging enabled, or pair wirelessly
2. **Launch Barrel** — it auto-detects connected devices
3. Use the **sidebar** to navigate between tools
4. Each tool has its own device selector for multi-device workflows

### Prerequisites

- **ADB** — Android Debug Bridge (included with Android SDK platform-tools)
- **xz-utils** — for Frida server decompression (Linux: `apt install xz-utils`, macOS: built-in)
- **curl** — for Frida server download
- **scrcpy** (optional) — for screen mirroring
- **Frida** (optional) — `pip install frida-tools` for Frida integration

---

## Installation

### Linux

```bash
# Debian/Ubuntu
sudo dpkg -i Barrel_*.deb

# Fedora
sudo rpm -i Barrel-*.rpm

# Portable (any distro)
chmod +x Barrel_*.AppImage
./Barrel_*.AppImage
```

### macOS

```bash
# Download the .dmg, open it, and drag Barrel to Applications
```

### Windows

```bash
# Run the .msi installer
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Tab` | Next sidebar tab |
| `Ctrl+Shift+Tab` | Previous sidebar tab |

---

## Verifying Downloads

Each release includes `.sig` signature files alongside the installers. To verify:

```bash
# Import the public key
gpg --import barrel-public.key

# Verify a download
gpg --verify Barrel_0.1.0_amd64.deb.sig Barrel_0.1.0_amd64.deb
```

The public key is available on the [documentation site](https://barrel.ppxl.xyz/barrel-public.key).

---

## License

Proprietary — all rights reserved.
