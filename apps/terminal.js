// terminal.js - LoveX OS Terminal (backend-connected)
document.addEventListener("DOMContentLoaded", () => {
  const terminalOutput = document.getElementById("terminal-output");
  const terminalInput = document.getElementById("terminal-input");
  const terminalWindow = document.getElementById("terminal-window");
  const header = document.getElementById("terminal-header");

  const API = "http://localhost:3001/api"; // backend base

  // -------- Draggable -----------
  let offsetX, offsetY, isDragging = false;
  header.addEventListener("mousedown", e => {
    isDragging = true;
    offsetX = e.clientX - terminalWindow.offsetLeft;
    offsetY = e.clientY - terminalWindow.offsetTop;
  });
  document.addEventListener("mousemove", e => {
    if (isDragging) {
      terminalWindow.style.left = `${e.clientX - offsetX}px`;
      terminalWindow.style.top = `${e.clientY - offsetY}px`;
    }
  });
  document.addEventListener("mouseup", () => (isDragging = false));

  // -------- Helpers -----------
  function printOutput(html) {
    terminalOutput.innerHTML += `<div>${html}</div>`;
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }
  function printCodeBlock(text) {
    const pre = document.createElement("pre");
    pre.textContent = text;
    terminalOutput.appendChild(pre);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  async function api(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
  }

  // -------- Command handler -----------
  async function executeCommand(line) {
    const args = line.trim().split(" ").filter(Boolean);
    const cmd = (args.shift() || "").toLowerCase();

    if (!cmd) return;

    switch (cmd) {
      // local / fun
      case "help":
        printOutput(
          [
            "Available:",
            " - help, love, date, poem, clear",
            " - ls, cat <file>, echo <text> <file>, mkdir <dir>  (local VFS)",
            " - install <github-url> [--name alias]",
            " - tools",
            " - run <toolName> [args]",
            " - uninstall <toolName>"
          ].join("<br>")
        );
        break;

      case "love":
        printOutput("❤️ Love is like this OS — always running in the background ❤️");
        break;

      case "date":
        printOutput(`⏳ ${new Date().toLocaleString()}`);
        break;

      case "poem":
        printOutput("Roses are red,<br>Violets are blue,<br>This LoveX OS,<br>Was made just for you 💕");
        break;

      case "clear":
        terminalOutput.innerHTML = "";
        break;

      // --- Local VFS (your filesystem.js must be loaded) ---
      case "ls":
        try {
          printOutput(Object.keys(window.VFS["/"]).join("&nbsp;&nbsp;"));
        } catch {
          printOutput("VFS not available. Did you include loveos/filesystem.js?");
        }
        break;

      case "cat": {
        const name = args[0];
        if (!name) return printOutput("❗ Usage: cat <filename>");
        const v = window.VFS?.["/"]?.[name];
        if (v == null) return printOutput(`❌ File not found: ${name}`);
        printCodeBlock(typeof v === "string" ? v : JSON.stringify(v, null, 2));
        break;
      }

      case "echo": {
        if (args.length < 2) return printOutput("❗ Usage: echo <text> <filename>");
        const filename = args.pop();
        const text = args.join(" ");
        if (!window.VFS["/"]) window.VFS["/"] = {};
        window.VFS["/"][filename] = text;
        window.VFS_save?.();
        printOutput(`✅ Saved to ${filename}`);
        break;
      }

      case "mkdir": {
        const dirname = args[0];
        if (!dirname) return printOutput("❗ Usage: mkdir <foldername>");
        if (!window.VFS["/"]) window.VFS["/"] = {};
        window.VFS["/"][dirname] = window.VFS["/"][dirname] || {};
        window.VFS_save?.();
        printOutput(`📁 Folder created: ${dirname}`);
        break;
      }

      // --- Backend-powered real actions ---
      case "install": {
        const repo = args[0];
        if (!repo) return printOutput("❗ Usage: install <github-url> [--name alias]");
        const nameFlagIdx = args.indexOf("--name");
        const name = nameFlagIdx >= 0 ? args[nameFlagIdx + 1] : undefined;

        printOutput(`📥 Installing from ${repo} ${name ? `(as ${name})` : ""} ...`);
        const res = await api("POST", "/install", { repo, name });
        if (!res.ok) {
          printOutput(`❌ Install failed: ${res.error || "unknown error"}`);
          if (res.logs) printCodeBlock(res.logs.join("\n"));
        } else {
          printOutput(`✅ Installed: ${res.name}`);
          if (res.logs) printCodeBlock(res.logs.join("\n"));
        }
        break;
      }

      case "tools": {
        const res = await api("GET", "/tools");
        if (!res.ok) return printOutput("❌ Failed to list tools");
        const names = Object.keys(res.tools || {});
        if (!names.length) printOutput("No tools installed yet. Try: install https://github.com/user/repo.git");
        else printOutput("📦 Installed tools: " + names.join(", "));
        break;
      }

      case "run": {
        const name = args.shift();
        if (!name) return printOutput("❗ Usage: run <toolName> [args]");
        const res = await api("POST", "/run", { name, args });
        if (res.stdout) printCodeBlock(res.stdout);
        if (res.stderr) printCodeBlock(res.stderr);
        if (!res.ok) printOutput(`❌ Exit code: ${res.code}`);
        break;
      }

      case "uninstall": {
        const name = args[0];
        if (!name) return printOutput("❗ Usage: uninstall <toolName>");
        const res = await api("POST", "/uninstall", { name });
        if (!res.ok) printOutput(`❌ ${res.error || "Failed to uninstall"}`);
        else printOutput(`🗑️ ${res.message}`);
        break;
      }

      default:
        printOutput(`❓ Unknown command: ${cmd}`);
    }
  }

  // ----- Input handler -----
  terminalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const line = terminalInput.value;
      terminalInput.value = "";
      printOutput(`$ ${line}`);
      executeCommand(line);
    }
  });

  // ----- Welcome -----
  printOutput("💻 Welcome to LoveX Terminal (real installs enabled)!");
  printOutput("Type 'help' to see commands.");
});
