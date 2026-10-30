#!/usr/bin/env python3
"""First boot of a v3 image copy: download the v4 payload from the host
(QEMU user-net gateway 10.0.2.2, host HTTP server on port 18765), extract
it, and run setup-v4.sh as root via sudo. Then power off. The resulting
image is the v4 image. Log to logs/setup-v4.log.
Usage: guest-setup-v4.py <image> <logfile>
"""
import os, pty, re, select, subprocess, sys, time
IMG, LOG = sys.argv[1], sys.argv[2]
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
                print(f"\n[setup] MATCH {label}\n", flush=True); return True
        if q.poll() is not None:
            print(f"\n[setup] QEMU EXITED rc={q.returncode}\n", flush=True); return False
    print(f"\n[setup] TIMEOUT {label}\n", flush=True); return False
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
        "echo MARK_NET; ip -brief addr; ping -c1 -W5 10.0.2.2 || echo PING_GW_FAIL",
        "echo MARK_DL; mkdir -p ~/v4 && cd ~/v4 && curl -f -o v4-payload.tar.gz http://10.0.2.2:18765/v4-payload.tar.gz && ls -lh v4-payload.tar.gz && tar xzf v4-payload.tar.gz && ls -R | head -n 60",
        "echo MARK_SETUP; echo secure | sudo -S bash ~/v4/setup-v4.sh; echo SETUP_RC=$?",
        "echo MARK_SETUP_LOG; tail -n 100 /tmp/v4-setup.log",
        "echo MARK_DONE",
    ]
    for c in cmds:
        send(c + "\n"); time.sleep(15)
    # setup itself takes a while (apt); wait longer
    ok &= wait_for(rb"MARK_DONE", 1200, "setup done")
    send("poweroff\n"); time.sleep(10)
try: q.terminate()
except Exception: pass
try: q.wait(timeout=20)
except Exception: q.kill()
print(f"[setup] finished ok={ok} qemu_rc={q.returncode}", flush=True)
logf.close(); sys.exit(0 if ok else 1)
