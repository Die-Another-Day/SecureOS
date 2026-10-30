/* SecureOS v3 console wiring — SEPARATE FILE, does not modify v1 apps.
 * Same localhost-only rule as v2-console.js. On the real OS it:
 *  - upgrades the badge to "REAL OS v3" with kernel + GUI note
 *  - exposes window.SecureOSRealV3 = { system, processes, files, drivers,
 *    logs, battery, network } alongside window.SecureOSReal (v2 methods)
 * On a plain static page every fetch fails quietly and the demo keeps working.
 * SOC triage scenarios remain TRAINING scenarios. Battery in a VM honestly
 * reports "No battery detected (VM / AC power)" — never a faked 100%.
 */
(function () {
  var host = window.location.hostname;
  var isReal = (host === "localhost" || host === "127.0.0.1" || host === "secureos");
  if (!isReal) return;
  function api(path) {
    return fetch(path).then(function (r) { return r.json(); });
  }
  window.SecureOSRealV3 = {
    system: function () { return api("/api/system"); },
    processes: function () { return api("/api/processes"); },
    files: function (path) { return api("/api/files?path=" + encodeURIComponent(path || "/home/analyst")); },
    drivers: function () { return api("/api/drivers"); },
    logs: function () { return api("/api/logs"); },
    battery: function () { return api("/api/battery"); },
    network: function () { return api("/api/network"); },
  };
  api("/api/health").then(function (h) {
    var old = document.getElementById("secureos-real-badge");
    if (old) old.remove();
    var badge = document.createElement("div");
    badge.id = "secureos-real-badge-v3";
    badge.style.cssText = "position:fixed;bottom:10px;right:10px;z-index:9999;background:#0f2;color:#000;font:12px monospace;padding:6px 10px;border-radius:6px";
    badge.textContent = "REAL OS v3 • GUI on demand: secureos-gui • " + (h.kernel || "").split(" ").slice(0, 3).join(" ");
    badge.title = JSON.stringify(h, null, 2);
    document.body.appendChild(badge);
  }).catch(function () {});
})();
