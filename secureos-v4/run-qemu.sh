#!/usr/bin/env bash
# Run SecureOS v4 in QEMU — CLI mode (default, unchanged from v2).
# Usage: ./run-qemu.sh [image] [memory-MB]
#   ./run-qemu.sh secureos-v4.img 2048
# Inside the guest, log in as: analyst / secure (lab password, change it)
# Then: curl -s http://127.0.0.1:8000/api/health
#       secureos-status
# For the GUI, do NOT use this script — use ./run-qemu-gui.sh instead,
# then run `secureos-gui` inside the guest.
# Quit QEMU: Ctrl-A then X.
set -euo pipefail
IMG="${1:-$(cd "$(dirname "$0")" && pwd)/secureos-v4.img}"
MEM="${2:-2048}"
[ -f "$IMG" ] || { echo "image not found: $IMG" >&2; exit 1; }
exec qemu-system-x86_64 \
  -m "$MEM" -machine pc -cpu qemu64 \
  -drive file="$IMG",format=raw,if=ide \
  -netdev user,id=net0 -device e1000,netdev=net0 \
  -nographic
