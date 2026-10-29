/* SecureOS backend v1.0 — HARDENED.
   Deliberately does NOT install, clone or run arbitrary code.
   The old LoveX backend did: git clone any URL + npm install + node .
   with spawn(..., { shell: true }) — that is remote code execution if
   the server is ever exposed. SecureOS removes all three endpoints.
   This server is now only a read-only catalogue + health check.
   The desktop itself runs fully client-side and needs no backend. */
import express from "express";
import cors from "cors";
import morgan from "morgan";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "64kb" }));
app.use(morgan("dev"));

const CATALOG_FILE = path.join(__dirname, "tools", "catalog.json");
function readCatalog() {
  try { return JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8")); }
  catch { return { version: "1.0", tools: [] }; }
}

app.get("/api/health", (req, res) => res.json({ ok: true, name: "SecureOS", version: "1.0" }));
app.get("/api/tools", (req, res) => res.json({ ok: true, catalog: readCatalog() }));

// Explicitly refuse the old dangerous routes so old clients fail loudly,
// instead of silently doing nothing or, worse, executing code.
app.post("/api/install", (req, res) => res.status(403).json({ ok: false, error: "Arbitrary tool installs are disabled in SecureOS. Use the built-in, client-side apps or the allowlisted catalogue." }));
app.post("/api/run", (req, res) => res.status(403).json({ ok: false, error: "Remote code execution is disabled in SecureOS." }));
app.post("/api/uninstall", (req, res) => res.status(403).json({ ok: false, error: "Remote uninstall is disabled in SecureOS." }));

app.listen(PORT, () => {
  console.log(`SecureOS backend (catalogue only) running on http://localhost:${PORT}`);
});
