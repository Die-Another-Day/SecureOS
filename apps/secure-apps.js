/* SecureOS apps — all client-side, local-first.
   Nothing here scans, attacks or contacts a remote system.
   Network Lab and SOC incidents are explicitly simulated training data. */
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const $ = (root, sel) => root.querySelector(sel);

  /* ---------- SOC Command Center (simulated) ---------- */
  const INCIDENTS = [
    { id: "INC-1042", sev: "High", title: "Brute-force login against admin", src: "203.0.113.45 (example IP)", detail: "47 failed logins in 6 minutes, then one success from a new location. Chain step: initial access.", verdict: "contain", hint: "Contain first: lock the account, block the source IP, force a password reset — then investigate the successful login." },
    { id: "INC-1043", sev: "Medium", title: "Phishing email: fake invoice attachment", src: "Mailbox: analyst-in-training", detail: "Attachment invoice.pdf.exe, sender domain differs from the brand by one letter. No click confirmed yet.", verdict: "contain", hint: "Contain: quarantine the mail, block the sender domain, warn the team. Escalate only if a click or execution is confirmed." },
    { id: "INC-1044", sev: "High", title: "SQL injection probe on /search", src: "Web logs, host web-01", detail: "Query string contains ' OR 1=1 -- and UNION SELECT. This is a probe, not yet a confirmed breach — but it is a compounding-vulnerability signal: input validation + error detail + old library together make it exploitable.", verdict: "escalate", hint: "Escalate to the app team + WAF rule now: this pattern is actively probing a real weakness, not noise." },
    { id: "INC-1045", sev: "Low", title: "Single failed login, known employee device", src: "Host WS-042, known laptop", detail: "One typo'd password from a recognised device and location. No other signals.", verdict: "false-positive", hint: "False positive: one failure from a known device is normal. Watch it, do not burn incident time on it." },
  ];
  let socScore = 0, socDone = 0;

  /* ---------- Shared helpers ---------- */
  function hashHex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

  const SecureApps = {
    soc: {
      title: "🛡️ SOC Command Center",
      html() {
        return `<h3>SOC Command Center — simulated incidents</h3>
        <p>Training data only — these are fictional incidents. Triage each one. Score: <b id="socScore">0</b> / ${INCIDENTS.length * 100}</p>
        ${INCIDENTS.map((i) => `<div class="inc" data-inc="${i.id}">
          <b>${i.id}</b> <span class="chip">${i.sev}</span><br><b>${esc(i.title)}</b>
          <div class="small muted">${esc(i.src)}</div><div>${esc(i.detail)}</div>
          <div><button class="btn mini" data-v="contain">Contain</button><button class="btn mini" data-v="escalate">Escalate</button><button class="btn mini" data-v="false-positive">False positive</button></div>
          <div class="result hidden" data-out></div></div>`).join("")}`;
      },
      init(root) {
        root.querySelectorAll(".inc").forEach((card) => {
          const inc = INCIDENTS.find((x) => x.id === card.dataset.inc);
          card.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => {
            const out = $ (card, "[data-out]"); out.classList.remove("hidden");
            if (b.dataset.v === inc.verdict) { socScore += 100; out.className = "result good"; out.textContent = "✅ Correct. " + inc.hint; }
            else { out.className = "result warn"; out.textContent = "❌ Not the best call. " + inc.hint; }
            socDone++; const s = root.querySelector("#socScore"); if (s) s.textContent = socScore;
            card.querySelectorAll("button").forEach((x) => x.disabled = true);
          }));
        });
      }
    },

    password: {
      title: "🔑 Password Lab",
      html() { return `<h3>Password Lab</h3><p>Checked entirely in your browser. Nothing is sent anywhere.</p>
        <input class="field" id="pw" type="password" placeholder="Type a password to test it" autocomplete="off" />
        <div class="result" id="pwOut">Enter a password above.</div>
        <button class="btn mini" id="pwGen">Generate a strong passphrase</button>
        <div class="result hidden" id="pwGenOut"></div>`; },
      init(root) {
        const common = new Set(["password","123456","123456789","qwerty","letmein","admin","welcome","secure","love","password123"]);
        const words = ["river","falcon","cinder","harbor","meadow","orbit","velvet","canyon","saffron","tundra","marble","zephyr","cobalt","willow","ember","quartz","prairie","onyx","delta","lumen"];
        const out = root.querySelector("#pwOut");
        root.querySelector("#pw").addEventListener("input", (e) => {
          const pw = e.target.value; if (!pw) { out.textContent = "Enter a password above."; out.className = "result"; return; }
          let pool = 0; if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26; if (/[0-9]/.test(pw)) pool += 10; if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
          const entropy = Math.round(pw.length * Math.log2(pool || 2));
          const verdict = common.has(pw.toLowerCase()) ? "⛔ On a common-password list — change it immediately." : entropy < 40 ? "🔴 Weak" : entropy < 70 ? "🟡 Okay for low-risk accounts, upgrade for important ones" : "🟢 Strong";
          out.className = "result " + (entropy < 40 || common.has(pw.toLowerCase()) ? "bad" : entropy < 70 ? "warn" : "good");
          out.textContent = `Length: ${pw.length}  •  Estimated entropy: ~${entropy} bits\n${verdict}\nTip: a 4-word passphrase beats a short complex password and is easier to remember.`;
        });
        root.querySelector("#pwGen").addEventListener("click", () => {
          const pick = () => words[Math.floor(Math.random() * words.length)];
          const phrase = `${pick()}-${pick()}-${pick()}-${pick()}-${Math.floor(10 + Math.random() * 90)}`;
          const o = root.querySelector("#pwGenOut"); o.classList.remove("hidden"); o.textContent = phrase + "\nCopy it to your password manager — do not reuse it anywhere else.";
        });
      }
    },

    hash: {
      title: "#️⃣ Hash Lab",
      html() { return `<h3>Hash Lab</h3><p>SHA-256 / 384 / 512 via your browser's WebCrypto. Use it to verify a download or compare a value — never to "crack" someone else's password.</p>
        <input class="field" id="hIn" placeholder="Text to hash" />
        <select class="field" id="hAlg"><option value="SHA-256">SHA-256</option><option value="SHA-384">SHA-384</option><option value="SHA-512">SHA-512</option></select>
        <button class="btn mini" id="hGo">Compute hash</button>
        <div class="result" id="hOut">Hash appears here.</div>
        <input class="field" id="hCmp" placeholder="Paste a hash to identify / compare (optional)" />
        <div class="result hidden" id="hCmpOut"></div>`; },
      init(root) {
        const identify = (h) => ({ 32: "looks like MD5 (32 hex chars)", 40: "looks like SHA-1 (40 hex chars)", 64: "looks like SHA-256 (64 hex chars)", 96: "looks like SHA-384 (96 hex chars)", 128: "looks like SHA-512 (128 hex chars)" }[h.length] || "unknown length — not a standard hex hash");
        root.querySelector("#hGo").addEventListener("click", async () => {
          const text = root.querySelector("#hIn").value, alg = root.querySelector("#hAlg").value, out = root.querySelector("#hOut");
          if (!text) { out.textContent = "Type something to hash first."; return; }
          if (!window.crypto || !crypto.subtle) { out.textContent = "WebCrypto is not available in this context. Serve SecureOS over localhost or https."; return; }
          const digest = await crypto.subtle.digest(alg, new TextEncoder().encode(text));
          const hex = hashHex(digest); out.textContent = hex;
          const cmp = root.querySelector("#hCmp").value.trim().toLowerCase();
          const co = root.querySelector("#hCmpOut");
          if (cmp) { co.classList.remove("hidden"); co.textContent = cmp === hex ? "✅ Match: the pasted hash equals this hash." : `❌ No match. Pasted value ${identify(cmp)}.`; }
        });
        root.querySelector("#hCmp").addEventListener("input", (e) => {
          const v = e.target.value.trim(); const o = root.querySelector("#hCmpOut");
          if (!v) { o.classList.add("hidden"); return; } o.classList.remove("hidden"); o.textContent = "Identification: " + identify(v.toLowerCase());
        });
      }
    },

    phishing: {
      title: "🎣 Phishing Analyzer",
      html() { return `<h3>Phishing Analyzer</h3><p>Paste a suspicious link. It is <b>parsed locally only</b> — SecureOS never opens or fetches it.</p>
        <input class="field" id="phUrl" placeholder="https://example.com/login" />
        <button class="btn mini" id="phGo">Analyze link</button>
        <div class="result" id="phOut">Analysis appears here.</div>`; },
      init(root) {
        root.querySelector("#phGo").addEventListener("click", () => {
          const raw = root.querySelector("#phUrl").value.trim(), out = root.querySelector("#phOut");
          let u; try { u = new URL(raw); } catch { out.className = "result bad"; out.textContent = "❌ That is not a valid URL. If it arrived in a message, treat it as suspicious and do not click it."; return; }
          const findings = []; let score = 0;
          const host = u.hostname.toLowerCase();
          if (u.protocol !== "https:") { findings.push("Not HTTPS — credentials on this page could be intercepted."); score += 25; }
          if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) { findings.push("Host is a raw IP address, not a named domain — classic phishing sign."); score += 30; }
          if (host.includes("xn--")) { findings.push("Punycode (xn--) — the domain may be visually impersonating another brand."); score += 30; }
          if (u.href.includes("@")) { findings.push("Contains '@' — the real host is after the last '@'."); score += 20; }
          if (host.split(".").length > 4) { findings.push("Unusually many subdomains — often used to bury the real domain."); score += 15; }
          if (raw.length > 90) { findings.push("Very long URL — often used to hide the destination."); score += 10; }
          if (/(verify|confirm|urgent|account-suspended|free-gift|secure-update)/i.test(raw)) { findings.push("Urgency / verification wording in the URL."); score += 15; }
          const brands = ["paypal", "apple", "google", "microsoft", "amazon", "netflix", "sbi", "hdfc"];
          for (const b of brands) { if (host.includes(b) && !host.endsWith(b + ".com") && !host.endsWith("." + b + ".com") && !host.endsWith(b + ".co.in")) { findings.push(`Mentions "${b}" but the domain is not the brand's official domain.`); score += 30; break; } }
          score = Math.min(100, score);
          const verdict = score >= 60 ? "🔴 HIGH RISK — do not open, do not enter credentials. Report it." : score >= 25 ? "🟡 LOOK CLOSER — verify through the official app/site, not this link." : "🟢 No local red flags found — that does not prove a link is safe. When in doubt, navigate yourself.";
          out.className = "result " + (score >= 60 ? "bad" : score >= 25 ? "warn" : "good");
          out.textContent = `${verdict}\nRisk score (local heuristics only): ${score}/100\nHost: ${host}\n` + (findings.length ? findings.map((f) => "• " + f).join("\n") : "• No heuristic flags triggered.");
        });
      }
    },

    logs: {
      title: "📜 Log Analyzer",
      html() { return `<h3>Log Analyzer</h3><p>Paste auth / web logs. SecureOS counts attack patterns locally — sample logs are pre-loaded so you can try it instantly.</p>
        <textarea class="field" id="logIn">Failed password for root from 203.0.113.45 port 22 ssh2
Failed password for admin from 203.0.113.45 port 22 ssh2
Failed password for admin from 203.0.113.45 port 22 ssh2
GET /search?q=1' OR '1'='1 -- 403
GET /admin/../../etc/passwd 404
GET /page.php?x=&lt;script&gt;alert(1)&lt;/script&gt; 403
Accepted password for analyst from 198.51.100.7 port 22 ssh2
GET /index.html 200</textarea>
        <button class="btn mini" id="logGo">Analyze logs</button>
        <div class="result" id="logOut">Analysis appears here.</div>`; },
      init(root) {
        root.querySelector("#logGo").addEventListener("click", () => {
          const lines = root.querySelector("#logIn").value.split("\n").filter((l) => l.trim());
          const fails = {}, sqli = [], trav = [], xss = [];
          lines.forEach((l) => { const m = l.match(/Failed password .* from (\S+)/); if (m) fails[m[1]] = (fails[m[1]] || 0) + 1; if (/(union select|or '1'='1|or 1=1)/i.test(l)) sqli.push(l); if (/\.\.\//.test(l)) trav.push(l); if (/<script/i.test(l)) xss.push(l); });
          const brute = Object.entries(fails).filter(([, n]) => n >= 3);
          root.querySelector("#logOut").textContent =
            `Lines analyzed: ${lines.length}\nFailed logins: ${Object.values(fails).reduce((a, b) => a + b, 0)}${brute.length ? `\n⚠️ Possible brute force: ${brute.map(([ip, n]) => `${ip} (${n} failures)`).join(", ")}` : ""}\nSQL injection patterns: ${sqli.length}\nPath traversal patterns: ${trav.length}\nXSS patterns: ${xss.length}\nVerdict: ${brute.length || sqli.length ? "Investigate — these patterns together are stronger than any one alone (compounding signals)." : "No strong attack pattern in this sample."}`;
        });
      }
    },

    vault: {
      title: "🔒 Vault Notes",
      html() { return `<h3>Vault Notes</h3><p>Notes are encrypted in this browser with AES-GCM (key derived from your vault passphrase via PBKDF2). Demo-grade: if you forget the passphrase, the note cannot be recovered.</p>
        <input class="field" id="vPass" type="password" placeholder="Vault passphrase" />
        <textarea class="field" id="vNote" placeholder="Write a sensitive note here — e.g. incident notes, never real production secrets."></textarea>
        <button class="btn mini" id="vSave">Lock &amp; save</button> <button class="btn mini" id="vLoad">Unlock saved note</button>
        <div class="result" id="vOut">No vault note loaded.</div>`; },
      init(root) {
        async function keyFor(pass) {
          const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
          return crypto.subtle.deriveKey({ name: "PBKDF2", salt: new TextEncoder().encode("secureos-vault-v1"), iterations: 100000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        }
        const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
        const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
        root.querySelector("#vSave").addEventListener("click", async () => {
          const pass = root.querySelector("#vPass").value, note = root.querySelector("#vNote").value, out = root.querySelector("#vOut");
          if (!pass || !note) { out.textContent = "Enter a passphrase and a note first."; return; }
          if (!crypto.subtle) { out.textContent = "WebCrypto unavailable here — serve over localhost/https."; return; }
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(pass), new TextEncoder().encode(note));
          localStorage.setItem("secureos_vault_v1", JSON.stringify({ iv: b64(iv), ct: b64(ct) }));
          out.textContent = "🔒 Locked and saved locally (ciphertext only). Clear the note box to test unlocking.";
        });
        root.querySelector("#vLoad").addEventListener("click", async () => {
          const pass = root.querySelector("#vPass").value, out = root.querySelector("#vOut"), raw = localStorage.getItem("secureos_vault_v1");
          if (!raw) { out.textContent = "No saved vault note found."; return; }
          try { const { iv, ct } = JSON.parse(raw); const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await keyFor(pass), unb64(ct)); out.textContent = "🔓 Unlocked:\n" + new TextDecoder().decode(pt); }
          catch { out.textContent = "❌ Could not unlock — wrong passphrase, or the stored note was changed."; }
        });
      }
    },

    netlab: {
      title: "🌐 Network Lab (simulated)",
      html() { return `<h3>Network Lab — SIMULATED</h3><p>This sends <b>no packets</b> and touches no real network. It teaches what a port scan <i>looks like</i>, using a deterministic simulation so the same target gives the same demo result.</p>
        <input class="field" id="nTarget" value="127.0.0.1" />
        <button class="btn mini" id="nGo">Run simulated scan</button>
        <div class="result" id="nOut">Results appear here. Real scanning belongs in your own lab with tools like Nmap — never against systems you do not own.</div>`; },
      init(root) {
        root.querySelector("#nGo").addEventListener("click", () => {
          const target = root.querySelector("#nTarget").value.trim() || "127.0.0.1", out = root.querySelector("#nOut");
          let h = 0; for (const c of target) h = (h * 31 + c.charCodeAt(0)) % 997;
          const ports = [[22, "SSH"], [80, "HTTP"], [443, "HTTPS"], [3306, "MySQL"], [8080, "HTTP-alt"], [53, "DNS"]];
          out.textContent = "Scanning (simulated)…";
          setTimeout(() => { out.textContent = `Simulated scan of ${target} — no packets sent.\n` + ports.map(([p, s], i) => `${p}/${s}: ${((h + i * 37) % 3 === 0) ? "open (simulated)" : "closed (simulated)"}`).join("\n") + "\n\nLesson: an open port is not a vulnerability by itself. Check the service version, then whether it is patched and actually needed."; }, 900);
        });
      }
    },

    intel: {
      title: "🧠 Threat Intel Cards",
      html() { return `<h3>Threat Intel Cards</h3><p>Curated technique cards for study — search to filter.</p>
        <input class="field" id="iQ" placeholder="Search: phishing, sql, lateral…" />
        <div id="iList"></div>`; },
      init(root) {
        const cards = [
          ["Phishing (T1566)", "Fake login / invoice lures. Detect: DMARC + user reporting + URL analysis (see Phishing Analyzer)."],
          ["Brute force (T1110)", "Many failed logins, then success. Detect: failed-login thresholds, MFA, account lockout."],
          ["SQL injection (CWE-89)", "Untrusted input reaches a query. Fix: parameterized queries, least-privilege DB user, WAF as backup — not as the fix."],
          ["Lateral movement (T1021)", "SMB / RDP hops after initial access. Detect: unusual host-to-host logins, new admin sessions."],
          ["Compounding vulnerabilities", "Eeshan's UASAF insight: single low flaws chain into a critical path. Fix the chain, not just the loudest alert."],
          ["Data exfiltration (T1048)", "Large outbound transfers to rare destinations. Detect: egress baselines, DLP, DNS query volume."],
        ];
        const render = (q) => { root.querySelector("#iList").innerHTML = cards.filter((c) => (c[0] + c[1]).toLowerCase().includes(q.toLowerCase())).map((c) => `<div class="inc"><b>${esc(c[0])}</b><div>${esc(c[1])}</div></div>`).join("") || "<div class='result'>No cards match.</div>"; };
        render(""); root.querySelector("#iQ").addEventListener("input", (e) => render(e.target.value));
      }
    },

    terminal: {
      title: "💻 Secure Terminal",
      html() { return `<h3>Secure Terminal</h3><p>Standalone terminal lives at <code>apps/terminal.html</code>. In this desktop, use it for local VFS commands only — no backend installs in SecureOS v1.</p>
        <div class="result">Commands (standalone terminal): help, whoami, date, clear, ls, cat &lt;file&gt;, echo &lt;text&gt; &lt;file&gt;, mkdir &lt;dir&gt;, tools, threat<br>Arbitrary install / run commands were removed in the SecureOS hardening — see README.md.</div>
        <a class="btn mini" style="display:inline-block;text-decoration:none;text-align:center" href="apps/terminal.html" target="_blank" rel="noopener">Open Secure Terminal ↗</a>`; },
      init() {}
    },
  };

  window.SecureApps = SecureApps;
})();
