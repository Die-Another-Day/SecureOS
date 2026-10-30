#!/usr/bin/env python3
"""Host-side SSH flag driver: PTY ssh, send lab password, run cat flag."""
import os, pty, select, sys
pid, fd = pty.fork()
if pid == 0:
    os.execvp("ssh", ["ssh", "-p", "12222", "-o", "StrictHostKeyChecking=no",
                      "-o", "UserKnownHostsFile=/dev/null",
                      "labuser@127.0.0.1", "cat /home/labuser/flag2.txt"])
buf = b""
sent = False
while True:
    r, _, _ = select.select([fd], [], [], 20)
    if not r:
        break
    try:
        d = os.read(fd, 4096)
    except OSError:
        break
    if not d:
        break
    buf += d
    sys.stdout.buffer.write(d); sys.stdout.buffer.flush()
    if not sent and b"password:" in buf.lower():
        os.write(fd, b"lab123\n"); sent = True
    if b"flag{" in buf:
        break
print("\n[ssh-driver] done sent_password=%s" % sent)
