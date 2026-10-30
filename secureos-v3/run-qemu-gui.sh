#!/usr/bin/env bash
# Run SecureOS v3 in QEMU — GRAPHICAL display mode.
# Usage: ./run-qemu-gui.sh [image] [memory-MB]
#   ./run-qemu-gui.sh secureos-v3.img 2048
# This does NOT change the guest's default boot: the guest still boots
# to the CLI + web console on http://127.0.0.1:8000. The difference is
# only the HOST display: this script gives QEMU a real window (gtk/sdl)
# instead of -nographic, so that when you run `secureos-gui` inside the
# guest, the XFCE desktop actually appears in that window.
#   Inside the guest: log in as analyst / secure, then run:
#     secureos-gui            # windowed XFCE
#     secureos-gui --fullscreen
#     secureos-gui --stop     # back to CLI
# Display: SECUREOS_DISPLAY=gtk (default), sdl, or vnc=:1
# Quit QEMU: close the QEMU window, or Ctrl-Alt-Q in the gtk window.
set -euo pipefail
IMG="${1:-$(cd "$(dirname "$0")" && pwd)/secureos-v3.img}"
MEM="${2:-2048}"
DISP="${SECUREOS_DISPLAY:-gtk}"
[ -f "$IMG" ] || { echo "image not found: $IMG" >&2; exit 1; }
echo "SecureOS v3 GUI mode: display=$DISP, RAM=${MEM}MB"
echo "Guest boots to CLI first. Log in as analyst / secure, then run: secureos-gui"
exec qemu-system-x86_64 \
  -m "$MEM" -machine pc -cpu qemu64 \
  -drive file="$IMG",format=raw,if=ide \
  -netdev user,id=net0 -device e1000,netdev=net0 \
  -vga std -display "$DISP" \
  -serial stdio -monitor none
