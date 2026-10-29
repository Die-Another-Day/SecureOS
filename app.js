/* SecureOS v1.0 — desktop shell + window manager.
   Demo login only: passphrase "secure". All apps are local-first. */
document.addEventListener("DOMContentLoaded", () => {
  const loginOverlay = document.getElementById("loginOverlay");
  const loginBtn = document.getElementById("loginBtn");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const loginMsg = document.getElementById("loginMsg");
  const desktop = document.getElementById("desktop");
  const taskUser = document.getElementById("taskUser");
  const windows = document.getElementById("windows");
  const iconsEl = document.getElementById("desktopIcons");
  const ticker = document.getElementById("ticker");

  const SECRET = "secure"; // demo passphrase, not real auth
  let zTop = 100;

  const APPS = [
    { id: "soc", icon: "🛡️", label: "SOC Center" },
    { id: "password", icon: "🔑", label: "Password Lab" },
    { id: "hash", icon: "#️⃣", label: "Hash Lab" },
    { id: "phishing", icon: "🎣", label: "Phishing Analyzer" },
    { id: "logs", icon: "📜", label: "Log Analyzer" },
    { id: "vault", icon: "🔒", label: "Vault Notes" },
    { id: "netlab", icon: "🌐", label: "Network Lab" },
    { id: "intel", icon: "🧠", label: "Threat Intel" },
    { id: "terminal", icon: "💻", label: "Secure Terminal" },
  ];

  function createToolbar(name) {
    const bar = document.createElement("div");
    bar.className = "toolbar";
    bar.innerHTML = `
      <div class="menu">
        <button id="menuBtn">☰ Start</button>
        <div id="menuDropdown" class="menu-dropdown hidden">
          ${APPS.map((a) => `<div class="menu-item" data-app="${a.id}">${a.icon} ${a.label}</div>`).join("")}
        </div>
      </div>
      <div>
        <button id="socBtn">🛡️ SOC Center</button>
        <button id="termBtn">💻 Terminal</button>
        <span class="muted small" id="clock"></span>
        <button id="logoutBtn">⏻ Lock</button>
      </div>`;
    document.body.prepend(bar);
    const dd = bar.querySelector("#menuDropdown");
    bar.querySelector("#menuBtn").addEventListener("click", () => dd.classList.toggle("hidden"));
    bar.querySelectorAll(".menu-item").forEach((el) => el.addEventListener("click", () => { dd.classList.add("hidden"); openApp(el.dataset.app); }));
    bar.querySelector("#socBtn").addEventListener("click", () => openApp("soc"));
    bar.querySelector("#termBtn").addEventListener("click", () => openApp("terminal"));
    bar.querySelector("#logoutBtn").addEventListener("click", () => {
      if (confirm("Lock SecureOS and return to the login screen?")) { localStorage.removeItem("secureos_user"); location.reload(); }
    });
    const clock = bar.querySelector("#clock");
    const tick = () => { clock.textContent = new Date().toLocaleTimeString(); };
    tick(); setInterval(tick, 1000);
  }

  function openApp(id) {
    const app = APPS.find((a) => a.id === id);
    const def = window.SecureApps && window.SecureApps[id];
    if (!app || !def) { alert("App not available: " + id); return; }
    const existing = document.querySelector(`.app-window[data-app="${id}"]`);
    if (existing) { existing.style.zIndex = ++zTop; return; }
    const win = document.createElement("div");
    win.className = "app-window";
    win.dataset.app = id;
    win.style.zIndex = ++zTop;
    win.innerHTML = `<div class="app-header"><div class="app-title">${def.title}</div><button class="closeBtn" title="Close">✕</button></div><div class="app-body"></div>`;
    const body = win.querySelector(".app-body");
    body.innerHTML = def.html();
    windows.appendChild(win);
    win.querySelector(".closeBtn").addEventListener("click", () => win.remove());
    win.addEventListener("mousedown", () => { win.style.zIndex = ++zTop; });
    // Drag by header
    const header = win.querySelector(".app-header");
    let ox = 0, oy = 0, down = false;
    header.addEventListener("mousedown", (e) => { down = true; ox = e.clientX - win.offsetLeft; oy = e.clientY - win.offsetTop; });
    document.addEventListener("mouseup", () => { down = false; });
    document.addEventListener("mousemove", (e) => { if (!down) return; win.style.left = Math.max(0, e.clientX - ox) + "px"; win.style.top = Math.max(0, e.clientY - oy) + "px"; });
    try { def.init(body); } catch (err) { body.innerHTML += `<div class="result bad">App failed to start: ${err.message}</div>`; }
  }
  window.SecureOS_openApp = openApp;

  function showDesktop(name) {
    loginOverlay.classList.add("hidden");
    loginOverlay.style.display = "none";
    desktop.classList.remove("hidden");
    taskUser.textContent = name + "  •  SecureOS v1.0";
    localStorage.setItem("secureos_user", name);
    iconsEl.innerHTML = APPS.map((a) => `<div class="icon" data-app="${a.id}"><b>${a.icon}</b><span>${a.label}</span></div>`).join("");
    iconsEl.querySelectorAll(".icon").forEach((el) => el.addEventListener("click", () => openApp(el.dataset.app)));
    createToolbar(name);
    openApp("soc");
    const alerts = [
      "🛡️ SOC: 4 simulated incidents awaiting triage — open SOC Center",
      "🔑 Password Lab: test a password locally, generate a passphrase",
      "🎣 Phishing Analyzer: paste a link — it is never opened or fetched",
      "📜 Log Analyzer: brute-force, SQLi and traversal patterns, counted locally",
      "🔒 Vault Notes: AES-GCM encrypted notes, stored only in this browser",
    ];
    let ai = 0;
    setInterval(() => { if (ticker) ticker.textContent = alerts[ai++ % alerts.length]; }, 5000);
  }

  function tryLogin() {
    const user = usernameInput.value.trim();
    const pass = passwordInput.value.trim();
    if (!user) { loginMsg.textContent = "Enter an operator name first."; return; }
    if (pass === SECRET) { showDesktop(user); }
    else { loginMsg.textContent = "Wrong passphrase for this demo. Hint: secure"; passwordInput.value = ""; }
  }
  loginBtn.addEventListener("click", tryLogin);
  passwordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });
  const saved = localStorage.getItem("secureos_user");
  if (saved) usernameInput.value = saved;
});
