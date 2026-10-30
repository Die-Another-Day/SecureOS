# SecureOS v4 — Red vs Blue Lab (ULTIMATE build, real only)

v4 is built on v3 (Debian 12, kernel 6.1.0-54, GRUB BIOS, CLI boot +
web console, `secureos-gui` on demand). v3 behaviour is unchanged by
default: **lab OFF, console on http://127.0.0.1:8000 only.**

v4 adds a real, networked classroom lab — not a simulation:

## The idea (in one paragraph)

One student installs SecureOS on a device (PC / VM / USB). Other
students on the SAME private LAN attack it and defend it. The SOC
student monitors and secures it; the VAPT students try to get in,
following the real VAPT stages, and after a compromise the SOC student
runs a real incident-response plan to contain, eradicate and recover.
That is the difference between theoretical education and practical
implementation: students actually do it, with real tools, real logs
and real flags — not slides, not fake alerts.

## LAN mode — the core change from v3

```
# On the SecureOS machine, after connecting to the class LAN:
sudo secureos-lab --enable    # opens the lab, prints the LAN address
sudo secureos-lab --status
sudo secureos-lab --stop      # kill switch: everything lab shuts down
sudo secureos-lab --reset     # fresh flags/DB for the next class
```

* Default boot stays SAFE: lab services OFF, console localhost-only.
* `--enable` only works if the primary IP is RFC1918 private
  (10/8, 172.16/12, 192.168/16). It REFUSES a public IP and never
  binds 0.0.0.0. The console then binds to that LAN IP only.
* nftables lab table allows LAN → lab ports (8000, 8080, 2222) and
  drops non-LAN → lab ports.
* Printed on enable: SOC console `http://<LAN-IP>:8000`,
  lab web app `http://<LAN-IP>:8080`, lab SSH `ssh -p 2222 labuser@<LAN-IP>`.
* Attackers use their OWN machines on that LAN with real tools
  (nmap, curl, ssh, sqlmap-style manual injection). No special client.
* `--stop` stops labapp, lab SSH and vsftpd (if present), removes the
  nftables lab table, removes the console bind override, restarts the
  console on localhost only, deletes uploaded plugins and attacker
  persistence (authorized_keys, lab cron files).

## Real vulnerable target (Red Team, LAB ONLY)

All in `/srv/labapp/labapp.py` (Python stdlib only), run as the
unprivileged `labweb` user, port 8080, LAB ONLY:

| Flag | Way in | VAPT stage |
|---|---|---|
| flag1 (SQLi) | Real SQL injection in `/search` (string-concatenated SQLite query). A UNION SELECT reads the `secrets` table. Reflected XSS is also present in the same search page. | Enumeration → Vulnerability Assessment → Exploitation |
| flag2 (SSH) | Real SSH login as `labuser` with the documented LAB credential (`lab123`, changeable, disabled by `--stop`). Then read `/home/labuser/flag2.txt` (0600, labuser only). | Scanning → Enumeration → Exploitation (weak credential) |
| flag3 (plugin) | Real insecure plugin upload in `/upload`: a `.py` plugin is saved and executed on `/plugin?name=...` as labweb, which can read `/srv/labapp/flags/flag3.txt` (0600, labweb only — the SSH user cannot read it). | Exploitation → Post-exploitation / code execution |

Directory listing in `/files/` is real (it lists a hint note, not a flag).
Flag values are generated randomly at install/reset and are NEVER
printed by setup, reset or the console API — an attacker must exploit
to read them. The console `/api/flags` only reports captured/not, proven
by real log events (SQLI_SUCCESS, SSH Accepted for labuser, PLUGIN_EXEC).

## Real Blue Team / SOC + IR (defender, real data)

* Detection from real sources only: systemd journal, `/var/log/auth.log`,
  lab app log (`/var/log/secureos-lab/app.log`), auditd rules for
  `/srv/labapp`, `/home/labuser` and `/etc/secureos-lab` (if auditd
  starts in the environment — otherwise journal/auth/app logs are the
  detection source, and that is stated, not hidden), and
  `secureos-fim` (real SHA-256 manifest of watched lab files).
* Suricata is NOT in this build (it did not fit the QEMU test budget
  and was not proven running; nftables logging + journal + auditd +
  auth logs are the detection path). Do not claim Suricata otherwise.
* New APIs (v4 server.py, stdlib only, argument lists only):
  `GET /api/lab`, `GET /api/alerts` (real log lines only, no invented
  incidents), `GET /api/incidents` (real timeline from log lines +
  IR actions), `GET /api/flags` (captured only on real log proof).
* V3 SOC training scenarios remain labelled TRAINING. v4 lab incidents
  are labelled REAL LAB INCIDENTS. They are different things.
* Real IR commands (all log to `/var/log/secureos-lab/ir.log` + journal):
  ```
  sudo secureos-ir contain <attacker-ip>    # nftables drop, verified by nft list
  sudo secureos-ir uncontain <attacker-ip>
  sudo secureos-ir kill-session [ip]        # kill labuser sshd sessions
  sudo secureos-ir eradicate                # stop services, delete plugins/persistence, lock labuser
  sudo secureos-ir recover                  # clear temp blocks, unlock, restart clean, re-harden perms
  ```

## Safety — non-negotiable

* LAB ONLY, private LAN only, with consent of everyone on that LAN.
* Never on the public internet. Never on a campus/corporate network
  without written permission. Never use any v4 tool against a system
  outside the lab. Lab services run as unprivileged users where possible.
* The lab credential (`labuser` / `lab123`) is intentionally weak for
  the class, is documented as LAB ONLY, is changeable with `passwd`,
  and is locked/disabled by `--stop` / `eradicate`.
* `--stop` must actually stop everything — it is tested in guest-test-v4.py.

## Try it (real PC / VM, same LAN)

```
# SecureOS machine:
./run-qemu.sh secureos-v4.img 2048        # or dd to USB, or VirtualBox
# login: analyst / secure (change it with passwd)
sudo secureos-lab --enable
# note the LAN IP it prints, e.g. 192.168.1.50
# Attacker machine (same LAN, Kali or any Linux):
nmap -sV 192.168.1.50
curl "http://192.168.1.50:8080/search?q=test"
# SOC machine / console (same LAN):
# open http://192.168.1.50:8000  -> Lab views, /api/alerts, /api/incidents, /api/flags
# After a compromise, on SecureOS:
sudo secureos-ir contain <attacker-ip>
sudo secureos-ir eradicate
sudo secureos-ir recover
sudo secureos-lab --reset   # next class
sudo secureos-lab --stop    # end of class, lab off
```

## Build it yourself

`./build-image.sh` is the reproducible builder (adapted from v3:
debootstrap + v3 packages + auditd/nftables + v4 lab files/units/users).
On the build host used for this release, grub/fakechroot were not
available, so the shipped local image was produced by installing v4
inside a booted copy of the v3 image (see logs/ for the setup
transcript) — the build script is the clean-room path for a Debian
host with grub-pc-bin/fakechroot, and that distinction is stated here,
not hidden. Image, rootfs and logs are NOT in git.

## Files in this folder

* `build-image.sh` — reproducible v4 builder (Debian host path)
* `run-qemu.sh`, `run-qemu-gui.sh` — QEMU runners (CLI / graphical)
* `guest-test-v4.py` — automated end-to-end proof (boot, enable, scan,
  SQLi flag, SSH flag, plugin flag, alerts, IR, reset, stop)
* `server.py` — v4 console backend (stdlib only)
* `labapp.py` — intentionally vulnerable lab web app (LAB ONLY)
* `v4-console.js` — lab views wiring (separate file)
* `secureos-labapp.service`, `secureos-ssh-lab.service`, `secureos.service`
* `bin/secureos-lab`, `bin/secureos-ir`, `bin/secureos-fim`,
  `bin/secureos-lab-reset-flags`
* `setup-v4.sh` — guest install script used for the local image
* `README-v4.md` — this file

## End-to-end proof (QEMU, 2026-10-30, final run)

On a fresh copy of the shipped image, with lab enabled at LAN IP
10.0.2.15 (QEMU user net): host curl/SQLi returned the secrets row
(flag pattern present, value not quoted here), host SSH login as
labuser succeeded (journal: Accepted password, session opened) and
returned the SSH flag, host plugin upload + execution returned the
plugin flag. Guest `/api/flags` then reported all three flags true,
proven by real log events only. `/api/alerts` returned 5 real alerts
with timestamps (SQLi SEARCH/SQLI_SUCCESS, SSH Accepted, UPLOAD,
PLUGIN_EXEC, FIM CHANGED/NEW). IR was proven in the same run:
contain 10.0.2.99 verified in nftables, uncontain removed it,
eradicate removed pwn.py and stopped labapp and locked labuser,
recover restarted labapp + lab-ssh active, reset regenerated flags
and FIM reported OK, and `--stop` left labapp/ssh-lab inactive,
nft lab table absent, console back to localhost-only.
Flag files at capture time: flag3 23 bytes, flag2 27 bytes.

## What is NOT in v4 (stated, not faked)

* Suricata — not installed/proven in this build.
* auditd rules — auditd service IS installed and active in the
  guest (3.0.9-1, from Debian bookworm debs served by the host,
  because guest apt DNS failed), and the rules file exists in
  /etc/audit/rules.d/, but `auditctl -l` still reported No rules
  in QEMU, so no auditd events were used in the proof. Detection
  in the proof is journal + lab app log + FIM, all real. Do not
  claim auditd events otherwise until rules load is proven on a
  real PC.
* vsftpd — not installed; SSH + web app are the misconfiguration paths.
* Two-VM LAN — in the headless test VM, the proof is host-to-guest
  via QEMU user networking (hostfwd), not two separate QEMU VMs on a
  bridged LAN. The real-PC LAN steps above are the intended class path
  and are documented, not claimed as tested here.
* UEFI, real-hardware USB boot, VirtualBox boot — same as v3, not proven.
* SOC training scenarios — still TRAINING, separate from real lab incidents.
