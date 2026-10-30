#!/bin/bash
# SecureOS v4 guest setup — run ONCE inside a booted v3 image as root.
# Usage (from the payload dir): sudo bash setup-v4.sh
# Logs to /tmp/v4-setup.log. Idempotent where possible.
set -x
exec > /tmp/v4-setup.log 2>&1
echo "=== SecureOS v4 setup start $(date -u) ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update || echo "APT_UPDATE_FAILED (continuing; auditd/nft may already be present)"
apt-get install -y --no-install-recommends auditd nftables || echo "APT_INSTALL_PARTIAL (auditd/nftables may be missing; see log)"
# Users (LAB ONLY credentials, documented, changeable, disabled by --stop)
id labweb 2>/dev/null || useradd -r -d /srv/labapp -s /usr/sbin/nologin labweb
id labuser 2>/dev/null || useradd -m -s /bin/bash labuser
echo 'labuser:lab123' | chpasswd
# Directories
mkdir -p /srv/labapp/plugins /srv/labapp/public /srv/labapp/flags /var/log/secureos-lab /var/lib/secureos-lab /etc/secureos-lab
# Payload files (this script lives in the payload dir)
P="$(cd "$(dirname "$0")" && pwd)"
cp "$P/labapp.py" /srv/labapp/labapp.py
cp "$P/server.py" /opt/secureos/server.py
cp "$P/v4-console.js" /opt/secureos/v4-console.js
cp "$P/secureos-labapp.service" "$P/secureos-ssh-lab.service" "$P/secureos.service" /etc/systemd/system/
for h in secureos-lab secureos-ir secureos-fim secureos-lab-reset-flags; do
  cp "$P/bin/$h" "/usr/local/bin/$h"; chmod 755 "/usr/local/bin/$h"
done
# Also keep v3 helpers (already in /usr/local/bin from v3 image)
# Console wiring: add v4-console.js after v3-console.js if not present
python3 - <<'PY'
p="/opt/secureos/index.html"
try:
    s=open(p).read()
    if "v4-console.js" not in s:
        s=s.replace("</body>", '<script src="v4-console.js"></script>\n</body>')
        open(p,"w").write(s)
        print("v4-console.js injected into index.html")
except Exception as e:
    print("index.html inject failed:", e)
PY
# Ownership / permissions (flags separated by user, see labapp.py)
chown -R labweb:labweb /srv/labapp
chmod 755 /srv/labapp
chmod 700 /srv/labapp/flags 2>/dev/null || true
chown -R analyst:analyst /home/analyst 2>/dev/null || true
# SSH host keys (openssh-server is already in v3, masked by default)
ssh-keygen -A 2>/dev/null || true
mkdir -p /var/log/secureos-lab
chown labweb:labweb /var/log/secureos-lab 2>/dev/null || true
chmod 755 /var/log/secureos-lab 2>/dev/null || true
# Auditd rules (real detection; if auditd fails in QEMU, journal/auth/app logs still work)
cat > /etc/audit/rules.d/secureos-lab.rules <<'EOF'
-w /srv/labapp -p wa -k secureos_lab
-w /home/labuser -p wa -k secureos_labuser
-w /etc/secureos-lab -p wa -k secureos_labstate
EOF
systemctl restart auditd 2>/dev/null || systemctl start auditd 2>/dev/null || echo "AUDITD_START_FAILED"
augenrules --load 2>/dev/null || auditctl -R /etc/audit/rules.d/secureos-lab.rules 2>/dev/null || echo "AUDIT_RULES_LOAD_FAILED"
# Default state: LAB OFF
printf 'disabled\n' > /etc/secureos-lab/state
rm -f /etc/secureos-lab/env
# Lab units are NOT enabled on boot (default OFF). They are started only by secureos-lab --enable.
systemctl daemon-reload
systemctl enable secureos.service 2>/dev/null || true
systemctl restart secureos.service
# Flag 2 + FIM manifest (labapp creates DB/flag3 on first start)
secureos-lab-reset-flags || echo "FLAG2_FAILED"
# Start labapp briefly as labweb to create DB/flag3, then stop (lab stays OFF by default)
# Use the unit with a temporary bind to localhost, then stop it.
printf 'SECUREOS_BIND_IP=127.0.0.1\n' > /etc/secureos-lab/env
systemctl restart secureos-labapp.service || echo "LABAPP_FIRST_START_FAILED"
sleep 3
curl -s http://127.0.0.1:8080/ | head -c 300; echo
systemctl stop secureos-labapp.service
rm -f /etc/secureos-lab/env
chown labweb:labweb /srv/labapp/lab.db /srv/labapp/flags/flag3.txt 2>/dev/null || true
chmod 600 /srv/labapp/lab.db /srv/labapp/flags/flag3.txt 2>/dev/null || true
secureos-fim --init || echo "FIM_INIT_FAILED"
curl -s http://127.0.0.1:8000/api/health | head -c 500; echo
echo "=== SecureOS v4 setup done $(date -u) ==="
ls -l /srv/labapp/ /usr/local/bin/secureos-* /etc/systemd/system/secureos-*.service
