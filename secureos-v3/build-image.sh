#!/usr/bin/env bash
# SecureOS v3 — build a REAL bootable Debian bookworm disk image.
# v3 adds: Xorg + XFCE GUI on demand (secureos-gui), NetworkManager,
# drivers/tools, persistent journal, htop, upower, and new /api/* endpoints.
# Default boot is STILL CLI + web console on http://127.0.0.1:8000.
#
# Usage:  ./build-image.sh [output-dir]
# Default output dir: the directory containing this script.
# Produces: secureos-v3.img (raw, MBR + GRUB BIOS, single ext4 partition)
#           secureos-v3.img.sha256
#
# Why no loop devices? This script is written to work in containers where
# /dev/loop does not exist: the root filesystem is built with debootstrap
# + chroot, packed with `mkfs.ext4 -d <rootfs>` (no mount needed), and
# GRUB BIOS is installed manually: boot.img in the MBR (partition table
# preserved), core.img in the post-MBR gap, grub.cfg inside /boot/grub.
# The resulting image boots in QEMU and can be dd'd to a USB stick.
#
# Requirements (host): debootstrap, grub-mkimage, mkfs.ext4, python3.
# Idempotent-ish: re-running wipes $WORK/rootfs and rebuilds the image.
# Set -euo pipefail; every step logs to stdout (redirect to logs/ to keep).
set -euo pipefail

OUT="${1:-$(cd "$(dirname "$0")" && pwd)}"
SRC="$(cd "$(dirname "$0")" && pwd)"
WORK="$OUT/.build"
ROOTFS="$WORK/rootfs"
IMG="$OUT/secureos-v3.img"
IMG_SIZE_MB="${IMG_SIZE_MB:-5120}"
PART_OFFSET_MB=1

log() { echo "[build] $*"; }
die() { echo "[build] ERROR: $*" >&2; exit 1; }

command -v debootstrap >/dev/null || die "debootstrap not found"
command -v grub-mkimage >/dev/null || die "grub-mkimage not found (install grub-pc-bin)"
command -v mkfs.ext4 >/dev/null || die "mkfs.ext4 not found"
command -v python3 >/dev/null || die "python3 not found"

log "output dir: $OUT"
# SECUREOS_REUSE_ROOTFS=1 skips debootstrap+setup when a complete rootfs
# already exists in $WORK/rootfs (faster rebuilds; default is a clean build).
REUSE=0
if [ "${SECUREOS_REUSE_ROOTFS:-0}" = "1" ] && ls "$ROOTFS"/boot/vmlinuz-* >/dev/null 2>&1; then
  REUSE=1
  log "reusing existing rootfs in $ROOTFS (SECUREOS_REUSE_ROOTFS=1)"
fi
if [ "$REUSE" = 0 ]; then
  rm -rf "$WORK"
  mkdir -p "$WORK" "$ROOTFS"

# --- 1. debootstrap: real Debian bookworm, minimal -------------------------
# fakeroot+fakechroot: some container hosts drop CAP_CHOWN, so plain tar
# extraction fails on files owned by non-root groups (e.g. /var/local
# root:staff). fakeroot fakes those chowns; fakechroot fakes the chroot so
# the second stage runs without privilege. GRUB is NOT installed inside
# the chroot (its postinst wants a real disk); GRUB BIOS is installed
# manually in §6.
log "debootstrap bookworm (this downloads ~300MB)..."
fakechroot fakeroot debootstrap --arch=amd64 --variant=fakechroot bookworm "$ROOTFS" http://deb.debian.org/debian
# fakechroot variant may leave the second stage pending; run it if present.
if [ -x "$ROOTFS/debootstrap/debootstrap" ]; then
  log "running debootstrap second stage under fakechroot..."
  fakechroot fakeroot chroot "$ROOTFS" /debootstrap/debootstrap --second-stage || true
fi
fi
mkdir -p "$WORK" "$ROOTFS"

# --- 2. inside the chroot: real kernel, systemd, defensive tools -----------
# (skipped entirely when reusing a complete rootfs)
if [ "$REUSE" = 0 ]; then
log "configuring rootfs..."
cat > "$ROOTFS/etc/apt/sources.list" <<'EOF'
deb http://deb.debian.org/debian bookworm main contrib non-free-firmware
deb http://deb.debian.org/debian-security bookworm-security main contrib non-free-firmware
deb http://deb.debian.org/debian bookworm-updates main contrib non-free-firmware
EOF
printf 'secureos\n' > "$ROOTFS/etc/hostname"
printf '127.0.0.1 localhost secureos\n::1 localhost ip6-localhost ip6-loopback\n' > "$ROOTFS/etc/hosts"

# Console + serial getty (QEMU -nographic uses ttyS0), ssh disabled by default.
mkdir -p "$ROOTFS/etc/systemd/system/getty.target.wants"
ln -sf /usr/lib/systemd/system/getty@.service \
  "$ROOTFS/etc/systemd/system/getty.target.wants/getty@tty1.service"
ln -sf /usr/lib/systemd/system/serial-getty@.service \
  "$ROOTFS/etc/systemd/system/getty.target.wants/serial-getty@ttyS0.service"

cp "$SRC/server.py" "$ROOTFS/usr/local/lib/secureos-server.py"
chmod 755 "$ROOTFS/usr/local/lib/secureos-server.py"
mkdir -p "$ROOTFS/opt/secureos"

# chroot script: apt install + user + service. /proc is mounted for apt/dpkg.
mount -t proc proc "$ROOTFS/proc" 2>/dev/null || true
cat > "$ROOTFS/tmp/setup.sh" <<'SETUP_EOF'
set -eux
export DEBIAN_FRONTEND=noninteractive
# fakechroot breaks systemd-sysusers (libsystemd-shared-252.so cannot be
# loaded under the preloaded fakechroot libs), which makes polkitd's
# postinst fail and leaves network-manager unconfigured. Stub sysusers
# during install only; real systemd-sysusers runs at first boot and
# creates the missing system users from /usr/lib/sysusers.d/*.conf.
if [ -x /usr/bin/systemd-sysusers ]; then
  cp /usr/bin/systemd-sysusers /tmp/systemd-sysusers.real || true
  printf '#!/bin/sh\nexit 0\n' > /usr/bin/systemd-sysusers
  chmod +x /usr/bin/systemd-sysusers || true
  # Restore the real binary even if apt aborts (set -e) later.
  trap 'cp /tmp/systemd-sysusers.real /usr/bin/systemd-sysusers 2>/dev/null || true' EXIT
  # polkitd's postinst expects systemd-sysusers to have created this user;
  # the stub above cannot, so pre-create it to match polkitd.conf
  # (u polkitd - "polkit" /nonexistent) before apt runs.
  groupadd -r polkitd 2>/dev/null || true
  useradd -r -g polkitd -d /nonexistent -s /usr/sbin/nologin -c "polkit" polkitd 2>/dev/null || true
fi
apt-get update
apt-get install -y --no-install-recommends \
  linux-image-amd64 systemd systemd-sysv openssh-server dbus dbus-x11 \
  python3 iproute2 iputils-ping procps psmisc nmap tcpdump \
  tshark wireshark-common openssl curl ca-certificates sudo \
  netbase ifupdown isc-dhcp-client kmod e2fsprogs util-linux \
  xorg xfce4 xfce4-panel thunar xfce4-terminal xfce4-taskmanager \
  xfce4-power-manager mousepad firefox-esr x11-xserver-utils xvfb \
  network-manager wpasupplicant wireless-tools iw \
  pciutils usbutils lshw firmware-linux upower acpi htop
# OpenSSH: installed but MASKED by default (lab use only, see README-v2).
# Plain `systemctl disable` proved insufficient in the QEMU boot (ssh still
# started via the SysV-generator path), so mask service + socket outright.
systemctl disable ssh.service ssh.socket || true
ln -sf /dev/null /etc/systemd/system/ssh.service
ln -sf /dev/null /etc/systemd/system/ssh.socket
ln -sf /dev/null /etc/systemd/system/sshd.service
# User analyst / password "secure" — LAB ONLY, change on first login.
useradd -m -s /bin/bash -G sudo analyst
echo 'analyst:secure' | chpasswd
mkdir -p /home/analyst/Documents /home/analyst/Downloads /home/analyst/Projects /home/analyst/Logs
chown -R analyst:analyst /home/analyst
# Persistent systemd journal (v3 logging system)
mkdir -p /var/log/journal
# NetworkManager manages ethernet/wifi; keep only loopback in interfaces
printf 'auto lo\niface lo inet loopback\n' > /etc/network/interfaces
systemctl enable NetworkManager 2>/dev/null || true
# SecureOS console service (localhost only, see server.py).
cp /usr/local/lib/secureos-server.py /opt/secureos/server.py
cat > /etc/systemd/system/secureos.service <<'UNIT_EOF'
[Unit]
Description=SecureOS v3 console (localhost only)
After=network.target
[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/secureos/server.py
Restart=on-failure
User=root
Environment=SECUREOS_ALLOW_PUBLIC=0
StandardOutput=journal
StandardError=journal
[Install]
WantedBy=multi-user.target
UNIT_EOF
systemctl enable secureos.service
chmod 644 /etc/systemd/system/secureos.service
# Restore the real systemd-sysusers (see stub above) before finishing.
if [ -f /tmp/systemd-sysusers.real ]; then
  cp /tmp/systemd-sysusers.real /usr/bin/systemd-sysusers || true
  rm -f /tmp/systemd-sysusers.real
fi
# Default target: multi-user (CLI). No display manager is enabled on purpose:
# the GUI starts ONLY when the user runs `secureos-gui` (see bin/secureos-gui).
ln -sf /lib/systemd/system/multi-user.target /etc/systemd/system/default.target
apt-get clean
rm -rf /var/lib/apt/lists/*
SETUP_EOF
chmod +x "$ROOTFS/tmp/setup.sh"
# Run the guest setup WITHOUT the util-linux chroot binary: under
# fakechroot that binary loads the guest libc (older than the host's) and
# dies on missing GLIBC symbols. Instead, exec the guest bash directly
# with libfakechroot + libfakeroot preloaded: path translation makes
# /usr/bin/apt-get etc. resolve inside the rootfs, and fakeroot absorbs
# any chown the container cannot really perform.
FC_LIB="$(ls /usr/lib/x86_64-linux-gnu/fakechroot/libfakechroot.so /usr/lib/*/fakechroot/libfakechroot.so 2>/dev/null | head -1)"
FR_LIB="$(ls /usr/lib/x86_64-linux-gnu/libfakeroot/libfakeroot-sysv.so /usr/lib/*/libfakeroot/libfakeroot-sysv.so 2>/dev/null | head -1)"
[ -n "$FC_LIB" ] && [ -n "$FR_LIB" ] || die "libfakechroot or libfakeroot not found (install fakechroot, fakeroot)"
FAKECHROOT_BASE="$ROOTFS" FAKECHROOT_EXCLUDE_PATH=/dev:/proc:/sys \
  LD_PRELOAD="$FC_LIB:$FR_LIB" "$ROOTFS/bin/bash" /tmp/setup.sh
rm -f "$ROOTFS/tmp/setup.sh"
# Fix fakechroot symlink artifacts: update-alternatives and systemctl
# created absolute symlinks prefixed with the host rootfs path. Strip
# the prefix so every symlink resolves on the booted system.
python3 - "$ROOTFS" <<'PYEOF'
import os, sys
root = sys.argv[1]
fixed = 0
for dirpath, dirnames, filenames in os.walk(root):
    for name in dirnames + filenames:
        p = os.path.join(dirpath, name)
        if os.path.islink(p):
            t = os.readlink(p)
            if t.startswith(root):
                os.unlink(p)
                os.symlink(t[len(root):], p)
                fixed += 1
print(f"[build] fixed {fixed} host-prefixed symlinks")
PYEOF
umount "$ROOTFS/proc" 2>/dev/null || true
fi  # end REUSE=0 configure+setup block

# --- 2b. v3 upgrade step (runs ONLY when the GUI stack is missing) --------
# This is what makes a REUSE build (v2 rootfs cache) into a v3 image:
# install the v3-only packages, create home folders, persistent journal,
# and install the secureos-* helpers. A clean build already did this in
# setup.sh, so this block is skipped then (startxfce4 exists).
if [ ! -x "$ROOTFS/usr/bin/startxfce4" ] || [ ! -x "$ROOTFS/usr/local/bin/secureos-gui" ]; then
  log "v3 upgrade: installing GUI + OS-system packages into rootfs..."
  mount -t proc proc "$ROOTFS/proc" 2>/dev/null || true
  cat > "$ROOTFS/tmp/v3-upgrade.sh" <<'V3UP_EOF'
set -eux
export DEBIAN_FRONTEND=noninteractive
# fakechroot breaks systemd-sysusers (libsystemd-shared-252.so cannot be
# loaded under the preloaded fakechroot libs), which makes polkitd's
# postinst fail and leaves network-manager unconfigured. Stub sysusers
# during install only; real systemd-sysusers runs at first boot and
# creates the missing system users from /usr/lib/sysusers.d/*.conf.
if [ -x /usr/bin/systemd-sysusers ]; then
  cp /usr/bin/systemd-sysusers /tmp/systemd-sysusers.real || true
  printf '#!/bin/sh\nexit 0\n' > /usr/bin/systemd-sysusers
  chmod +x /usr/bin/systemd-sysusers || true
  # Restore the real binary even if apt aborts (set -e) later.
  trap 'cp /tmp/systemd-sysusers.real /usr/bin/systemd-sysusers 2>/dev/null || true' EXIT
  # polkitd's postinst expects systemd-sysusers to have created this user;
  # the stub above cannot, so pre-create it to match polkitd.conf
  # (u polkitd - "polkit" /nonexistent) before apt runs.
  groupadd -r polkitd 2>/dev/null || true
  useradd -r -g polkitd -d /nonexistent -s /usr/sbin/nologin -c "polkit" polkitd 2>/dev/null || true
fi
apt-get update
apt-get install -y --no-install-recommends \
  xorg xfce4 xfce4-panel thunar xfce4-terminal xfce4-taskmanager \
  xfce4-power-manager mousepad firefox-esr x11-xserver-utils xvfb dbus-x11 \
  network-manager wpasupplicant wireless-tools iw \
  pciutils usbutils lshw firmware-linux upower acpi htop
mkdir -p /home/analyst/Documents /home/analyst/Downloads /home/analyst/Projects /home/analyst/Logs /var/log/journal
chown -R analyst:analyst /home/analyst 2>/dev/null || true
printf 'auto lo\niface lo inet loopback\n' > /etc/network/interfaces
systemctl enable NetworkManager 2>/dev/null || true
apt-get clean
rm -rf /var/lib/apt/lists/*
V3UP_EOF
  chmod +x "$ROOTFS/tmp/v3-upgrade.sh"
  FC_LIB="$(ls /usr/lib/x86_64-linux-gnu/fakechroot/libfakechroot.so /usr/lib/*/fakechroot/libfakechroot.so 2>/dev/null | head -1)"
  FR_LIB="$(ls /usr/lib/x86_64-linux-gnu/libfakeroot/libfakeroot-sysv.so /usr/lib/*/libfakeroot/libfakeroot-sysv.so 2>/dev/null | head -1)"
  [ -n "$FC_LIB" ] && [ -n "$FR_LIB" ] || die "libfakechroot or libfakeroot not found (install fakechroot, fakeroot)"
  FAKECHROOT_BASE="$ROOTFS" FAKECHROOT_EXCLUDE_PATH=/dev:/proc:/sys \
    LD_PRELOAD="$FC_LIB:$FR_LIB" "$ROOTFS/bin/bash" /tmp/v3-upgrade.sh
  rm -f "$ROOTFS/tmp/v3-upgrade.sh"
  umount "$ROOTFS/proc" 2>/dev/null || true
  # Fix fakechroot symlink artifacts again after the upgrade install
  python3 - "$ROOTFS" <<'PYEOF'
import os, sys
root = sys.argv[1]
for dirpath, dirnames, filenames in os.walk(root):
    for name in dirnames + filenames:
        pp = os.path.join(dirpath, name)
        if os.path.islink(pp):
            tt = os.readlink(pp)
            if tt.startswith(root):
                os.unlink(pp); os.symlink(tt[len(root):], pp)
PYEOF
else
  log "v3 upgrade: GUI stack already present, skipping upgrade install"
fi
# Install secureos-* CLI helpers (always, so they are never stale)
mkdir -p "$ROOTFS/usr/local/bin"
for h in secureos-gui secureos-status secureos-logs secureos-net secureos-drivers; do
  if [ -f "$SRC/bin/$h" ]; then cp "$SRC/bin/$h" "$ROOTFS/usr/local/bin/$h"; chmod 755 "$ROOTFS/usr/local/bin/$h"; fi
done
# XFCE console launcher for the analyst user (also created by secureos-gui at runtime)
mkdir -p "$ROOTFS/home/analyst/.config/autostart"
cat > "$ROOTFS/home/analyst/.config/autostart/secureos-console.desktop" <<'DESK_EOF'
[Desktop Entry]
Type=Application
Name=SecureOS Console
Exec=firefox-esr http://127.0.0.1:8000
Comment=Open the local SecureOS web console
X-GNOME-Autostart-enabled=true
DESK_EOF
# Numeric UID:GID: the host has no "analyst" user, so a named chown fails
# (and was hidden by || true, leaving .config root-owned and breaking
# secureos-gui). Guest analyst is UID 1000, GID 1000 (see guest /etc/passwd).
chown -R 1000:1000 "$ROOTFS/home/analyst/.config"

# --- 3. console frontend into /opt/secureos --------------------------------
# Copy the v1 static frontend (index.html, app.js, style.css, apps/, secureos/)
# so the OS console is the same desktop, now backed by the real server.
# Frontend lives in the repo root. Work layout: SRC=.../secureos-build/secureos-v3,
# repo at .../secureos-build/loveos-repo. Repo layout: script inside the repo,
# repo root is SRC/.. . Prefer the first candidate that actually has index.html.
REPO_ROOT="${SECUREOS_REPO_ROOT:-}"
if [ -z "$REPO_ROOT" ]; then
  for cand in "$SRC/../loveos-repo" "$SRC/.."; do
    if [ -f "$cand/index.html" ]; then REPO_ROOT="$cand"; break; fi
  done
  [ -z "$REPO_ROOT" ] && REPO_ROOT="$SRC/.."
fi
log "repo root for console frontend: $REPO_ROOT"
for f in index.html app.js style.css; do
  [ -f "$REPO_ROOT/$f" ] && cp "$REPO_ROOT/$f" "$ROOTFS/opt/secureos/"
done
cp -r "$REPO_ROOT/apps" "$REPO_ROOT/secureos" "$ROOTFS/opt/secureos/" 2>/dev/null || true
cp "$SRC/server.py" "$ROOTFS/opt/secureos/server.py"
cp "$SRC/v3-console.js" "$ROOTFS/opt/secureos/v3-console.js" 2>/dev/null || true
if [ -f "$REPO_ROOT/secureos-v2/v2-console.js" ]; then cp "$REPO_ROOT/secureos-v2/v2-console.js" "$ROOTFS/opt/secureos/v2-console.js"; fi
# Load the v2 + v3 wiring after the v1 app script, if present.
if grep -q 'app.js' "$ROOTFS/opt/secureos/index.html" 2>/dev/null; then
  python3 - "$ROOTFS/opt/secureos/index.html" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p).read()
for f in ("v2-console.js", "v3-console.js"):
    if f not in s:
        s = s.replace("</body>", '<script src="%s"></script>\n</body>' % f)
open(p, "w").write(s)
PYEOF
fi

# --- 4. grub.cfg inside the rootfs -----------------------------------------
# fakechroot leaves /dev and /proc as symlinks to the HOST's /dev and /proc.
# On a booted system those are self-referential loops and break switch_root
# ("Too many symbolic links", "Target filesystem doesn't have /sbin/init").
# Replace them with real directories; kernel devtmpfs + proc populate them.
for d in dev proc; do
  if [ -L "$ROOTFS/$d" ]; then rm "$ROOTFS/$d"; mkdir "$ROOTFS/$d"; fi
done
# Re-assert the post-setup hardening (also covers reused rootfs images):
# ssh masked, multi-user default, unit readable by systemd without warnings.
ln -sf /dev/null "$ROOTFS/etc/systemd/system/ssh.service"
ln -sf /dev/null "$ROOTFS/etc/systemd/system/ssh.socket"
ln -sf /dev/null "$ROOTFS/etc/systemd/system/sshd.service"
ln -sf /lib/systemd/system/multi-user.target "$ROOTFS/etc/systemd/system/default.target"
chmod 644 "$ROOTFS/etc/systemd/system/secureos.service" 2>/dev/null || true
chmod -R a+rX "$ROOTFS/opt/secureos" 2>/dev/null || true
# Final sweep: strip any remaining host-prefixed symlink targets (from any
# later fakechroot step, e.g. an incremental package install).
python3 - "$ROOTFS" <<'PYEOF'
import os, sys
root = sys.argv[1]
fixed = 0
for dirpath, dirnames, filenames in os.walk(root):
    for name in dirnames + filenames:
        p = os.path.join(dirpath, name)
        if os.path.islink(p):
            t = os.readlink(p)
            if t.startswith(root):
                os.unlink(p)
                os.symlink(t[len(root):], p)
                fixed += 1
print(f"[build] final symlink sweep fixed {fixed}")
PYEOF
rm -f "$ROOTFS/boot"/initrd.img-*.dpkg-bak "$ROOTFS/boot"/initrd.img-*.new
KERNEL="$(ls "$ROOTFS/boot"/vmlinuz-* | head -1 | xargs basename)"
INITRD="$(ls "$ROOTFS/boot"/initrd.img-* | head -1 | xargs basename)"
[ -n "$KERNEL" ] || die "no kernel found in rootfs /boot"
mkdir -p "$ROOTFS/boot/grub"
cat > "$ROOTFS/boot/grub/grub.cfg" <<GRUB_EOF
set timeout=5
set default=0
menuentry "SecureOS v3" {
  set root=(hd0,msdos1)
  linux /boot/$KERNEL root=/dev/sda1 rw console=tty0 console=ttyS0,115200
  initrd /boot/$INITRD
}
GRUB_EOF
printf '/dev/sda1 / ext4 defaults 0 1\n' > "$ROOTFS/etc/fstab"

# --- 5. pack rootfs into ext4 WITHOUT mounting (mkfs.ext4 -d) --------------
log "packing ext4 filesystem (${IMG_SIZE_MB}MB image, partition at ${PART_OFFSET_MB}MiB)..."
FS_SIZE_MB=$((IMG_SIZE_MB - PART_OFFSET_MB))
# ^metadata_csum/^64bit: keeps the filesystem readable by GRUB's ext2 module.
mkfs.ext4 -q -O ^metadata_csum,^64bit -d "$ROOTFS" -L secureos "$WORK/root.ext4" "${FS_SIZE_MB}M"
# Fix up: mkfs -d preserves host /dev nodes poorly; ensure basics exist.
# (systemd creates /dev at boot via devtmpfs, so a sparse /dev is fine.)

# --- 6. assemble raw disk: MBR partition table + GRUB BIOS ------------------
log "assembling raw disk image..."
python3 - "$IMG" "$WORK/root.ext4" "$PART_OFFSET_MB" <<'PYEOF'
import struct, sys
img_path, fs_path, off_mb = sys.argv[1], sys.argv[2], int(sys.argv[3])
off = off_mb * 1024 * 1024
with open(fs_path, "rb") as f:
    fs = f.read()
total = off + len(fs)
with open(img_path, "wb") as out:
    out.truncate(total)
    # MBR: one bootable Linux partition (0x83) starting at `off`, size in sectors.
    mbr = bytearray(512)
    sectors = len(fs) // 512
    entry = struct.pack("<BBBBBBBBII", 0x80, 0, 2, 0, 0x83, 0xFE, 0xFF, 0xFF,
                        off // 512, sectors)
    mbr[446:462] = entry
    mbr[510:512] = b"\x55\xaa"
    out.seek(0); out.write(mbr)
    out.seek(off); out.write(fs)
print(f"image bytes={total} fs_bytes={len(fs)}")
PYEOF

# GRUB: boot.img -> MBR (keep partition table), core.img -> post-MBR gap.
GRUB_DIR="$(dirname "$(command -v grub-mkimage)")/../lib/grub/i386-pc"
[ -f "$GRUB_DIR/boot.img" ] || GRUB_DIR="/usr/lib/grub/i386-pc"
[ -f "$GRUB_DIR/boot.img" ] || die "grub i386-pc boot.img not found under $GRUB_DIR"
grub-mkimage -O i386-pc -o "$WORK/core.img" \
  -p '(hd0,msdos1)/boot/grub' biosdisk part_msdos ext2 normal linux \
  search search_fs_uuid configfile
python3 - "$IMG" "$GRUB_DIR/boot.img" "$WORK/core.img" <<'PYEOF'
import sys
img, boot, core = sys.argv[1], sys.argv[2], sys.argv[3]
bootimg = open(boot, "rb").read()
coreimg = open(core, "rb").read()
with open(img, "r+b") as f:
    # Preserve the partition table we just wrote (bytes 446..510).
    mbr = bytearray(f.read(512))
    newboot = bytearray(bootimg[:446])
    newboot += mbr[446:512]
    f.seek(0); f.write(newboot)
    f.seek(512); f.write(coreimg)
print(f"grub: boot.img={len(bootimg)} core.img={len(coreimg)}")
PYEOF

sha256sum "$IMG" | tee "$IMG.sha256"
log "DONE: $IMG"
ls -lh "$IMG"
du -sh "$ROOTFS"
