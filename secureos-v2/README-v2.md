# SecureOS v2 — a REAL bootable Linux OS

v1 was a web desktop: HTML/JS files that *simulated* an OS in a browser.
**v2 is different: it is a real Debian GNU/Linux system with a real kernel
that boots on real hardware or in QEMU.** The console web page is now just
the front end; behind it, on `http://127.0.0.1:8000`, runs a real Python
backend that calls real tools.

## What is real in v2

| Piece | v1 (web demo) | v2 (this build) |
|---|---|---|
| Kernel / boot | None (browser) | Real Debian bookworm kernel, GRUB BIOS, systemd |
| Network scan | Simulated, no packets | Real `nmap -sn` / `nmap -F` (allowlisted targets only, see below) |
| Log analysis | Pasted sample text only | Pasted text **plus** real `/var/log/auth.log` + `/var/log/syslog` via `GET /api/system-logs` |
| Hashing | WebCrypto in browser | Real `hashlib` SHA-256/384/512 on the OS via `POST /api/hash` |
| Health | Static | Real `/proc/version`, uptime, `nmap --version`, `tcpdump --version` |
| Login | Demo gate (`secure`, protects nothing) | Real Linux user `analyst` + console login; console binds localhost only |

## What is STILL training (honest label, not a live feed)

The SOC Command Center incident scenarios (INC-1042 brute-force, INC-1043
phishing, INC-1044 SQLi probe, INC-1045 single failed login) are **training
scenarios**. They teach triage calls (Contain / Escalate / False positive);
they are **not** live incidents from your network. v2 does not pretend
otherwise — the console and `/api/health` both say so.

## Safety rules (do not skip)

1. **Scan only systems you own or have explicit permission to test.**
   The backend enforces this by default: it accepts only loopback
   (`127.0.0.0/8`) and RFC1918 private addresses (`10/8`, `172.16/12`,
   `192.168/16`). Public IPs are rejected with HTTP 403.
2. The lab override `SECUREOS_ALLOW_PUBLIC=1` exists for your own isolated
   lab only, and it does **not** make scanning someone else's system OK.
3. No exploitation tools are included, and none are added by this build:
   no PhoneSploit-Pro, no password crackers, no payload frameworks. This
   is a **defensive SOC/lab OS**: nmap, tcpdump/tshark (capture + analysis),
   openssl, curl — observe and defend, not attack.
4. **Change the lab password on first login** (`passwd`). The default
   `analyst / secure` is a published lab credential, not a secret.
5. OpenSSH is installed but **masked by default** (service + socket point
   to `/dev/null`, and no port 22 listens — verified in the QEMU boot).
   Unmask it only in your own lab (`systemctl unmask ssh ssh.socket &&
   systemctl enable --now ssh`), preferably with key auth.
6. The console binds `127.0.0.1:8000` only. It is not reachable from the
   network, even on a machine running SecureOS.

## Try it in QEMU

```bash
./run-qemu.sh secureos-v2.img 1024
# log in: analyst / secure
curl -s http://127.0.0.1:8000/api/health
nmap -sn 127.0.0.1
# quit QEMU: Ctrl-A then X
```

## Flash it to a USB stick (erases the stick — double-check the device!)

```bash
lsblk                          # find your USB device, e.g. /dev/sdb
sudo dd if=secureos-v2.img of=/dev/sdb bs=4M status=progress conv=fsync
sync
# Boot from USB (BIOS boot). Log in as analyst / secure.
```

## Run it in VirtualBox

Create a VM (Linux / Debian 64-bit, 1024 MB RAM), attach
`secureos-v2.img` as an existing raw disk (or convert:
`VBoxManage convertfromraw secureos-v2.img secureos-v2.vdi --format VDI`),
boot, log in as above.

## Rebuild it yourself

```bash
./build-image.sh               # needs: debootstrap, grub-pc-bin, e2fsprogs, python3
# output: secureos-v2.img + secureos-v2.img.sha256 in this folder
```

Build notes: the script uses `mkfs.ext4 -d` and a manual GRUB BIOS install
(boot.img in the MBR, core.img in the post-MBR gap) so it works even in
containers without `/dev/loop`. Re-running wipes `.build/` and rebuilds.

## Build record (verified build, 2026-10-29)

- Image: `secureos-v2.img` — 3,221,225,472 bytes (3.0 GiB), raw MBR + GRUB
  BIOS, single ext4 partition (label `secureos`)
- SHA256 at build time (in `secureos-v2.img.sha256`):
  `2dce1c366d2b63489e38d2dba438d31cdf92dd066c2645a7b7d344a6f1ca4197`.
  After the verification boot, the file on disk hashes to
  `954ba389c930dfb4eaf96fabfd6cb89112ec86cc059b2bb7391afa63499ee427`
  — the difference is expected first-boot writes (machine-id, journal),
  not corruption. Any boot mutates the image; verify a fresh build with
  the build-time hash, not a booted copy. The image itself is NOT
  committed to git — see below.
- Base: Debian 12 bookworm (amd64, debootstrap minbase + fakechroot build)
- Kernel (from inside the booted guest): Linux 6.1.0-54-amd64,
  Debian 6.1.190-1; systemd 252.39; Python 3.11.2; Nmap 7.93;
  tcpdump 4.99.3; OpenSSL 3.0.22
- Boot proof: `logs/guest-boot.log` (full QEMU serial transcript of the
  FINAL image: GRUB → kernel → systemd → `secureos login:` → analyst
  login → `systemctl is-active secureos.service` = **active (running)**,
  localhost `/api/health`, real `nmap -sn 127.0.0.1` = Host is up,
  real scan-API + hash-API results, public-IP rejection, ssh =
  **inactive/masked, no port 22**). Earlier attempts are kept as
  `logs/guest-boot-1.log` (first boot, console-order issue) and
  `logs/guest-boot-2-initramfs-fail.log` (the `/dev` symlink-loop failure
  that taught us the fix) and `logs/guest-boot-3-systemd-ok-ssh-on.log`
  (systemd OK, but ssh still starting — fixed by masking).
- Host-side server test: `server.py` passes `/api/health`, `/api/hash`
  (SHA-256 of `secureos` = `673c0bc05a87eedc5fc8177bfc99e31be7a6976712597d7098b36579cf47dd6d`),
  public-IP rejection, and log-pattern counts.

## Files in this folder

- `build-image.sh` — reproducible image builder
- `run-qemu.sh` — QEMU launcher (BIOS, serial console)
- `guest-test.py` — automated QEMU boot + in-guest proof script
- `server.py` — real backend (Python stdlib only; also installed as
  `/opt/secureos/server.py` in the image and run by `secureos.service`)
- `secureos.service` — systemd unit (localhost only)
- `v2-console.js` — separate wiring file: on localhost it fetches the real
  `/api/*` endpoints and shows a REAL OS badge; on a static page it does
  nothing and the v1 demo keeps working untouched. `apps/secure-apps.js`
  is intentionally **not** modified.
- `logs/` — boot transcripts (the image itself is NOT in the git repo;
  only scripts/docs/code are committed — the multi-GB `.img` stays out)
