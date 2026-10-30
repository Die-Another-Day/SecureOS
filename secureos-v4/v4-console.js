// SecureOS v4 console wiring — separate file, like v2/v3-console.js.
// Adds REAL LAB views only: /api/lab, /api/alerts, /api/incidents, /api/flags.
// V3 SOC training scenarios are NOT touched by this file and stay labelled TRAINING.
(function () {
  async function j(path) {
    try { const r = await fetch(path); return await r.json(); } catch (e) { return { ok: false, error: String(e) }; }
  }
  async function renderLab() {
    const box = document.getElementById("secureos-v4-lab");
    if (!box) return;
    const [lab, alerts, inc, flags] = await Promise.all([
      j("/api/lab"), j("/api/alerts"), j("/api/incidents"), j("/api/flags")]);
    box.innerHTML = "<h3>Red vs Blue Lab — REAL LAB INCIDENTS (not training)</h3>"
      + "<p>Lab state: " + (lab.lab_state || "?") + " · LAN IP: " + (lab.lan_ip || "—")
      + " · Console: " + (lab.bind || "") + "</p>"
      + "<p>Flags captured (proven by real log events only): " + JSON.stringify(flags.flags || {}) + "</p>"
      + "<p>Alerts (" + (alerts.count || 0) + "):</p><pre>" + (alerts.alerts || []).map(a => a.type + " :: " + a.line).join("\n").slice(0, 4000) + "</pre>"
      + "<p>Incident timeline (real log lines):</p><pre>" + (inc.timeline || []).map(t => t.line).join("\n").slice(0, 4000) + "</pre>";
  }
  document.addEventListener("DOMContentLoaded", () => {
    const sec = document.createElement("section");
    sec.innerHTML = '<div id="secureos-v4-lab"><p>Loading lab status…</p></div>';
    document.body.appendChild(sec);
    renderLab(); setInterval(renderLab, 15000);
  });
})();
