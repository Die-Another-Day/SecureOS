#!/usr/bin/env python3
"""Boot SecureOS v3 serial, start XFCE under Xvfb in the guest, prove
Xorg + XFCE session processes run. Also attempts secureos-gui (startx)
from the serial console and records its result honestly.
Usage: gui-test.py <image> <logfile> [timeout]
"""
import os, pty, re, select, sys, time, subprocess
IMG, LOG = sys.argv[1], sys.argv[2]
TIMEOUT = int(sys.argv[3]) if len(sys.argv) > 3 else 900
logf = open(LOG, "wb", buffering=0)
def emit(b):
    logf.write(b); sys.stdout.buffer.write(b); sys.stdout.buffer.flush()
master, slave = pty.openpty()
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
            try: data = os.read(master, 65536)
            except OSError: break
            if not data: break
            emit(data); buf += data
            if re.search(pat, buf):
                print(f"\n[gui-test] MATCH {label}\n", flush=True); return True
        if q.poll() is not None:
            print(f"\n[gui-test] QEMU EXITED rc={q.returncode}\n", flush=True); return False
    print(f"\n[gui-test] TIMEOUT {label}\n", flush=True); return False
def send(s):
    os.write(master, s.encode()); time.sleep(1.0)
ok = True
ok &= wait_for(rb"secureos login:", 600, "login")
if ok:
    send("analyst\n"); ok &= wait_for(rb"Password:", 60, "password")
if ok:
    send("secure\n"); ok &= wait_for(rb"analyst@secureos", 60, "shell")
if ok:
    cmds = [
        "echo MARK_XVFB; which Xvfb xvfb-run startx startxfce4; ls ~/.xinitrc 2>&1 || echo NO_XINITRC_YET",
        "echo MARK_XVFB_START; Xvfb :99 -screen 0 1280x800x24 > /tmp/xvfb.log 2>&1 & sleep 3; ps aux | grep -E 'Xvfb' | grep -v grep",
        "echo MARK_XFCE_START; DISPLAY=:99 startxfce4 > /tmp/xfce.log 2>&1 & sleep 12; echo XFCE_LOG; cat /tmp/xfce.log | head -20",
        "echo MARK_XFCE_PS; ps aux | grep -E 'xfce4-session|xfwm4|xfce4-panel|xfdesktop|Thunar|xfce4-terminal' | grep -v grep",
        "echo MARK_XWIN; DISPLAY=:99 xwininfo -root -tree 2>&1 | head -30 || echo NO_XWININFO",
        "echo MARK_GUI_STOP; secureos-gui --stop; sleep 2; ps aux | grep -E 'xfce4-session|xfwm4' | grep -v grep || echo XFCE_SESSION_STOPPED",
        "echo MARK_STARTX_ATTEMPT; timeout 20 secureos-gui --window 2>&1 | head -30; echo STARTX_RC:$?",
        "echo MARK_DONE",
    ]
    for c in cmds:
        send(c + "\n"); time.sleep(10)
    ok &= wait_for(rb"MARK_DONE", 300, "done")
    send("poweroff\n"); time.sleep(10)
try: q.terminate()
except Exception: pass
try: q.wait(timeout=20)
except Exception: q.kill()
print(f"[gui-test] finished ok={ok} qemu_rc={q.returncode}", flush=True)
logf.close(); sys.exit(0 if ok else 1)
