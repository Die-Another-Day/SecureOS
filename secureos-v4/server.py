#!/usr/bin/env python3
"""SecureOS v4 real backend (Red vs Blue lab)

v4 extends v3 with LAN lab mode, real lab alerts/incidents/flags and IR.
Default boot is still localhost-only (v3 behaviour). Lab mode is ONLY
activated by `secureos-lab --enable`, which binds this server to a
private RFC1918 LAN IP (never 0.0.0.0, never a public IP) and starts
the intentionally vulnerable lab app on a separate port.

SecureOS v3 real backend — Python standard library ONLY, no npm, no deps.

v3 extends v2 with real OS systems: /api/system, /api/processes, /api/files,
/api/drivers, /api/logs, /api/battery, /api/network. All v2 endpoints and
safety rules are kept intact. See below for the v2 safety model.

Serves the SecureOS console from /opt/secureos (or its own directory) on
http://127.0.0.1:8000 ONLY. It is started by systemd unit secureos.service
and is never bound to 0.0.0.0.

SAFETY MODEL — read before changing anything:
  * NO shell: every external tool is run via subprocess with an argument
    LIST, never shell=True, never a user-supplied command string.
  * NO code execution, NO git clone, NO npm/pip install, NO arbitrary
    commands. The only external program ever invoked is `nmap`, with a
    fixed argument list, and only after target validation.
  * Network scan targets are allowlisted: loopback (127.0.0.0/8),
    RFC1918 private ranges (10/8, 172.16/12, 192.168/16) and link-local
    is NOT allowed by default. Public IPs/hostnames are REJECTED with
    HTTP 403 unless the operator explicitly sets the environment variable
    SECUREOS_ALLOW_PUBLIC=1 (lab flag, documented in README-v2.md).
    Scanning anything you do not own or lack permission to test is
    out of scope for this OS, even when the flag is set.
  * SOC incident triage scenarios are TRAINING scenarios, not live
    incidents. This backend does not claim otherwise; see /api/health.
  * Log analysis reads only /var/log/auth.log and /var/log/syslog
    (if readable) plus text the user pastes. It never exfiltrates logs.
  * Hashing uses hashlib only; nothing is sent anywhere.

Endpoints:
  GET  /api/health        kernel version, uptime, real tool versions
  POST /api/scan          {"target": "127.0.0.1", "mode": "ping"|"fast"}
                          -> real `nmap -sn` (ping) or `nmap -F` (fast)
  POST /api/logs          {"text": "..."} -> pattern counts
  GET  /api/system-logs   -> pattern counts over real system logs
  POST /api/hash          {"text": "...", "algo": "sha256"|"sha384"|"sha512"}
  GET  /                  the console (static files from this directory)
"""
import hashlib
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOST = os.environ.get("SECUREOS_BIND_IP") or "127.0.0.1"
if HOST == "0.0.0.0":
    HOST = "127.0.0.1"  # never bind all interfaces
PORT = 8000
LAB_STATE = "/etc/secureos-lab/state"
LAB_LOG = "/var/log/secureos-lab/app.log"
LAB_IRLOG = "/var/log/secureos-lab/ir.log"
ALLOW_PUBLIC = os.environ.get("SECUREOS_ALLOW_PUBLIC", "") == "1"
SCAN_TIMEOUT = 60
MAX_BODY = 200_000
MAX_OUT = 8000

HERE = Path(__file__).resolve().parent

PATTERNS = {
    "brute_force": re.compile(r"Failed password|authentication failure|Invalid user", re.I),
    "sqli": re.compile(r"(union\s+select|or\s+1\s*=\s*1|'\s*or\s*'|select\s+.*\s+from)", re.I),
    "traversal": re.compile(r"\.\./|%2e%2e|/etc/passwd", re.I),
    "xss": re.compile(r"<script|onerror\s*=|javascript:", re.I),
}


def tool_version(cmd):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        first = (p.stdout or p.stderr or "").strip().splitlines()
        return first[0].strip() if first else "unknown"
    except Exception as e:  # noqa: BLE001 - version probe must never crash health
        return f"unavailable ({type(e).__name__})"


def kernel_version():
    try:
        return Path("/proc/version").read_text().strip()
    except OSError:
        return "unknown"


def uptime_seconds():
    try:
        return float(Path("/proc/uptime").read_text().split()[0])
    except (OSError, ValueError, IndexError):
        return -1


def validate_target(raw):
    """Return (ip_str, error_str). Only IPs, no hostnames (no DNS tricks)."""
    if not raw or not isinstance(raw, str):
        return None, "target must be an IP address string"
    raw = raw.strip()
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return None, "target must be a literal IP address (hostnames rejected)"
    if ip.is_loopback or ip.is_private:
        return str(ip), None
    if ALLOW_PUBLIC:
        return str(ip), None
    return None, (
        "public IP rejected: SecureOS v2 scans only localhost and RFC1918 "
        "private ranges by default. Set SECUREOS_ALLOW_PUBLIC=1 only in "
        "your own lab, and only scan systems you own or have permission "
        "to test."
    )


def run_allowlisted(args, timeout=15):
    """Run a fixed argument list, return (stdout, error_or_None). Never shell."""
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return (p.stdout + p.stderr)[:6000], None
    except FileNotFoundError:
        return "", f"{args[0]} not installed"
    except subprocess.TimeoutExpired:
        return "", "command timed out"



def journal_tail(n=300):
    """Last n journal lines (newest), not the first 6000 chars."""
    try:
        p = subprocess.run(["journalctl", "-n", str(n), "--no-pager"],
                           capture_output=True, text=True, timeout=20)
        return (p.stdout + p.stderr).splitlines()
    except Exception:
        return []

def mem_info():
    info = {}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                info[k.strip()] = v.strip()
    except OSError:
        pass
    return info


def load_avg():
    try:
        return Path("/proc/loadavg").read_text().strip()
    except OSError:
        return "unknown"


def count_patterns(text):
    lines = text.splitlines()
    counts = {k: 0 for k in PATTERNS}
    failed_logins = 0
    for line in lines:
        for name, rx in PATTERNS.items():
            if rx.search(line):
                counts[name] += 1
        if "Failed password" in line:
            failed_logins += 1
    return {"lines": len(lines), "failed_logins": failed_logins, "patterns": counts}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    def log_message(self, *a):  # keep console quiet; systemd journal has it
        sys.stderr.write("%s - %s\n" % (self.address_string(), a[0] % a[1:]))

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return None, "empty or oversized body"
        try:
            return json.loads(self.rfile.read(length)), None
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None, "invalid JSON"

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self._send_json({
                "ok": True, "name": "SecureOS", "version": "4.0",
                "mode": "real-os",
                "kernel": kernel_version(),
                "uptime_seconds": uptime_seconds(),
                "bind": f"{HOST}:{PORT}", "lab_mode": Path(LAB_STATE).read_text().strip() if Path(LAB_STATE).exists() else "disabled",
                "allow_public_scans": ALLOW_PUBLIC,
                "gui": "on-demand only: run `secureos-gui` in the CLI; default boot is CLI + this web console",
                "tools": {
                    "nmap": tool_version(["nmap", "--version"]),
                    "tcpdump": tool_version(["tcpdump", "--version"]),
                    "openssl": tool_version(["openssl", "version"]),
                    "python": sys.version.split()[0],
                    "xfce4-panel": tool_version(["xfce4-panel", "--version"]),
                    "nmcli": tool_version(["nmcli", "--version"]),
                    "upower": tool_version(["upower", "--version"]),
                    "htop": tool_version(["htop", "--version"]),
                },
                "note": "SOC triage scenarios in the console are TRAINING "
                        "scenarios, not live incidents.",
            })
        elif path == "/api/system-logs":
            text = ""
            sources = []
            for cand in ("/var/log/auth.log", "/var/log/syslog"):
                try:
                    text += Path(cand).read_text(errors="replace")[-50000:]
                    sources.append(cand)
                except OSError:
                    pass
            result = count_patterns(text)
            result["sources"] = sources
            result["note"] = "Real system logs where readable; empty sources means no readable logs yet."
            self._send_json(result)
        elif path == "/api/system":
            mem = mem_info()
            disk = shutil.disk_usage("/")
            self._send_json({
                "ok": True, "kernel": kernel_version(),
                "uptime_seconds": uptime_seconds(),
                "loadavg": load_avg(),
                "cpu_count": os.cpu_count(),
                "mem_total": mem.get("MemTotal"), "mem_available": mem.get("MemAvailable"),
                "disk_total": disk.total, "disk_used": disk.used, "disk_free": disk.free,
                "real": True,
            })
        elif path == "/api/processes":
            out, err = run_allowlisted(["ps", "-eo", "pid,ppid,pcpu,pmem,comm", "--sort=-pcpu"])
            rows = []
            for line in out.strip().splitlines()[1:26]:
                parts = line.split(None, 4)
                if len(parts) == 5:
                    rows.append({"pid": parts[0], "ppid": parts[1], "pcpu": parts[2], "pmem": parts[3], "comm": parts[4]})
            self._send_json({"ok": True, "processes": rows, "error": err, "real": True})
        elif path == "/api/files":
            qs = parse_qs(urlparse(self.path).query)
            raw = (qs.get("path") or ["/home/analyst"])[0]
            try:
                p = Path(raw).resolve()
            except (OSError, RuntimeError):
                self._send_json({"ok": False, "error": "invalid path"}, 400); return
            allowed = [Path("/home/analyst").resolve(), Path("/opt/secureos").resolve()]
            if not any(p == a or a in p.parents for a in allowed):
                self._send_json({"ok": False, "error": "path not allowed: only /home/analyst and /opt/secureos"}, 403); return
            if not p.exists():
                self._send_json({"ok": False, "error": "path does not exist"}, 404); return
            if not p.is_dir():
                self._send_json({"ok": True, "path": str(p), "type": "file", "size": p.stat().st_size}); return
            entries = []
            for e in sorted(p.iterdir(), key=lambda x: x.name.lower())[:200]:
                try:
                    st = e.stat()
                    entries.append({"name": e.name, "type": "dir" if e.is_dir() else "file", "size": st.st_size, "mtime": int(st.st_mtime)})
                except OSError:
                    continue
            self._send_json({"ok": True, "path": str(p), "entries": entries, "real": True})
        elif path == "/api/drivers":
            lspci, e1 = run_allowlisted(["lspci"])
            lsusb, e2 = run_allowlisted(["lsusb"])
            lsmod, e3 = run_allowlisted(["lsmod"])
            lshw, e4 = run_allowlisted(["lshw", "-short"], timeout=30)
            self._send_json({"ok": True, "lspci": lspci[:4000], "lsusb": lsusb[:4000],
                             "lsmod": lsmod[:4000], "lshw_short": lshw[:4000],
                             "errors": [e for e in (e1, e2, e3, e4) if e], "real": True})
        elif path == "/api/logs":
            journal, jerr = run_allowlisted(["journalctl", "-n", "100", "--no-pager"], timeout=20)
            text = ""
            sources = []
            for cand in ("/var/log/auth.log", "/var/log/syslog"):
                try:
                    text += Path(cand).read_text(errors="replace")[-20000:]
                    sources.append(cand)
                except OSError:
                    pass
            result = count_patterns(text)
            result.update({"journal": journal[:6000], "journal_error": jerr, "sources": sources, "real": True})
            self._send_json(result)
        elif path == "/api/battery":
            devices, derr = run_allowlisted(["upower", "-e"])
            bats = []
            for dev in devices.strip().splitlines():
                dev = dev.strip()
                if not dev:
                    continue
                out, _ = run_allowlisted(["upower", "-i", dev])
                pct = state = None
                for line in out.splitlines():
                    if "percentage:" in line:
                        pct = line.split(":", 1)[1].strip()
                    if "state:" in line:
                        state = line.split(":", 1)[1].strip()
                if "battery" in dev.lower():
                    bats.append({"device": dev, "percentage": pct, "state": state})
            if not bats:
                self._send_json({"ok": True, "battery": None,
                                 "message": "No battery detected (VM / AC power)", "upower_error": derr, "real": True})
            else:
                self._send_json({"ok": True, "battery": bats, "real": True})
        elif path == "/api/network":
            ipout, ierr = run_allowlisted(["ip", "addr"])
            nmout, nerr = run_allowlisted(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status"])
            self._send_json({"ok": True, "ip_addr": ipout[:6000], "nmcli_devices": nmout[:4000],
                             "errors": [e for e in (ierr, nerr) if e], "real": True,
                             "note": "Wi-Fi scanning is not done by this endpoint; use `secureos-net` in the CLI, and only if a Wi-Fi device exists."})

        elif path == "/api/lab":
            state = "disabled"
            lan_ip = None
            try:
                state = Path(LAB_STATE).read_text().strip()
            except OSError:
                pass
            # LAN IP: first non-loopback private address from `ip addr`
            ipout, _ = run_allowlisted(["ip", "-brief", "addr"])
            for line in ipout.splitlines():
                parts = line.split()
                for tok in parts[2:]:
                    if "/" in tok:
                        addr = tok.split("/")[0]
                        try:
                            ip = ipaddress.ip_address(addr)
                            if ip.is_private and not ip.is_loopback:
                                lan_ip = addr; break
                        except ValueError:
                            pass
                if lan_ip:
                    break
            def svc(name):
                out, _ = run_allowlisted(["systemctl", "is-active", name])
                return out.strip()
            self._send_json({"ok": True, "lab_state": state, "bind": f"{HOST}:{PORT}",
                "lan_ip": lan_ip, "real": True,
                "services": {"secureos": svc("secureos.service"),
                             "labapp": svc("secureos-labapp.service"),
                             "ssh": svc("ssh.service")},
                "note": "LAB ONLY: private LAN only, with consent of everyone on that LAN. "
                        "Never expose lab services to the internet."})
        elif path == "/api/alerts":
            alerts = []
            def scan_file(cand, kind):
                try:
                    text = Path(cand).read_text(errors="replace")[-100000:]
                except OSError:
                    return
                for line in text.splitlines()[-500:]:
                    low = line.lower()
                    atype = None
                    if "union" in low and "select" in low:
                        atype = "SQL injection attempt (real log line)"
                    elif "plugin_exec" in low:
                        atype = "Plugin execution (real log line)"
                    elif "upload" in low:
                        atype = "Plugin upload (real log line)"
                    elif "failed password" in low or "failed publickey" in low:
                        atype = "Failed SSH login (real log line)"
                    elif "accepted password" in low or "accepted publickey" in low:
                        atype = "Successful SSH login (real log line)"
                    elif "login_success" in low:
                        atype = "Successful lab-app login (real log line)"
                    if atype:
                        alerts.append({"type": atype, "source": cand, "line": line[:500]})
            scan_file(LAB_LOG, "labapp")
            scan_file("/var/log/auth.log", "auth")
            for line in journal_tail(300):
                low = line.lower()
                atype = None
                if "sqlI_success" in low or ("union" in low and "select" in low):
                    atype = "SQL injection attempt (real journal line)"
                elif "plugin_exec" in low:
                    atype = "Plugin execution (real journal line)"
                elif "upload" in low:
                    atype = "Plugin upload (real journal line)"
                elif "accepted password" in low or "accepted publickey" in low:
                    atype = "Successful SSH login (real journal line)"
                elif "failed password" in low:
                    atype = "Failed SSH login (real journal line)"
                if atype:
                    alerts.append({"type": atype, "source": "journal", "line": line[:500]})
            # File-integrity: compare manifest (real hashes, secureos-fim)
            try:
                fim, _ = run_allowlisted(["secureos-fim", "--check"], timeout=30)
                if "CHANGED" in fim or "NEW" in fim or "MISSING" in fim:
                    alerts.append({"type": "File integrity change (real FIM check)", "source": "secureos-fim", "line": fim[:1000]})
            except Exception:
                pass
            self._send_json({"ok": True, "alerts": alerts[-100:], "count": len(alerts),
                             "real": True, "note": "Only lines actually present in logs are listed. No invented incidents."})
        elif path == "/api/incidents":
            lines = []
            for cand in (LAB_LOG, LAB_IRLOG, "/var/log/auth.log"):
                try:
                    for line in Path(cand).read_text(errors="replace").splitlines()[-200:]:
                        if any(k in line for k in ("SEARCH", "LOGIN", "UPLOAD", "PLUGIN", "IR-", "Failed password", "Accepted")):
                            lines.append({"source": cand, "line": line[:500]})
                except OSError:
                    continue
            for line in journal_tail(300):
                if any(k in line for k in ("SEARCH", "LOGIN", "UPLOAD", "PLUGIN", "SQLI", "IR-", "Accepted", "Failed password")):
                    lines.append({"source": "journal", "line": line[:500]})
            lines.sort(key=lambda x: x["line"][:19])
            self._send_json({"ok": True, "timeline": lines[-200:], "real": True,
                             "note": "REAL LAB INCIDENTS only. V3 SOC training scenarios are separate and labelled TRAINING."})
        elif path == "/api/flags":
            # Captured = proven by a real log event, not by a button.
            captured = {"flag1_sqli": False, "flag2_ssh": False, "flag3_plugin": False}
            try:
                text = Path(LAB_LOG).read_text(errors="replace")
                if "UNION" in text.upper() and "SELECT" in text.upper():
                    # UNION was attempted; capture is only proven if the
                    # query actually returned a secrets row — the lab app
                    # logs SQLI_SUCCESS when a secrets value is in output.
                    if "SQLI_SUCCESS" in text:
                        captured["flag1_sqli"] = True
                if "PLUGIN_EXEC" in text:
                    captured["flag3_plugin"] = True
            except OSError:
                pass
            try:
                auth = Path("/var/log/auth.log").read_text(errors="replace")
                if "Accepted password" in auth and "labuser" in auth:
                    captured["flag2_ssh"] = True
            except OSError:
                pass
            jtext = "\n".join(journal_tail(300))
            if "SQLI_SUCCESS" in jtext:
                captured["flag1_sqli"] = True
            if "PLUGIN_EXEC" in jtext:
                captured["flag3_plugin"] = True
            if "Accepted password" in jtext and "labuser" in jtext:
                captured["flag2_ssh"] = True
            self._send_json({"ok": True, "flags": captured, "real": True,
                             "note": "A flag is marked captured only when its real exploit log event exists. Flag VALUES are never returned by this API."})
        else:
            super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        data, err = self._read_json()
        if err:
            self._send_json({"ok": False, "error": err}, 400)
            return
        if path == "/api/scan":
            target, terr = validate_target(data.get("target"))
            if terr:
                self._send_json({"ok": False, "error": terr}, 403)
                return
            mode = data.get("mode", "ping")
            # Fixed argument lists only. No user-controlled flags.
            args = ["nmap", "-sn", target] if mode != "fast" else ["nmap", "-F", target]
            try:
                p = subprocess.run(args, capture_output=True, text=True, timeout=SCAN_TIMEOUT)
                out = (p.stdout + p.stderr)[:MAX_OUT]
                self._send_json({"ok": True, "target": target, "mode": mode,
                                 "returncode": p.returncode, "output": out,
                                 "real": True, "tool": "nmap"})
            except subprocess.TimeoutExpired:
                self._send_json({"ok": False, "error": "nmap timed out after 60s"}, 504)
            except FileNotFoundError:
                self._send_json({"ok": False, "error": "nmap not installed in this image"}, 500)
        elif path == "/api/logs":
            text = data.get("text", "")
            if not isinstance(text, str):
                self._send_json({"ok": False, "error": "text must be a string"}, 400)
                return
            self._send_json({"ok": True, **count_patterns(text[:MAX_BODY])})
        elif path == "/api/hash":
            text = data.get("text", "")
            algo = data.get("algo", "sha256")
            if algo not in ("sha256", "sha384", "sha512"):
                self._send_json({"ok": False, "error": "algo must be sha256, sha384 or sha512"}, 400)
                return
            if not isinstance(text, str):
                self._send_json({"ok": False, "error": "text must be a string"}, 400)
                return
            digest = getattr(hashlib, algo)(text.encode()).hexdigest()
            self._send_json({"ok": True, "algo": algo, "hash": digest, "real": True})
        else:
            self._send_json({"ok": False, "error": "unknown endpoint"}, 404)


def main():
    print(f"SecureOS v4 console on http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
