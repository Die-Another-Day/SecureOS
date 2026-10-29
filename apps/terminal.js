// Secure Terminal — local VFS only. No backend installs, no code execution.
document.addEventListener("DOMContentLoaded", () => {
  const out = document.getElementById("terminal-output");
  const input = document.getElementById("terminal-input");
  const win = document.getElementById("terminal-window");
  const header = document.getElementById("terminal-header");
  let dragging = false, ox = 0, oy = 0;
  header.addEventListener("mousedown", (e) => { dragging = true; ox = e.clientX - win.offsetLeft; oy = e.clientY - win.offsetTop; });
  document.addEventListener("mousemove", (e) => { if (dragging) { win.style.left = (e.clientX - ox) + "px"; win.style.top = (e.clientY - oy) + "px"; } });
  document.addEventListener("mouseup", () => { dragging = false; });
  const print = (html) => { out.innerHTML += `<div>${html}</div>`; out.scrollTop = out.scrollHeight; };
  const printText = (t) => { const pre = document.createElement("pre"); pre.textContent = t; out.appendChild(pre); out.scrollTop = out.scrollHeight; };
  const closeBtn = document.getElementById("close-terminal");
  if (closeBtn) closeBtn.addEventListener("click", () => { window.close(); print("Close this tab to exit Secure Terminal."); });

  function cmd(line) {
    const args = line.trim().split(" ").filter(Boolean);
    const c = (args.shift() || "").toLowerCase();
    switch (c) {
      case "help": print("Available: help, whoami, date, clear, ls, cat &lt;file&gt;, echo &lt;text&gt; &lt;file&gt;, mkdir &lt;dir&gt;, tools, threat<br>Removed in SecureOS: install / run / uninstall (arbitrary code execution). See README.md."); break;
      case "whoami": print("operator@secureos — local session only"); break;
      case "date": print(new Date().toLocaleString()); break;
      case "clear": out.innerHTML = ""; break;
      case "ls": try { print(Object.keys(window.VFS["/"]).join("&nbsp;&nbsp;") || "(empty)"); } catch { print("VFS not available."); } break;
      case "cat": { const n = args[0]; if (!n) { print("Usage: cat &lt;filename&gt;"); break; } const v = window.VFS?.["/"]?.[n]; printText(v == null ? `File not found: ${n}` : (typeof v === "string" ? v : JSON.stringify(v, null, 2))); break; }
      case "echo": { if (args.length < 2) { print("Usage: echo &lt;text&gt; &lt;filename&gt;"); break; } const f = args.pop(); if (!window.VFS["/"]) window.VFS["/"] = {}; window.VFS["/"][f] = args.join(" "); window.VFS_save?.(); print(`Saved to ${f}`); break; }
      case "mkdir": { const d = args[0]; if (!d) { print("Usage: mkdir &lt;foldername&gt;"); break; } if (!window.VFS["/"]) window.VFS["/"] = {}; window.VFS["/"][d] = window.VFS["/"][d] || {}; window.VFS_save?.(); print(`Folder created: ${d}`); break; }
      case "tools": print("Built-in (browser): SOC Center, Password Lab, Hash Lab, Phishing Analyzer, Log Analyzer, Vault Notes, Network Lab (simulated), Threat Intel.<br>Reference (your own lab only): Nmap, Wireshark, Suricata/Zeek, Wazuh."); break;
      case "threat": print("Simulated alert: 3 failed logins from 203.0.113.45 — this is training data. In a real SOC: check the account, the source, and whether any login succeeded."); break;
      case "install": case "run": case "uninstall": print("⛔ Disabled in SecureOS v1.0 — arbitrary installs/execution were the old backend's biggest risk. Use the built-in apps."); break;
      case "": break;
      default: print(`Unknown command: ${c} — type help`);
    }
  }
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const line = input.value; input.value = ""; print(`$ ${line}`); cmd(line); } });
  print("🛡️ Welcome to Secure Terminal v1.0 (local VFS only)");
  print("Type 'help' to see commands.");
});
