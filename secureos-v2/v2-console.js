/* SecureOS v2 console wiring — SEPARATE FILE, does not modify v1 apps.
 *
 * Loaded only by the v2 OS console (/opt/secureos). When the page is served
 * from the real OS (localhost / 127.0.0.1 / secureos, port 8000), it:
 *   - fetches /api/health and shows a "REAL OS" badge with kernel + nmap versions
 *   - exposes window.SecureOSReal = { health, scan, logs, systemLogs, hash }
 * When served as a plain static page (GitHub Pages / file:// / v1 demo),
 * every fetch fails quietly and the v1 local-JS demo keeps working untouched.
 * SOC triage scenarios remain TRAINING scenarios in both modes.
 */
(function () {
  var host = window.location.hostname;
  var isReal = (host === "localhost" || host === "127.0.0.1" || host === "secureos");
  if (!isReal) return;
  function api(path, body) {
    return fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json(); });
  }
  window.SecureOSReal = {
    health: function () { return api("/api/health"); },
    scan: function (target, mode) { return api("/api/scan", { target: target, mode: mode || "ping" }); },
    logs: function (text) { return api("/api/logs", { text: text }); },
    systemLogs: function () { return api("/api/system-logs"); },
    hash: function (text, algo) { return api("/api/hash", { text: text, algo: algo || "sha256" }); },
  };
  api("/api/health").then(function (h) {
    var badge = document.createElement("div");
    badge.id = "secureos-real-badge";
    badge.style.cssText = "position:fixed;bottom:10px;right:10px;z-index:9999;background:#0f2;color:#000;font:12px monospace;padding:6px 10px;border-radius:6px";
    badge.textContent = "REAL OS • " + (h.kernel || "").split(" ").slice(0, 3).join(" ") + " • " + (h.tools && h.tools.nmap ? h.tools.nmap.split(" ").slice(0, 3).join(" ") : "");
    badge.title = JSON.stringify(h, null, 2);
    document.body.appendChild(badge);
  }).catch(function () { /* static fallback: badge simply never appears */ });
})();
