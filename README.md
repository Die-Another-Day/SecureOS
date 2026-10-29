# SecureOS — v2 is a real OS, v1 was a web demo

> **v2 (new, 2026-10-29): SecureOS is now a REAL bootable Linux OS** —
> Debian 12 bookworm, real kernel 6.1.0-54, GRUB BIOS, systemd, and a real
> Python backend that runs real `nmap`, real log parsing and real hashing
> on `http://127.0.0.1:8000` only. The v1 web desktop below is still here
> as the console front end, but v2 is what boots on hardware or in QEMU.
> Full details, flash/dd instructions, safety rules and the verified boot
> proof: [`secureos-v2/README-v2.md`](secureos-v2/README-v2.md).
> Try it: `./secureos-v2/run-qemu.sh` (needs the `secureos-v2.img` build
> from `./secureos-v2/build-image.sh` — the multi-GB image itself is NOT
> in this repo). Log in as `analyst` / `secure` (lab password — change it).
> SOC triage scenarios remain **training** scenarios in v2 as well.
> Nothing here is an exploitation tool, and scans are allowlisted to
> localhost + RFC1918 private ranges by default.

# SecureOS v1.0 — a web-based analyst OS

**SecureOS is LoveOS, transformed in place.** The original project was a web
desktop ("Love OS — For Her"). v1.0 keeps the same idea — a full operating
system that runs in a browser, no download — and rebuilds it around
cybersecurity.

## Run it (frontend only, no backend needed)

```bash
# from this repo root
python3 -m http.server 8000
# open http://localhost:8000
```

Demo login: any operator name + passphrase `secure`.
That login is a demo gate only — it is **not real authentication**, and it
protects nothing on a server, because there is no server data. Everything
below runs in your browser.

## What is inside

| App | What it actually does |
|---|---|
| 🛡️ SOC Command Center | **Simulated** incident triage: brute-force, phishing, SQLi probe, lateral movement. Score yourself on contain / escalate / false-positive calls. |
| 🔑 Password Lab | Entropy estimate, common-password check, passphrase generator. Local only. |
| #️⃣ Hash Lab | SHA-256/384/512 via WebCrypto, hash identification and comparison. |
| 🎣 Phishing Analyzer | Parses a URL locally and scores heuristic red flags. **It never opens or fetches the link.** |
| 📜 Log Analyzer | Counts brute-force, SQLi, traversal and XSS patterns in pasted logs. |
| 🔒 Vault Notes | AES-GCM notes, PBKDF2-derived key, stored only in this browser. Demo-grade — a forgotten passphrase cannot be recovered. |
| 🌐 Network Lab | **Simulated** port scan for teaching. Sends no packets, touches no network. |
| 🧠 Threat Intel Cards | Curated technique cards, including the compounding-vulnerability idea behind UASAF. |
| 💻 Secure Terminal | Local virtual filesystem only (`help, ls, cat, echo, mkdir, tools, threat`). |

The "overpowered" piece is the SOC Center + Log Analyzer + Threat Intel
together: triage an incident, see *why* a pattern matters, and see how
small flaws chain into a critical path — instead of a single tool in
isolation.

## Security model — read this before you show it to anyone

- **Local-first:** no app sends your passwords, hashes, URLs, logs or notes
  anywhere. Check the code in `apps/secure-apps.js` — there is no fetch to
  a third party in any app.
- **Lab use only:** never scan, probe or test a system you do not own or
  do not have explicit permission to test. The Network Lab is simulated
  precisely so the demo cannot be misused that way.
- **Demo login is not security:** anyone with the page can enter. Do not
  put real production secrets in Vault Notes.
- **Reference tools in v1 vs v2:** in the v1 web demo, Nmap, Wireshark,
  Suricata/Zeek and Wazuh were reference tools only — the demo did not
  install or run them. In v2 they are real, inside the bootable OS
  (see `secureos-v2/README-v2.md`).

## Backend hardening (v1.0 history, now cleaned up)

The original LoveOS backend could clone **any** GitHub URL,
`npm install` it, and run it with `spawn(..., { shell: true })`. That is
remote code execution if the server is ever exposed, so v1.0 hardened it
to a catalogue-only server, and the v1 cleanup then removed the whole
Node backend (`backend/`) from this repo. SecureOS v2 does not use it at
all: its backend is `secureos-v2/server.py` (Python stdlib only, localhost
only, allowlisted tools only — no clone, install, or arbitrary run).
No exploitation tool is a SecureOS app, in v1 or v2.

## What v1.0 deliberately does NOT do

- No real network scanning, packet capture, or exploitation — those need
  a real lab, real permission, and real tools, not a browser demo.
- No user accounts, no cloud sync, no analytics.
- Cleanup (29 Oct 2026): the legacy `loveos/` folder and the v1 Node
  backend (`backend/`) were removed from main — 29 files in total.
  They remain in git history only. The live desktop loads from
  `secureos/`; the real OS is in `secureos-v2/`.

## Origin

LoveOS was first shared on LinkedIn on 11 Aug 2025 ("Building LoveOS: A
Web-Based OS from Scratch"). SecureOS v1.0, 29 Oct 2026, is its
cybersecurity transformation, built in place in this same repository.
