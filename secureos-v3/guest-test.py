#!/usr/bin/env python3
"""Boot SecureOS v3 in QEMU over a PTY, log in on the serial console, and
run real commands inside the guest. Saves a full transcript to a log file.

Usage: guest-test.py <image> <logfile> [timeout-seconds]
Proves (inside the guest, not the host): kernel version, secureos.service
state, curl to the localhost console, and a real nmap scan of 127.0.0.1.
No KVM is assumed (TCG emulation); be patient on first boot.
"""
import os, pty, re, select, sys, time

IMG, LOG = sys.argv[1], sys.argv[2]
TIMEOUT = int(sys.argv[3]) if len(sys.argv) > 3 else 900

logf = open(LOG, "wb", buffering=0)

def emit(b):
    logf.write(b)
    sys.stdout.buffer.write(b); sys.stdout.buffer.flush()

master, slave = pty.openpty()
import subprocess
q = subprocess.Popen(
    ["qemu-system-x86_64", "-m", "2048", "-machine", "pc", "-cpu", "qemu64",
     "-drive", f"file={IMG},format=raw,if=ide",
     "-netdev", "user,id=net0", "-device", "e1000,netdev=net0",
     "-display", "none", "-serial", "stdio", "-monitor", "none"],
    stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)

buf = b""
def wait_for(pat, timeout, label):
    global buf
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 5)
        if r:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            emit(data); buf += data
            if re.search(pat, buf):
                print(f"\n[guest-test] MATCH {label}: {pat}\n", flush=True)
                return True
        if q.poll() is not None:
            print(f"\n[guest-test] QEMU EXITED rc={q.returncode}\n", flush=True)
            return False
    print(f"\n[guest-test] TIMEOUT waiting for {label}: {pat}\n", flush=True)
    return False

def send(s):
    os.write(master, s.encode())
    time.sleep(1.0)

ok = True
ok &= wait_for(rb"secureos login:", 600, "login prompt")
if ok:
    send("analyst\n")
    ok &= wait_for(rb"Password:", 60, "password prompt")
if ok:
    send("secure\n")
    ok &= wait_for(rb"analyst@secureos", 60, "shell prompt")
if ok:
    # One command block; each command echoes a marker so the log is checkable.
    cmds = [
        "echo MARK_KERNEL; uname -a; cat /proc/version",
        "echo MARK_SERVICE; systemctl is-active secureos.service; systemctl status secureos.service --no-pager | head -20",
        "echo MARK_CURL; curl -s http://127.0.0.1:8000/api/health; echo",
        "echo MARK_NMAP; nmap -sn 127.0.0.1",
        "echo MARK_HASH; curl -s -X POST http://127.0.0.1:8000/api/hash -H 'Content-Type: application/json' -d '{\"text\":\"secureos\",\"algo\":\"sha256\"}'; echo",
        "echo MARK_SCAN_API; curl -s -X POST http://127.0.0.1:8000/api/scan -H 'Content-Type: application/json' -d '{\"target\":\"127.0.0.1\",\"mode\":\"ping\"}'; echo",
        "echo MARK_PUBLIC_REJECT; curl -s -X POST http://127.0.0.1:8000/api/scan -H 'Content-Type: application/json' -d '{\"target\":\"8.8.8.8\",\"mode\":\"ping\"}'; echo",
        "echo MARK_SSH; systemctl is-active ssh || true; systemctl is-enabled ssh || true; ss -tln | grep ':22' || echo NO_SSH_PORT",
        "echo MARK_V3_SYSTEM; curl -s http://127.0.0.1:8000/api/system; echo",
        "echo MARK_V3_PROCS; curl -s http://127.0.0.1:8000/api/processes | head -c 400; echo",
        "echo MARK_V3_BATTERY; curl -s http://127.0.0.1:8000/api/battery; echo",
        "echo MARK_V3_NETWORK; curl -s http://127.0.0.1:8000/api/network | head -c 400; echo",
        "echo MARK_V3_FILES; curl -s 'http://127.0.0.1:8000/api/files?path=/home/analyst'; echo",
        "echo MARK_V3_FILES_FORBIDDEN; curl -s 'http://127.0.0.1:8000/api/files?path=/etc'; echo",
        "echo MARK_V3_GUI_HELP; secureos-gui --help",
        "echo MARK_V3_GUI_PKGS; ls -l /usr/local/bin/secureos-gui /usr/local/bin/secureos-status /usr/local/bin/secureos-logs /usr/local/bin/secureos-net /usr/local/bin/secureos-drivers; which Xorg startxfce4 xfce4-panel thunar firefox-esr nmcli upower htop; ls /home/analyst/",
        "echo MARK_V3_STATUS; secureos-status | head -30",
        "echo MARK_V3_NET; secureos-net | head -30",
        "echo MARK_DONE",
    ]
    for c in cmds:
        send(c + "\n")
        time.sleep(8)
    ok &= wait_for(rb"MARK_DONE", 300, "all commands done")
    send("poweroff\n")
    time.sleep(10)
try:
    q.terminate()
except Exception:
    pass
try:
    q.wait(timeout=20)
except Exception:
    q.kill()
print(f"[guest-test] finished ok={ok} qemu_rc={q.returncode}", flush=True)
logf.close()
sys.exit(0 if ok else 1)
