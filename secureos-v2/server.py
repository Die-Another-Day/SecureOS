#!/usr/bin/env python3
"""SecureOS v2 real backend — Python standard library ONLY, no npm, no deps.

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
import subprocess
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = 8000
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
                "ok": True, "name": "SecureOS", "version": "2.0",
                "mode": "real-os",
                "kernel": kernel_version(),
                "uptime_seconds": uptime_seconds(),
                "bind": f"{HOST}:{PORT} (localhost only)",
                "allow_public_scans": ALLOW_PUBLIC,
                "tools": {
                    "nmap": tool_version(["nmap", "--version"]),
                    "tcpdump": tool_version(["tcpdump", "--version"]),
                    "openssl": tool_version(["openssl", "version"]),
                    "python": sys.version.split()[0],
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
    print(f"SecureOS v2 console on http://{HOST}:{PORT} (localhost only)", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
