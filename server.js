import express from "express";
import cors from "cors";
import morgan from "morgan";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

const TOOLS_DIR = path.join(__dirname, "tools");
const REGISTRY_FILE = path.join(TOOLS_DIR, "registry.json");

fs.mkdirSync(TOOLS_DIR, { recursive: true });
if (!fs.existsSync(REGISTRY_FILE)) {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ tools: {} }, null, 2));
}

const readRegistry = () => JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
const writeRegistry = (data) => fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2));

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: true, ...opts });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function safeToolName(raw, fallback = "tool") {
  const n = (raw || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 50);
  return n || fallback;
}

function deriveNameFromRepo(repoUrl) {
  try {
    const tail = repoUrl.split("/").pop() || "";
    const base = tail.replace(/\.git$/, "");
    return safeToolName(base, "tool");
  } catch {
    return "tool";
  }
}

/* -----------------------
   API: list installed tools
------------------------ */
app.get("/api/tools", (req, res) => {
  const reg = readRegistry();
  res.json({ ok: true, tools: reg.tools });
});

/* -----------------------
   API: install from GitHub
   body: { repo: "https://github.com/user/repo.git", name?: "alias" }
------------------------ */
// Replace your /api/install handler with this improved version
app.post("/api/install", async (req, res) => {
  const { repo, name } = req.body || {};
  if (!repo || !/^https?:\/\/.+/i.test(repo)) {
    return res.status(400).json({ ok: false, error: "Invalid repo URL." });
  }

  const toolName = safeToolName(name || deriveNameFromRepo(repo));
  const toolDir = path.join(TOOLS_DIR, toolName);

  if (fs.existsSync(toolDir)) {
    return res.json({ ok: true, message: `Already installed: ${toolName}` });
  }

  fs.mkdirSync(toolDir, { recursive: true });

  const logs = [];
  try {
    logs.push(`Cloning ${repo} -> ${toolName} ...`);
    let r = await runCmd("git", ["clone", "--depth", "1", repo, toolDir], { cwd: TOOLS_DIR });
    logs.push(r.stdout || "", r.stderr || "");
    if (r.code !== 0) {
      throw new Error("git clone failed");
    }

    const pkgPath = path.join(toolDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      // try npm ci, fallback to npm install
      logs.push("Found package.json, trying npm ci ...");
      r = await runCmd("npm", ["ci", "--omit=dev"], { cwd: toolDir });
      logs.push(r.stdout || "", r.stderr || "");
      if (r.code !== 0) {
        logs.push("npm ci failed, trying npm install...");
        r = await runCmd("npm", ["install", "--omit=dev"], { cwd: toolDir });
        logs.push(r.stdout || "", r.stderr || "");
        if (r.code !== 0) {
          throw new Error("npm install failed");
        }
      }
    } else {
      logs.push("No package.json found — skipping npm install.");
    }

    // update registry
    const reg = readRegistry();
    reg.tools[toolName] = { name: toolName, repo, installedAt: new Date().toISOString() };
    writeRegistry(reg);

    return res.json({ ok: true, message: `Installed ${toolName}`, name: toolName, logs });
  } catch (err) {
    // if something failed, remove the partially cloned folder to keep tools dir clean
    try { fs.rmSync(toolDir, { recursive: true, force: true }); } catch (e) {}
    logs.push(`ERROR: ${err.message || err}`);
    return res.status(500).json({ ok: false, error: err.message || "install failed", logs });
  }
});


/* -----------------------
   API: uninstall by name
   body: { name: "toolName" }
------------------------ */
app.post("/api/uninstall", async (req, res) => {
  const { name } = req.body || {};
  const toolName = safeToolName(name);
  const toolDir = path.join(TOOLS_DIR, toolName);

  if (!fs.existsSync(toolDir)) {
    return res.status(404).json({ ok: false, error: "Tool not found" });
  }
  fs.rmSync(toolDir, { recursive: true, force: true });

  const reg = readRegistry();
  delete reg.tools[toolName];
  writeRegistry(reg);

  res.json({ ok: true, message: `Uninstalled ${toolName}` });
});

/* -----------------------
   API: run tool
   body: { name: "toolName", args?: ["..."] }
   We call: node . <args...> inside tool dir
------------------------ */
app.post("/api/run", async (req, res) => {
  const { name, args = [] } = req.body || {};
  const toolName = safeToolName(name);
  const toolDir = path.join(TOOLS_DIR, toolName);

  if (!fs.existsSync(toolDir)) {
    return res.status(404).json({ ok: false, error: "Tool not found" });
  }

  // Try node entrypoint
  const r = await runCmd("node", ["."].concat(args), { cwd: toolDir });
  const ok = r.code === 0;
  res.json({ ok, code: r.code, stdout: r.stdout, stderr: r.stderr });
});

/* -----------------------
   Health
------------------------ */
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`LoveX backend running on http://localhost:${PORT}`);
  console.log(`Tools dir: ${TOOLS_DIR}`);
});
