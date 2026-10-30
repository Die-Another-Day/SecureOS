# SecureOS v3 — a real OS, now with the basics every OS has + GUI on demand

v3 keeps everything v2 proved (Debian 12 bookworm, real kernel, GRUB BIOS,
systemd, console on http://127.0.0.1:8000 only, real nmap/hash/logs,
localhost + RFC1918 scans only, SSH masked) and adds the systems a real
OS is expected to have — plus the main new feature: a GUI you start
with a command, exactly like WSL's `kex`.

## The main feature: GUI on demand

**Default boot is unchanged: CLI + web console.** Booting with
`./run-qemu.sh` still lands you at a `secureos login:` prompt, and the
web console still runs on http://127.0.0.1:8000. That web interface is
exceptional and stays.

**To start the GUI, inside the guest run:**
```bash
secureos-gui              # XFCE desktop, windowed (default)
secureos-gui --fullscreen # XFCE, largest mode via xrandr on session start
secureos-gui --stop       # stop Xorg/XFCE, back to CLI
secureos-gui --help
```

**To see the GUI from the host, boot with a graphical display:**
```bash
./run-qemu-gui.sh secureos-v3.img 2048
# log in as analyst / secure, then run: secureos-gui
```
`run-qemu-gui.sh` uses `-display gtk` (or `SECUREOS_DISPLAY=sdl` /
`vnc=:1`), 2048 MB RAM, std VGA. The old `./run-qemu.sh` is still
`-nographic` CLI-only and is untouched.

GUI stack (lightweight, not a heavy desktop): Xorg + XFCE core
(xfce4, xfce4-panel, Thunar file manager, xfce4-terminal,
xfce4-taskmanager, xfce4-power-manager, mousepad). Browser in the GUI:
firefox-esr — chosen because it is Debian's supported ESR browser and
opens the local console reliably; if it ever blows the image past
~5.5 GB, the documented fallback is Openbox + tint2 + pcmanfm (not used
in this build unless the size check says so). GUI session autostart:
panel, nm-applet (network), power manager (battery), and a
"SecureOS Console" launcher that opens http://127.0.0.1:8000 in
firefox-esr. No display manager is enabled on boot — that is deliberate,
so boot stays CLI.

## Basic OS systems (all real, not simulated)

| System | What is real in v3 |
|---|---|
| Filesystem | ext4 root (as v2) + /home/analyst/{Documents,Downloads,Projects,Logs} + Thunar in GUI + `GET /api/files?path=...` allowlisted to /home/analyst and read-only /opt/secureos only — path traversal returns 403, root listing is refused |
| Drivers | pciutils, usbutils, lshw, firmware-linux (non-free-firmware), kmod + `secureos-drivers` (lspci/lsusb/lsmod/lshw) + `GET /api/drivers`. Never claims a driver that is not installed |
| Logging | Persistent systemd journal (/var/log/journal) + `secureos-logs` (journalctl) + `GET /api/logs` (journalctl -n 100 + auth.log/syslog pattern counts) |
| Task manager | htop (CLI) + xfce4-taskmanager (GUI) + `GET /api/processes` (ps, top 25 by CPU) + `GET /api/system` (kernel, load, CPU count, mem, disk, uptime from /proc) |
| Battery | upower + acpi + `GET /api/battery`. **In a VM there is usually NO battery — the API and GUI must say "No battery detected (VM / AC power)", never a faked 100%.** On a real laptop it shows the real upower percentage/state |
| Wi-Fi + Ethernet | NetworkManager + wpasupplicant + wireless-tools + iw + nmcli + nm-applet in GUI, ethernet DHCP automatic (e1000 in QEMU). `secureos-net` shows ip addr + nmcli devices; Wi-Fi scan runs ONLY if a Wi-Fi device actually exists, otherwise it says "No Wi-Fi device detected (VM / wired only)". The v2 scan safety rule is unchanged: nmap API still only localhost + RFC1918 by default |
| Status | `secureos-status` — kernel, console service, GUI state, network, disk, memory, battery in one screen |

## New backend endpoints (v3 server.py, Python stdlib only)

All v2 endpoints are kept intact. New: `GET /api/system`,
`GET /api/processes`, `GET /api/files`, `GET /api/drivers`,
`GET /api/logs`, `GET /api/battery`, `GET /api/network`.
All subprocess calls use argument lists only — never `shell=True`,
never clone/install/arbitrary run. Console wiring is in the separate
`v3-console.js` (like v2-console.js); `apps/secure-apps.js` is NOT modified.

## Try it

```bash
# CLI (default)
./run-qemu.sh secureos-v3.img 2048
# log in: analyst / secure (lab password — change it with passwd)
curl -s http://127.0.0.1:8000/api/health
curl -s http://127.0.0.1:8000/api/system
curl -s http://127.0.0.1:8000/api/battery
nmap -sn 127.0.0.1
secureos-status
secureos-logs
secureos-net
secureos-drivers
# GUI (needs a graphical QEMU display)
./run-qemu-gui.sh secureos-v3.img 2048
# inside: secureos-gui
```

## Flash / VirtualBox

Same as v2 (see secureos-v2/README-v2.md): `dd` the raw image to USB
(BIOS boot, erases the stick — check `lsblk` first), or convert to VDI
for VirtualBox. UEFI-only boot, real-hardware USB boot, and guest
internet beyond localhost are still NOT proven — see Limitations.

## Build it yourself

```bash
./build-image.sh               # clean build: debootstrap + all packages
SECUREOS_REUSE_ROOTFS=1 ./build-image.sh   # reuse an existing rootfs
# output: secureos-v3.img + secureos-v3.img.sha256 in this folder
# The build log must say whether a run was FULL or CACHED — never present
# a cached-rootfs repack as a first-time full build.
```

Build method is the same as v2 (debootstrap + fakechroot, mkfs.ext4 -d,
manual GRUB BIOS), plus the v3 packages and helpers in §2b of the script.
Default image size is 5120 MB (was 3072 MB in v2) to fit XFCE + firefox-esr.

## What is STILL training / NOT proven

- SOC triage scenarios (INC-1042 etc.) remain TRAINING scenarios, not
  live incidents — in v2 and v3.
- Battery in QEMU: honestly "no battery" (see above).
- Wi-Fi in QEMU: honestly "no Wi-Fi device" unless a Wi-Fi device is
  attached; ethernet is the real, tested path in QEMU.
- GUI visual screenshot: in this headless VM, a GUI desktop screenshot
  was NOT captured. What WAS proven in QEMU (2026-10-30): secureos-gui
  --help, all GUI packages installed, Xvfb + startxfce4 running
  xfce4-session and xfwm4 in the guest, and secureos-gui --stop stopping
  the session. What was NOT proven: a visual XFCE desktop screenshot,
  and startx from a SERIAL console login — that fails with
  "Cannot open /dev/tty0 (Permission denied)", because Xorg needs a
  virtual terminal. The intended GUI path is: boot with
  run-qemu-gui.sh, log in on the GRAPHICAL console (tty1), then run
  secureos-gui there. Never claim a GUI screenshot that was not captured.
- Final local image (2026-10-30, NOT in git): 5.0 GB raw,
  build-time SHA256 d2a0d9b0999ffe95d5eb052fee4acd7782dc3801d4092918bcfb987254a2c3e6
  — a cached-rootfs repack of the clean build-4 rootfs after a one-line
  host-side fix (numeric 1000:1000 chown for /home/analyst/.config;
  a named chown failed on the build host). A booted copy hashes
  differently due to first-boot writes, as in v2. A fresh clean build
  with the final script has not been re-run after that one-line fix.
- Real-hardware USB boot, VirtualBox boot, UEFI (BIOS-only image),
  guest internet: NOT proven, same as v2.

## Files in this folder

- `build-image.sh` — reproducible v3 image builder
- `run-qemu.sh` — CLI QEMU runner (serial, -nographic)
- `run-qemu-gui.sh` — GUI QEMU runner (gtk/sdl/vnc display)
- `guest-test.py` — automated QEMU boot + in-guest proof script (v3 endpoints included)
- `gui-test.py` — Xvfb + XFCE session proof in QEMU (see GUI limitation above)
- `server.py` — real backend v3 (Python stdlib only)
- `v3-console.js` — separate console wiring for the new endpoints
- `bin/secureos-gui`, `bin/secureos-status`, `bin/secureos-logs`,
  `bin/secureos-net`, `bin/secureos-drivers` — installed to /usr/local/bin
- `secureos.service` — systemd unit (localhost only, unchanged from v2)
- `logs/` — boot transcripts (the image itself is NOT in the git repo;
  only scripts/docs/code are committed)
