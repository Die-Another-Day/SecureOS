#!/usr/bin/env bash
# Run SecureOS v2 in QEMU (BIOS boot, serial console on stdio).
# Usage: ./run-qemu.sh [image] [memory-MB]
#   ./run-qemu.sh secureos-v2.img 1024
# Inside the guest, log in as: analyst / secure  (lab password, change it)
# Then: curl -s http://127.0.0.1:8000/api/health
# Quit QEMU: Ctrl-A then X.
set -euo pipefail
IMG="${1:-$(cd "$(dirname "$0")" && pwd)/secureos-v2.img}"
MEM="${2:-1024}"
[ -f "$IMG" ] || { echo "image not found: $IMG" >&2; exit 1; }
exec qemu-system-x86_64 \
  -m "$MEM" -machine pc -cpu qemu64 \
  -drive file="$IMG",format=raw,if=ide \
  -netdev user,id=net0 -device e1000,netdev=net0 \
  -nographic
