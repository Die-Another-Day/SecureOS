#!/usr/bin/env python3
"""SecureOS v4 LAB vulnerable web app — LAB ONLY, private LAN only.

This app is INTENTIONALLY vulnerable, by design, for a Red vs Blue class.
It must never run on a public network, a campus/corporate network without
written permission, or a machine you do not own. It is started only by
`secureos-lab --enable` and stopped by `secureos-lab --stop`.

Real vulnerabilities, not simulations:
  * SQL injection in /search: the query is built by string concatenation
    into a real SQLite query (not a fake "vulnerable" check). A UNION
    SELECT can read the secrets table, which holds flag 1.
  * Reflected XSS in /search: the query is echoed unescaped in HTML.
  * Insecure plugin upload in /upload: a .py file is saved to the plugins
    directory and executed on request to /plugin?name=... . That is real
    code execution as the labweb user, which can read flag 3 (owned by
    labweb, mode 0600, so the SSH labuser cannot read it directly).
  * Directory listing in /files/: real files are listed, including a
    backup note that hints at the other paths. It does NOT contain a flag.

Permissions separate the flags:
  * flag 1: SQLite secrets table, readable only via a real SQL query.
    The DB file is owned by labweb, mode 0600.
  * flag 2: /home/labuser/flag2.txt, owned by labuser, mode 0600.
    Only a real SSH login as labuser (lab credential) can read it.
  * flag 3: /srv/labapp/flags/flag3.txt, owned by labweb, mode 0600.
    Only code running as labweb (the plugin path) can read it.

Logging is real: every request, login attempt, search query, upload and
plugin execution is appended to /var/log/secureos-lab/app.log with a
timestamp and source IP, and also sent to syslog so it lands in the
systemd journal. The SOC /api/alerts endpoint parses those real lines.
No alert, flag or incident is invented here.

Python standard library only. Run as the unprivileged labweb user.
Port 8080, bound to the LAN IP given by secureos-lab (never 0.0.0.0
unless the operator explicitly passes a private LAN IP).
"""
import hashlib
import html
import os
import sqlite3
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

BASE = "/srv/labapp"
DB = os.path.join(BASE, "lab.db")
LOG = "/var/log/secureos-lab/app.log"
PLUGINS = os.path.join(BASE, "plugins")
PUBLIC = os.path.join(BASE, "public")
FLAGS = os.path.join(BASE, "flags")
import ipaddress as _ip
_raw_host = sys.argv[1] if len(sys.argv) > 1 else ""
try:
    _ip.ip_address(_raw_host); HOST = _raw_host
except ValueError:
    _env_host = __import__("os").environ.get("SECUREOS_BIND_IP", "")
    try:
        _ip.ip_address(_env_host); HOST = _env_host
    except ValueError:
        HOST = "127.0.0.1"
if HOST == "0.0.0.0":
    HOST = "127.0.0.1"  # never bind all interfaces
PORT = 8080


def log_line(kind, ip, detail):
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {kind} ip={ip} {detail}\n"
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a") as f:
            f.write(line)
    except OSError:
        pass
    # syslog via logger if available (journal)
    try:
        import subprocess
        subprocess.run(["logger", "-t", "secureos-labapp", line.strip()],
                       capture_output=True, timeout=5)
    except Exception:
        pass


def init_db():
    os.makedirs(BASE, exist_ok=True)
    os.makedirs(PLUGINS, exist_ok=True)
    os.makedirs(PUBLIC, exist_ok=True)
    os.makedirs(FLAGS, exist_ok=True)
    # Public hint file (real file, listed by /files/)
    with open(os.path.join(PUBLIC, "notes.txt"), "w") as f:
        f.write("SecureOS Lab — internal notes (LAB ONLY)\n"
                "Search the catalogue. Admins upload plugins in /upload.\n"
                "Backups are in /files/ — check what is actually listed.\n")
    flag3_path = os.path.join(FLAGS, "flag3.txt")
    if os.path.exists(DB):
        # Self-heal: a previous run may have left an empty flag3 (seen in
        # QEMU setup: 0-byte file, DB present, init returning early).
        # Regenerate it instead of leaving an unwinnable flag.
        try:
            if not os.path.exists(flag3_path) or os.path.getsize(flag3_path) == 0:
                with open(flag3_path, "w") as f:
                    f.write("flag{" + uuid.uuid4().hex[:16] + "}\n")
        except OSError:
            pass
        return
    con = sqlite3.connect(DB)
    cur = con.cursor()
    cur.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price TEXT)")
    cur.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password TEXT)")
    cur.execute("CREATE TABLE secrets (id INTEGER PRIMARY KEY, label TEXT, value TEXT)")
    cur.executemany("INSERT INTO items VALUES (?,?,?)",
                    [(1, "Lab Router", "10"), (2, "Lab Switch", "20"),
                     (3, "Lab Server", "30")])
    cur.executemany("INSERT INTO users VALUES (?,?,?)",
                    [(1, "admin", "admin"), (2, "analyst", "analyst")])
    flag1 = "flag{" + uuid.uuid4().hex[:16] + "}"
    cur.execute("INSERT INTO secrets VALUES (1, 'flag1_sqli', ?)", (flag1,))
    con.commit()
    con.close()
    # flag3, owned by labweb at install time (setup chmods it 0600)
    with open(os.path.join(FLAGS, "flag3.txt"), "w") as f:
        f.write("flag{" + uuid.uuid4().hex[:16] + "}\n")


def page(title, body):
    return f"""<!DOCTYPE html><html><head><title>{title}</title></head><body>
<h1>SecureOS Lab — LAB ONLY, private LAN only</h1>
<p><b>WARNING:</b> This app is intentionally vulnerable for a classroom
Red vs Blue exercise. Do not expose it to the internet or to a network
without the permission of everyone on that network.</p>
<nav><a href="/">Home</a> | <a href="/search?q=">Search</a> |
<a href="/upload">Upload plugin</a> | <a href="/files/">Files</a> |
<a href="/login">Login</a></nav><hr>{body}</body></html>""".encode()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body, status=200, ctype="text/html"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        ip = self.client_address[0]
        if u.path == "/":
            self._send(page("Lab home",
                "<p>Catalogue search, login, plugin upload and file listing.</p>"
                "<p>VAPT stages: Recon, Scanning, Enumeration, Vulnerability "
                "Assessment, Exploitation, Post-exploitation, Reporting.</p>"))
        elif u.path == "/search":
            q = (parse_qs(u.query).get("q") or [""])[0]
            log_line("SEARCH", ip, f"q={q!r}")
            con = sqlite3.connect(DB)
            # INTENTIONALLY VULNERABLE: string concatenation, real SQLite.
            sql = f"SELECT id, name, price FROM items WHERE name LIKE '%{q}%'"
            rows = []
            err = ""
            try:
                rows = con.execute(sql).fetchall()
            except Exception as e:
                err = str(e)
            con.close()
            # UNION results have 3 columns; secrets rows surface as items.
            out = "<h2>Search results</h2>"
            # Reflected XSS: q echoed unescaped, on purpose, LAB ONLY.
            out += f"<p>You searched for: {q}</p>"
            if err:
                out += f"<p>Database error: {html.escape(err)}</p>"
            for r in rows:
                out += f"<p>{html.escape(str(r[0]))} — {html.escape(str(r[1]))} — {html.escape(str(r[2]))}</p>"
            if any("flag{" in str(r) for r in rows):
                log_line("SQLI_SUCCESS", ip, "secrets row returned via query")
            if not rows and not err:
                out += "<p>No results.</p>"
            self._send(page("Search", out))
        elif u.path == "/login":
            self._send(page("Login",
                '<form method="post" action="/login">'
                'User: <input name="user"><br>Password: <input type="password" name="pass">'
                '<br><input type="submit" value="Login"></form>'))
        elif u.path == "/files":
            log_line("FILES_LIST", ip, "directory listing requested")
            names = sorted(os.listdir(PUBLIC))
            out = "<h2>Files</h2><ul>" + "".join(
                f'<li><a href="/files/{n}">{html.escape(n)}</a></li>' for n in names) + "</ul>"
            self._send(page("Files", out))
        elif u.path.startswith("/files/"):
            name = unquote(u.path[len("/files/"):])
            # Listing only inside PUBLIC; traversal outside is blocked by
            # the path check below (this endpoint is the listing, not a flag).
            p = os.path.join(PUBLIC, name)
            if not os.path.isfile(p) or os.path.dirname(os.path.abspath(p)) != os.path.abspath(PUBLIC):
                self._send(b"Not found", 404, "text/plain"); return
            log_line("FILE_DOWNLOAD", ip, f"file={name}")
            with open(p, "rb") as f:
                self._send(f.read(), 200, "text/plain")
        elif u.path == "/upload":
            self._send(page("Upload plugin",
                '<form method="post" action="/upload" >'
                'This demo upload accepts a plain text field "name" and a '
                'plain text field "code" (a .py plugin). Uploaded plugins '
                'run as labweb when requested at /plugin?name=NAME.<br>'
                'Name: <input name="name"><br>Code:<br>'
                '<textarea name="code" rows="10" cols="60"></textarea><br>'
                '<input type="submit" value="Upload"></form>'
                '<p>Use the /upload POST with fields name and code.</p>'))
        elif u.path == "/plugin":
            name = (parse_qs(u.query).get("name") or [""])[0]
            # Only a basename, no directory traversal.
            name = os.path.basename(name)
            p = os.path.join(PLUGINS, name)
            if not name.endswith(".py") or not os.path.isfile(p):
                self._send(b"Plugin not found", 404, "text/plain"); return
            log_line("PLUGIN_EXEC", ip, f"plugin={name}")
            # REAL execution of the uploaded plugin, as labweb, LAB ONLY.
            ns = {}
            try:
                with open(p) as f:
                    code = f.read()
                exec(compile(code, p, "exec"), ns)
                result = ns.get("result", "plugin ran, no result variable")
            except Exception as e:
                result = f"plugin error: {e}"
            self._send(page("Plugin", f"<pre>{html.escape(str(result))}</pre>"))
        else:
            self._send(b"Not found", 404, "text/plain")

    def do_POST(self):
        u = urlparse(self.path)
        ip = self.client_address[0]
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode(errors="replace") if length else ""
        data = parse_qs(body)
        if u.path == "/login":
            user = (data.get("user") or [""])[0]
            pw = (data.get("pass") or [""])[0]
            log_line("LOGIN_ATTEMPT", ip, f"user={user}")
            con = sqlite3.connect(DB)
            # INTENTIONALLY VULNERABLE login query (string concatenation).
            sql = f"SELECT username FROM users WHERE username='{user}' AND password='{pw}'"
            try:
                row = con.execute(sql).fetchone()
            except Exception:
                row = None
            con.close()
            if row:
                log_line("LOGIN_SUCCESS", ip, f"user={row[0]}")
                self._send(page("Login", f"<p>Welcome, {html.escape(row[0])}.</p>"))
            else:
                self._send(page("Login", "<p>Login failed.</p>"), 401)
        elif u.path == "/upload":
            name = (data.get("name") or [""])[0]
            code = (data.get("code") or [""])[0]
            name = os.path.basename(name)
            if not name or not code:
                self._send(b"Missing name or code", 400, "text/plain"); return
            if not name.endswith(".py"):
                name += ".py"
            with open(os.path.join(PLUGINS, name), "w") as f:
                f.write(code)
            log_line("UPLOAD", ip, f"plugin={name} bytes={len(code)}")
            self._send(page("Upload", f"<p>Uploaded {html.escape(name)}. "
                f"Run it at /plugin?name={html.escape(name)}</p>"))
        else:
            self._send(b"Not found", 404, "text/plain")


if __name__ == "__main__":
    init_db()
    print(f"SecureOS Lab app on http://{HOST}:{PORT} — LAB ONLY", flush=True)
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
