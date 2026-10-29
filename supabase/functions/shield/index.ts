// Alcode Shield (درع الكود) — server: auth proxy, ownership verification, passive security scanner, IP & privacy helpers, Gemini AI.
// No keys ever reach the client. All writes go through here after the caller is authenticated and authorised.

const SB = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const KEY = Deno.env.get("TV_AI_API_KEY") ?? "";
const CRON_KEY = Deno.env.get("SHIELD_CRON_KEY") ?? "";
const UA = "AlcodeShield/1.0 (+https://almarar88.github.io/alcode-shield/; passive security check by site owner)";
const ALLOWED_ORIGINS = ["https://almarar88.github.io", "http://localhost:8080", "http://127.0.0.1:8080"];
const corsFor = (req: Request) => {
  const o = req.headers.get("origin") || "";
  return { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0], "Vary": "Origin",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
};
let CORS: Record<string, string> = {};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------- Supabase helpers ----------------
const hdr = (tok?: string) => ({ apikey: ANON, Authorization: "Bearer " + (tok || ANON), "content-type": "application/json" });
const srv = { apikey: SRV, Authorization: "Bearer " + SRV, "content-type": "application/json" };
async function sbj(path: string, init: RequestInit = {}) {
  const r = await fetch(SB + path, init); const t = await r.text(); let j: any = null;
  try { j = t ? JSON.parse(t) : null; } catch { j = { raw: t.slice(0, 200) }; }
  return { ok: r.ok, status: r.status, j };
}
const dbSel = (path: string) => sbj("/rest/v1/" + path, { headers: srv });
const dbIns = (t: string, row: unknown) => sbj("/rest/v1/" + t, { method: "POST", headers: { ...srv, Prefer: "return=representation" }, body: JSON.stringify(row) });
const dbPatch = (path: string, patch: unknown) => sbj("/rest/v1/" + path, { method: "PATCH", headers: { ...srv, Prefer: "return=representation" }, body: JSON.stringify(patch) });
const dbDel = (path: string) => sbj("/rest/v1/" + path, { method: "DELETE", headers: { ...srv, Prefer: "return=minimal" } });
async function me(tok: string) {
  if (!tok) return null;
  const u = await sbj("/auth/v1/user", { headers: hdr(tok) }); if (!u.ok || !u.j?.id) return null;
  const p = await sbj(`/rest/v1/shield_profiles?user_id=eq.${u.j.id}&select=user_id,email,name,role,plan,active,identity,prefs`, { headers: hdr(tok) });
  const row = p.ok && p.j?.[0]; if (!row || !row.active) return null;
  return { ...row, id: u.j.id, auth_email: u.j.email };
}
const audit = (owner: string, action: string, detail: unknown = {}) => dbIns("shield_audit", { owner, action, detail }).catch(() => {});
const sess = (j: any) => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at });

// ---------------- Gemini ----------------
const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const MODELS: [string, any][] = [["gemini-3.5-flash-lite", { thinkingLevel: "low" }], ["gemini-3.1-flash-lite", { thinkingBudget: 0 }], ["gemini-flash-lite-latest", null], ["gemini-3.5-flash", { thinkingLevel: "low" }], ["gemini-flash-latest", null]];
async function gen(system: string, contents: any[], wantJson: boolean, maxTokens = 12000) {
  let last = "busy";
  for (const [m, think] of MODELS) {
    const generationConfig: any = { temperature: 0.25, maxOutputTokens: maxTokens };
    if (wantJson) generationConfig.responseMimeType = "application/json";
    if (think) generationConfig.thinkingConfig = think;
    let r: Response;
    try {
      r = await fetch(API + m + ":generateContent", { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig }), signal: AbortSignal.timeout(70000) });
    } catch { last = "timeout"; continue; }
    if (r.ok) {
      const j = await r.json();
      const t = (j.candidates?.[0]?.content?.parts ?? []).filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("");
      if (t) {
        if (!wantJson) return { text: t, model: m };
        try { return { data: JSON.parse(t.replace(/^```json\s*|```\s*$/g, "").trim()), model: m }; } catch { last = "bad_json"; continue; }
      }
      last = "empty"; continue;
    }
    await r.body?.cancel(); last = r.status === 429 ? "rate_limit" : "busy";
  }
  return { error: last };
}
const AI_BASE = "You are «درع الكود» (Alcode Shield), a defensive web-security advisor for website owners in the UAE, built by مؤسسة الكود (Alcode). Write clear, simple Modern Standard Arabic suitable for non-experts (with technical terms in English in parentheses when useful). Be precise and practical. Never suggest offensive actions, exploitation or attacking third parties. Only use the facts provided; never invent findings, numbers, or results.";

// ---------------- Domain helpers ----------------
const SHARED_HOSTS = [".github.io", ".gitlab.io"];
const isShared = (h: string) => SHARED_HOSTS.some((s) => h.endsWith(s));
function normSite(input: string) {
  let s = String(input || "").trim(); if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u: URL; try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".supabase.co")) return null;
  let path = "/";
  if (isShared(host)) { const seg = u.pathname.split("/").filter(Boolean)[0]; path = seg ? "/" + seg + "/" : "/"; }
  return { domain: host, base_path: path };
}
function apexOf(h: string) {
  const parts = h.split("."); const two = ["co.uk", "com.ae", "net.ae", "org.ae", "gov.ae", "ac.ae", "com.sa", "com.au", "co.jp", "com.eg"];
  const last2 = parts.slice(-2).join("."); return two.includes(last2) ? parts.slice(-3).join(".") : last2;
}
async function doh(name: string, type: string, dnssec = false): Promise<{ ans: any[]; ad: boolean; status: number; ok: boolean }> {
  for (const base of ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"]) {
    try {
      const r = await fetch(`${base}?name=${encodeURIComponent(name)}&type=${type}${dnssec ? "&do=1" : ""}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) { await r.body?.cancel(); continue; }
      const j = await r.json(); return { ans: j.Answer || [], ad: !!j.AD, status: j.Status, ok: true };
    } catch { /* next */ }
  }
  return { ans: [], ad: false, status: -1, ok: false };
}
const txtOf = (a: any[]) => a.filter((x) => x.type === 16).map((x) => String(x.data).replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
const privIP = (ip: string) => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);
async function publicHost(h: string) { const a = await doh(h, "A"); const ips = a.ans.filter((x) => x.type === 1).map((x) => x.data); return ips.length > 0 && !ips.some(privIP); }

async function get(url: string, opt: { max?: number; redirect?: RequestRedirect; headers?: Record<string, string>; timeout?: number } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: opt.redirect ?? "follow", headers: { "user-agent": UA, accept: "*/*", ...(opt.headers || {}) }, signal: AbortSignal.timeout(opt.timeout ?? 12000) });
    const max = opt.max ?? 65536; const chunks: Uint8Array[] = []; let n = 0;
    if (r.body) { const rd = r.body.getReader(); while (n < max) { const { value, done } = await rd.read(); if (done) break; chunks.push(value); n += value.length; } try { await rd.cancel(); } catch { /**/ } }
    const buf = new Uint8Array(Math.min(n, max)); let o = 0; for (const c of chunks) { const k = c.subarray(0, Math.max(0, buf.length - o)); buf.set(k, o); o += k.length; if (o >= buf.length) break; }
    return { ok: true, status: r.status, headers: r.headers, url: r.url || url, bytes: buf, text: new TextDecoder("utf-8", { fatal: false }).decode(buf), ms: Date.now() - t0, truncated: n >= max, err: "" };
  } catch (e) { return { ok: false, status: 0, headers: new Headers(), url, bytes: new Uint8Array(), text: "", ms: Date.now() - t0, err: String(e).slice(0, 120), truncated: false }; }
}
async function robotsFor(origin: string) {
  const r = await get(origin + "/robots.txt", { max: 65536, timeout: 6000 });
  const dis: string[] = []; if (r.status !== 200 || /<html/i.test(r.text.slice(0, 300))) return { dis, found: false };
  let applies = false; let lastWasUA = false;
  for (const raw of r.text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(); if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue; const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { const hit = v === "*" || /alcodeshield/i.test(v); applies = lastWasUA ? applies || hit : hit; lastWasUA = true; continue; }
    lastWasUA = false; if (k === "disallow" && applies && v) dis.push(v);
  }
  return { dis, found: true };
}
// A path is skipped if any Disallow prefix matches it (wildcards trimmed). "Disallow: /" means skip probes beyond the homepage.
const robotsAllow = (dis: string[], path: string) => !dis.some((d) => { const re = new RegExp("^" + d.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")); return re.test(path); });

async function checkVerification(site: any) {
  if (["owner_attested", "github_account"].includes(site.verify_method) && site.verified) return { ok: true, method: site.verify_method };
  const tok = site.verify_token;
  for (const name of ["_alcode-verify." + site.domain, site.domain]) {
    const r = await doh(name, "TXT"); if (txtOf(r.ans).some((t) => t.trim() === "alcode-verify=" + tok)) return { ok: true, method: "dns" };
  }
  const p = isShared(site.domain) ? site.base_path : "/";
  const r = await get(`https://${site.domain}${p.replace(/\/$/, "")}/.well-known/alcode-verify-${tok}.txt`, { max: 2048, timeout: 8000 });
  if (r.status === 200 && r.text.includes(tok)) return { ok: true, method: "file" };
  return { ok: false, method: "" };
}

// ---------------- Scanner ----------------
type Sev = "critical" | "high" | "medium" | "low" | "info" | "pass";
type Finding = { id: string; cat: string; sev: Sev; t_ar: string; t_en: string; d_ar?: string; d_en?: string; ev?: string };
const CATS = ["tls", "transport", "headers", "cookies", "dns", "email", "exposure", "software", "content"];
const CAT_W: Record<string, number> = { tls: 16, transport: 12, headers: 16, cookies: 6, dns: 8, email: 8, exposure: 16, software: 10, content: 8 };
const PEN: Record<string, number> = { critical: 45, high: 25, medium: 12, low: 4, info: 0, pass: 0 };
function scoreOf(F: Finding[]) {
  const cats: Record<string, { score: number; n: Record<string, number> }> = {};
  for (const c of CATS) { const fs = F.filter((f) => f.cat === c); const n: Record<string, number> = {}; let s = 100; fs.forEach((f) => { n[f.sev] = (n[f.sev] || 0) + 1; s -= PEN[f.sev]; }); cats[c] = { score: Math.max(0, s), n }; }
  let tw = 0, sum = 0; for (const c of CATS) { if (!F.some((f) => f.cat === c)) continue; tw += CAT_W[c]; sum += CAT_W[c] * cats[c].score; }
  let score = tw ? Math.round(sum / tw) : 0;
  const nMed = F.filter((f) => f.sev === "medium").length;
  if (F.some((f) => f.sev === "critical")) score = Math.min(score, 49); else if (F.some((f) => f.sev === "high")) score = Math.min(score, 74);
  else if (nMed >= 2) score = Math.min(score, 84); else if (nMed === 1) score = Math.min(score, 90);
  const grade = score >= 95 ? "A+" : score >= 88 ? "A" : score >= 78 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";
  return { score, grade, cats };
}
const LIBS: [string, string, RegExp[]][] = [
  ["jQuery", "jquery", [/jQuery (?:JavaScript Library )?v(\d+\.\d+\.\d+)/]],
  ["jQuery UI", "jquery-ui", [/jQuery UI - v(\d+\.\d+\.\d+)/]],
  ["jQuery Migrate", "jquery-migrate", [/jQuery Migrate - v(\d+\.\d+\.\d+)/]],
  ["Bootstrap", "bootstrap", [/Bootstrap v(\d+\.\d+\.\d+)/]],
  ["AngularJS", "angular", [/AngularJS v(\d+\.\d+\.\d+)/]],
  ["Lodash", "lodash", [/@license\s+Lodash[^\n]*?(\d+\.\d+\.\d+)/i, /var VERSION\s*=\s*'(\d+\.\d+\.\d+)';[\s\S]{0,200}lodash/]],
  ["Underscore", "underscore", [/Underscore\.js (\d+\.\d+\.\d+)/]],
  ["Moment.js", "moment", [/\/\/! moment\.js\s*\n\/\/! version : (\d+\.\d+\.\d+)/]],
  ["Vue", "vue", [/Vue\.js v(\d+\.\d+\.\d+)/]],
  ["React", "react", [/React v(\d+\.\d+\.\d+)/]],
  ["Handlebars", "handlebars", [/handlebars v(\d+\.\d+\.\d+)/i]],
  ["DOMPurify", "dompurify", [/DOMPurify (\d+\.\d+\.\d+)/]],
  ["Axios", "axios", [/[Aa]xios v(\d+\.\d+\.\d+)/]],
  ["Chart.js", "chart.js", [/Chart\.js v(\d+\.\d+\.\d+)/]],
  ["D3", "d3", [/d3js\.org v(\d+\.\d+\.\d+)/]],
  ["Swiper", "swiper", [/Swiper (\d+\.\d+\.\d+)/]],
  ["Select2", "select2", [/Select2 (\d+\.\d+\.\d+)/]],
  ["Prototype", "prototype", [/Prototype JavaScript framework, version (\d+\.\d+\.\d+)/]],
];
const libUrlVer = (npm: string, u: string) => {
  const n = npm.replace(/[.]/g, "\\.");
  for (const r of [new RegExp(`/(?:ajax/libs/)?${n}/v?(\\d+\\.\\d+\\.\\d+)/`, "i"), new RegExp(`/${n}@v?(\\d+\\.\\d+\\.\\d+)`, "i"), new RegExp(`/${n}[-.]v?(\\d+\\.\\d+\\.\\d+)(?:\\.min|\\.slim)*\\.js`, "i")]) { const m = u.match(r); if (m) return m[1]; }
  return null;
};
const SECRET_PATTERNS: [string, RegExp, Sev, string][] = [
  ["AWS Access Key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "critical", "aws"],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, "critical", "github"],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "critical", "slack"],
  ["Stripe secret key", /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/g, "critical", "stripe"],
  ["OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g, "critical", "openai"],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, "critical", "pk"],
  ["SendGrid key", /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, "critical", "sendgrid"],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g, "low", "google"],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "info", "jwt"],
];
const mask = (s: string) => (s.length <= 10 ? s.slice(0, 2) + "…" : s.slice(0, 4) + "…" + s.slice(-4) + ` (${s.length})`);
function findSecrets(text: string, where: string, F: Finding[], seen: Set<string>) {
  for (const [name, re, sev0, k] of SECRET_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const v = m[0]; if (seen.has(v)) continue; let sev: Sev = sev0, note = "";
      if (k === "jwt") { try { const p = JSON.parse(atob(v.split(".")[1].replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - v.split(".")[1].length % 4) % 4))); if (p.role === "service_role") { sev = "critical"; note = " (service_role)"; } else continue; } catch { continue; } }
      seen.add(v);
      if (k === "google") note = " — غالباً مفتاح ويب عام (Firebase/Maps)؛ تأكد من تقييده بالنطاق وواجهات API المسموحة";
      F.push({ id: `secret_${k}_${seen.size}`, cat: "content", sev, t_ar: `نمط سرّ مكشوف: ${name}`, t_en: `Exposed secret pattern: ${name}`, d_ar: `وُجد في ${where}${note}`, d_en: `Found in ${where}`, ev: mask(v) });
      if (seen.size > 40) return;
    }
  }
}
async function osv(pkgs: { name: string; version: string }[]) {
  if (!pkgs.length) return [];
  try {
    const r = await fetch("https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: pkgs.map((p) => ({ package: { name: p.name, ecosystem: "npm" }, version: p.version })) }), signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    return await Promise.all((j.results || []).map(async (res: any, i: number) => {
      const ids: string[] = (res.vulns || []).map((v: any) => v.id);
      const det = await Promise.all(ids.slice(0, 8).map(async (id) => { try { const d = await (await fetch("https://api.osv.dev/v1/vulns/" + id, { signal: AbortSignal.timeout(8000) })).json(); return { id, alias: (d.aliases || []).find((a: string) => a.startsWith("CVE")) || null, summary: String(d.summary || "").slice(0, 160), sev: d.database_specific?.severity || null }; } catch { return { id, alias: null, summary: "", sev: null }; } }));
      return { ...pkgs[i], count: ids.length, vulns: det };
    }));
  } catch { return null; }
}
// Minimal TLS handshake probe: sends a ClientHello, reads ServerHello + (TLS<=1.2) Certificate, then closes. No keys exchanged.
const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const u24 = (n: number) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
function clientHello(host: string, ver: number, t13 = false) {
  const sni = new TextEncoder().encode(host);
  const ciphers: number[] = [0xc02b, 0xc02f, 0xc02c, 0xc030, 0xcca9, 0xcca8, 0xc009, 0xc013, 0xc00a, 0xc014, 0x009c, 0x009d, 0x002f, 0x0035, 0x000a];
  const ext = (t: number, d: number[]) => [...u16(t), ...u16(d.length), ...d];
  const exts = [
    ...ext(0, [...u16(sni.length + 3), 0, ...u16(sni.length), ...sni]),
    ...ext(10, [...u16(6), 0x00, 0x1d, 0x00, 0x17, 0x00, 0x18]),
    ...ext(11, [1, 0]),
    ...ext(13, [...u16(18), 0x04, 0x03, 0x08, 0x04, 0x04, 0x01, 0x05, 0x03, 0x08, 0x05, 0x05, 0x01, 0x08, 0x06, 0x06, 0x01, 0x02, 0x01]),
    ...ext(0xff01, [0]), ...ext(0x17, []),
  ];
  if (t13) { const key = [...crypto.getRandomValues(new Uint8Array(32))]; exts.push(...ext(43, [2, 0x03, 0x04]), ...ext(51, [...u16(36), 0x00, 0x1d, ...u16(32), ...key])); ciphers.unshift(0x1301, 0x1302, 0x1303); }
  const rnd = [...crypto.getRandomValues(new Uint8Array(32))];
  const body = [...u16(ver), ...rnd, 0, ...u16(ciphers.length * 2), ...ciphers.flatMap(u16), 1, 0, ...u16(exts.length), ...exts];
  const hs = [1, ...u24(body.length), ...body];
  return new Uint8Array([0x16, 0x03, 0x01, ...u16(hs.length), ...hs]);
}
async function handshake(host: string, ver: number, ms = 7000, t13 = false) {
  let conn: Deno.Conn | null = null; const timer = setTimeout(() => { try { conn?.close(); } catch { /**/ } }, ms);
  try {
    conn = await Deno.connect({ hostname: host, port: 443 });
    await conn.write(clientHello(host, ver, t13));
    let buf = new Uint8Array(0); const hsData: number[] = []; let serverVer = 0; let certs: Uint8Array[] = []; let alert = false;
    const chunk = new Uint8Array(16384);
    outer: while (buf.length < 200000) {
      const n = await conn.read(chunk); if (n === null) break;
      const nb = new Uint8Array(buf.length + n); nb.set(buf); nb.set(chunk.subarray(0, n), buf.length); buf = nb;
      while (buf.length >= 5) {
        const type = buf[0], len = (buf[3] << 8) | buf[4]; if (buf.length < 5 + len) break;
        const frag = buf.subarray(5, 5 + len); buf = buf.slice(5 + len);
        if (type === 21) { alert = true; break outer; }
        if (type === 20 || type === 23) break outer; // ChangeCipherSpec / encrypted => TLS1.3 path, certs encrypted
        if (type === 22) { for (const b of frag) hsData.push(b);
          let off = 0;
          while (off + 4 <= hsData.length) {
            const mt = hsData[off], ml = (hsData[off + 1] << 16) | (hsData[off + 2] << 8) | hsData[off + 3]; if (off + 4 + ml > hsData.length) break;
            const m = Uint8Array.from(hsData.slice(off + 4, off + 4 + ml));
            if (mt === 2) { serverVer = (m[0] << 8) | m[1]; const sidl = m[34]; let p = 35 + sidl + 3; if (m.length > p + 2) { const el = (m[p] << 8) | m[p + 1]; p += 2; const end = p + el; while (p + 4 <= end) { const t = (m[p] << 8) | m[p + 1], l = (m[p + 2] << 8) | m[p + 3]; if (t === 43 && l === 2) serverVer = (m[p + 4] << 8) | m[p + 5]; p += 4 + l; } } }
            if (mt === 11) { let p = 3; while (p + 3 <= m.length) { const l = (m[p] << 16) | (m[p + 1] << 8) | m[p + 2]; certs.push(m.slice(p + 3, p + 3 + l)); p += 3 + l; } break outer; }
            if (mt === 14) break outer;
            off += 4 + ml;
          }
          if (off) hsData.splice(0, off);
        }
      }
    }
    return { ok: !alert && serverVer > 0, serverVer, certs, alert };
  } catch (e) { return { ok: false, serverVer: 0, certs: [] as Uint8Array[], alert: false, err: String(e).slice(0, 100) }; }
  finally { clearTimeout(timer); try { conn?.close(); } catch { /**/ } }
}
// --- tiny DER reader
type Node = { tag: number; start: number; hl: number; len: number; b: Uint8Array };
function rd(b: Uint8Array, at: number): Node { const tag = b[at]; let l = b[at + 1], hl = 2; if (l & 0x80) { const k = l & 0x7f; l = 0; for (let i = 0; i < k; i++) l = l * 256 + b[at + 2 + i]; hl = 2 + k; } return { tag, start: at, hl, len: l, b }; }
const kids = (n: Node) => { const out: Node[] = []; let p = n.start + n.hl; const end = p + n.len; while (p < end) { const c = rd(n.b, p); out.push(c); p = c.start + c.hl + c.len; } return out; };
const val = (n: Node) => n.b.subarray(n.start + n.hl, n.start + n.hl + n.len);
const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, "0")).join("");
const str = (n: Node) => new TextDecoder().decode(val(n));
function time(n: Node) { const s = str(n); const y = n.tag === 0x17 ? (Number(s.slice(0, 2)) < 50 ? "20" : "19") + s.slice(0, 2) : s.slice(0, 4); const r = n.tag === 0x17 ? s.slice(2) : s.slice(4); return new Date(`${y}-${r.slice(0, 2)}-${r.slice(2, 4)}T${r.slice(4, 6)}:${r.slice(6, 8)}:${r.slice(8, 10)}Z`).toISOString(); }
function name(n: Node) { const o: Record<string, string> = {}; for (const set of kids(n)) for (const atv of kids(set)) { const [oid, v] = kids(atv); const h = hex(val(oid)); if (h === "550403") o.CN = str(v); if (h === "55040a") o.O = str(v); } return o; }
function parseCert(der: Uint8Array) {
  const cert = rd(der, 0); const tbs = kids(cert)[0]; let k = kids(tbs); if (k[0].tag === 0xa0) k = k.slice(1);
  const [, , issuer, validity, subject, spki] = k; const [nb, na] = kids(validity);
  const out: any = { issuer: name(issuer), subject: name(subject), valid_from: time(nb), valid_to: time(na), san: [] as string[] };
  const [alg, bits] = kids(spki); const algOid = hex(val(kids(alg)[0]));
  if (algOid === "2a864886f70d010101") { const bs = val(bits).subarray(1); const rsa = rd(bs, 0); const mod = kids(rsa)[0]; let ml = mod.len; if (bs[mod.start + mod.hl] === 0) ml--; out.key = "RSA"; out.bits = ml * 8; }
  else if (algOid === "2a8648ce3d0201") { const c = hex(val(kids(alg)[1])); out.key = "EC"; out.curve = c === "2a8648ce3d030107" ? "P-256" : c === "2b81040022" ? "P-384" : c === "2b81040023" ? "P-521" : c; out.bits = out.curve === "P-384" ? 384 : out.curve === "P-521" ? 521 : 256; }
  else if (algOid === "2b6570") { out.key = "Ed25519"; out.bits = 256; }
  const ext = k.find((x) => x.tag === 0xa3);
  if (ext) for (const e of kids(kids(ext)[0])) { const ek = kids(e); if (hex(val(ek[0])) === "551d11") { const os = ek[ek.length - 1]; const seq = rd(os.b, os.start + os.hl); for (const g of kids(seq)) if (g.tag === 0x82) out.san.push(new TextDecoder().decode(val(g))); } }
  return out;
}
async function tlsProbe(host: string) {
  const res: any = { versions: {} as Record<string, boolean | null> };
  const t12 = await handshake(host, 0x0303);
  res.versions["TLS1.2"] = t12.ok ? t12.serverVer === 0x0303 : false;
  if (t12.certs.length) { try { res.cert = parseCert(t12.certs[0]); res.chain = t12.certs.length; } catch (e) { res.parse_err = String(e).slice(0, 80); } }
  const t13 = await handshake(host, 0x0303, 7000, true); res.versions["TLS1.3"] = t13.serverVer === 0x0304;
  for (const [n, v] of [["TLS1.0", 0x0301], ["TLS1.1", 0x0302]] as [string, number][]) { const r = await handshake(host, v); res.versions[n] = r.ok ? r.serverVer === v : r.err ? null : false; }
  res.err = t12.err; return res;
}
const hostMatches = (san: string, host: string) => (san || "").split(/,\s*/).map((x) => x.replace(/^DNS:/, "").toLowerCase()).some((n) => n === host || (n.startsWith("*.") && host.endsWith(n.slice(1)) && host.split(".").length === n.split(".").length));

async function scanSite(site: any) {
  const F: Finding[] = []; const meta: any = { started: new Date().toISOString(), notes: [] as string[] };
  const host = site.domain, base = site.base_path || "/", origin = "https://" + host, url = origin + base;
  const shared = isShared(host); const prefix = shared ? base.replace(/\/$/, "") : "";
  const add = (f: Finding) => F.push(f);
  const robots = await robotsFor(origin); meta.robots = robots.found ? robots.dis.length + " disallow" : "none";
  const allowed = (p: string) => robotsAllow(robots.dis, p);

  // TLS: raw handshake probe (ServerHello + certificate only), trust via a validating HTTPS fetch
  const [tp, trust] = await Promise.all([tlsProbe(host), get(url, { max: 1024, timeout: 10000 })]);
  const c = tp.cert; meta.tls = { versions: tp.versions, issuer: c?.issuer, subject: c?.subject, valid_from: c?.valid_from, valid_to: c?.valid_to, san: c?.san, key: c?.key, bits: c?.bits, curve: c?.curve, chain: tp.chain };
  const trustErr = !trust.ok && /certificate|cert|tls|ssl|handshake/i.test(trust.err || "");
  if (!c && !trust.ok) add({ id: "tls_fail", cat: "tls", sev: "critical", t_ar: "تعذّر إنشاء اتصال آمن TLS", t_en: "TLS connection failed", ev: (trust.err || tp.err || "").slice(0, 120) });
  else {
    if (trustErr) add({ id: "tls_untrusted", cat: "tls", sev: "critical", t_ar: "الشهادة غير موثوقة لدى المتصفحات", t_en: "Certificate not trusted", ev: trust.err.slice(0, 140) });
    else if (trust.ok) add({ id: "tls_trusted", cat: "tls", sev: "pass", t_ar: `شهادة موثوقة صادرة من ${c?.issuer?.O || c?.issuer?.CN || "جهة معروفة"}`, t_en: `Trusted certificate from ${c?.issuer?.O || c?.issuer?.CN || "known CA"}` });
    if (c) {
      const days = Math.floor((Date.parse(c.valid_to) - Date.now()) / 864e5); meta.tls.days_left = days;
      if (c.san?.length && !hostMatches(c.san.join(", "), host)) add({ id: "tls_name", cat: "tls", sev: "high", t_ar: "اسم النطاق لا يطابق الشهادة", t_en: "Hostname mismatch", ev: c.san.join(", ").slice(0, 200) });
      if (days < 0) add({ id: "tls_expired", cat: "tls", sev: "critical", t_ar: "الشهادة منتهية الصلاحية", t_en: "Certificate expired", ev: c.valid_to });
      else if (days < 14) add({ id: "tls_expiring", cat: "tls", sev: "high", t_ar: `الشهادة تنتهي خلال ${days} يوماً`, t_en: `Certificate expires in ${days} days`, ev: c.valid_to });
      else if (days < 30) add({ id: "tls_expiring", cat: "tls", sev: "medium", t_ar: `الشهادة تنتهي خلال ${days} يوماً`, t_en: `Certificate expires in ${days} days`, ev: c.valid_to });
      else add({ id: "tls_valid", cat: "tls", sev: "pass", t_ar: `الشهادة صالحة ${days} يوماً أخرى`, t_en: `Certificate valid for ${days} more days`, ev: c.valid_to.slice(0, 10) });
      if (c.key === "RSA" && c.bits < 2048) add({ id: "tls_weakkey", cat: "tls", sev: "high", t_ar: `مفتاح الشهادة ضعيف (RSA ${c.bits})`, t_en: `Weak key (RSA ${c.bits})` });
      else add({ id: "tls_key", cat: "tls", sev: "pass", t_ar: `مفتاح قوي (${c.key}${c.curve ? " " + c.curve : " " + c.bits})`, t_en: `Strong key (${c.key} ${c.curve || c.bits})` });
    } else meta.notes.push("cert_details_unavailable");
    const v = tp.versions;
    if (v["TLS1.0"] || v["TLS1.1"]) add({ id: "tls_legacy", cat: "tls", sev: "medium", t_ar: `بروتوكولات قديمة مفعّلة: ${[v["TLS1.0"] && "TLS 1.0", v["TLS1.1"] && "TLS 1.1"].filter(Boolean).join("، ")}`, t_en: `Legacy protocols enabled: ${[v["TLS1.0"] && "TLS 1.0", v["TLS1.1"] && "TLS 1.1"].filter(Boolean).join(", ")}` });
    else if (v["TLS1.0"] === false && v["TLS1.1"] === false) add({ id: "tls_legacy_off", cat: "tls", sev: "pass", t_ar: "TLS 1.0 و1.1 معطّلان", t_en: "TLS 1.0/1.1 disabled" });
    if (v["TLS1.3"]) add({ id: "tls13", cat: "tls", sev: "pass", t_ar: "يدعم TLS 1.3", t_en: "TLS 1.3 supported" });
    else if (c) add({ id: "tls13_missing", cat: "tls", sev: "low", t_ar: "لا يدعم TLS 1.3 (الأحدث والأسرع)", t_en: "TLS 1.3 not supported" });
  }

  // HTTP -> HTTPS
  const h = await get("http://" + host + base, { redirect: "manual", max: 2048, timeout: 8000 });
  const loc = h.headers.get("location") || "";
  if (!h.ok) add({ id: "http_closed", cat: "transport", sev: "pass", t_ar: "المنفذ 80 (HTTP) لا يقدّم محتوى غير مشفر", t_en: "HTTP not served" });
  else if ([301, 308].includes(h.status) && loc.startsWith("https://")) add({ id: "http_redirect", cat: "transport", sev: "pass", t_ar: "تحويل دائم من HTTP إلى HTTPS", t_en: "Permanent HTTP→HTTPS redirect", ev: `${h.status} → ${loc.slice(0, 80)}` });
  else if ([302, 303, 307].includes(h.status) && loc.startsWith("https://")) add({ id: "http_redirect_temp", cat: "transport", sev: "low", t_ar: "التحويل إلى HTTPS مؤقت وليس دائماً", t_en: "HTTPS redirect is temporary", ev: `${h.status} → ${loc.slice(0, 80)}` });
  else if (h.status >= 400) add({ id: "http_error", cat: "transport", sev: "low", t_ar: `طلبات HTTP غير المشفرة تُرجع خطأ (${h.status}) بدلاً من التحويل إلى HTTPS`, t_en: `HTTP returns ${h.status} instead of redirecting to HTTPS`, ev: `HTTP ${h.status}` });
  else add({ id: "http_no_redirect", cat: "transport", sev: "high", t_ar: "الموقع يعمل عبر HTTP دون تحويل إلى HTTPS", t_en: "Served over HTTP without HTTPS redirect", ev: `HTTP ${h.status}` });

  // homepage
  const p = await get(url, { max: 1_500_000, timeout: 15000 }); meta.page = { status: p.status, ms: p.ms, bytes: p.bytes.length, final: p.url };
  if (!p.ok || p.status >= 400) add({ id: "page_fail", cat: "transport", sev: "info", t_ar: `الصفحة الرئيسية أعادت ${p.status || "خطأ"}`, t_en: `Homepage returned ${p.status || "error"}`, ev: p.err || undefined });
  const H = p.headers; const hv = (n: string) => H.get(n) || "";
  meta.headers = Object.fromEntries([...H.entries()].filter(([k]) => k !== "set-cookie").slice(0, 60));
  const server = hv("server"), powered = hv("x-powered-by"), html = p.text;
  const platform = host.endsWith("github.io") || /github\.com/i.test(server) ? "github_pages" : (hv("x-shopid") || /shopify/i.test(hv("powered-by")) || /cdn\.shopify\.com/.test(html.slice(0, 300000))) ? "shopify" : /vercel/i.test(server) ? "vercel" : /netlify/i.test(server) ? "netlify" : /nginx/i.test(server) ? "nginx" : /apache/i.test(server) ? "apache" : /microsoft-iis/i.test(server) ? "iis" : hv("cf-ray") ? "cloudflare" : "unknown";
  meta.platform = platform; meta.cdn = hv("cf-ray") ? "cloudflare" : hv("x-fastly-request-id") || /varnish/i.test(hv("via")) ? "fastly" : hv("x-amz-cf-id") ? "cloudfront" : null;

  const hsts = hv("strict-transport-security"); const ma = Number(hsts.match(/max-age=(\d+)/i)?.[1] || 0);
  const gh = host.endsWith(".github.io");
  if (!hsts) add({ id: "hsts_missing", cat: "transport", sev: gh ? "info" : "medium", t_ar: gh ? "ترويسة HSTS غير مرسلة (لكن نطاق github.io مدرج مسبقاً في قائمة HSTS للمتصفحات)" : "ترويسة HSTS مفقودة", t_en: gh ? "HSTS header not sent (github.io is browser-preloaded)" : "HSTS header missing" });
  else if (ma < 15552000) add({ id: "hsts_short", cat: "transport", sev: "low", t_ar: "مدة HSTS أقل من 6 أشهر", t_en: "HSTS max-age below 6 months", ev: hsts });
  else add({ id: "hsts_ok", cat: "transport", sev: "pass", t_ar: "HSTS مفعّل بمدة كافية" + (/preload/i.test(hsts) ? " ومؤهل للتحميل المسبق" : ""), t_en: "HSTS enabled", ev: hsts });

  const csp = hv("content-security-policy"); const cspMeta = (html.match(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*content=["']([^"']+)/i) || [])[1] || "";
  const cspAll = csp || cspMeta;
  if (!cspAll) add({ id: "csp_missing", cat: "headers", sev: "medium", t_ar: "سياسة أمان المحتوى (CSP) مفقودة", t_en: "Content-Security-Policy missing" });
  else {
    add({ id: "csp_present", cat: "headers", sev: "pass", t_ar: csp ? "سياسة CSP موجودة" : "سياسة CSP موجودة عبر وسم meta", t_en: "CSP present", ev: cspAll.slice(0, 200) });
    if (/'unsafe-inline'/.test(cspAll) && /script-src|default-src/.test(cspAll) && !/'nonce-|'strict-dynamic'/.test(cspAll)) add({ id: "csp_unsafe_inline", cat: "headers", sev: "low", t_ar: "CSP تسمح بـ unsafe-inline للسكربتات", t_en: "CSP allows 'unsafe-inline' scripts" });
    if (!/(default-src|script-src)/i.test(cspAll)) add({ id: "csp_weak", cat: "headers", sev: "low", t_ar: "CSP لا تقيّد مصادر السكربتات (لا default-src ولا script-src)", t_en: "CSP has no default-src/script-src", ev: cspAll.slice(0, 120) });
  }
  const xfo = hv("x-frame-options"); const fa = /frame-ancestors/i.test(csp);
  if (!xfo && !fa) add({ id: "xfo_missing", cat: "headers", sev: "medium", t_ar: "لا حماية من التضمين الخبيث (Clickjacking)", t_en: "No clickjacking protection (X-Frame-Options / frame-ancestors)" });
  else add({ id: "xfo_ok", cat: "headers", sev: "pass", t_ar: "حماية Clickjacking مفعّلة", t_en: "Clickjacking protection present", ev: xfo || "frame-ancestors" });
  const simple: [string, string, Sev, string, string, (v: string) => boolean][] = [
    ["x-content-type-options", "xcto", "low", "X-Content-Type-Options: nosniff مفقودة", "X-Content-Type-Options missing", (v) => /nosniff/i.test(v)],
    ["referrer-policy", "refpol", "low", "سياسة المُحيل Referrer-Policy مفقودة", "Referrer-Policy missing", (v) => !!v && !/unsafe-url/i.test(v)],
    ["permissions-policy", "permpol", "low", "سياسة الأذونات Permissions-Policy مفقودة", "Permissions-Policy missing", (v) => !!v],
    ["cross-origin-opener-policy", "coop", "info", "ترويسة COOP غير مضبوطة", "Cross-Origin-Opener-Policy not set", (v) => !!v],
    ["cross-origin-resource-policy", "corp", "info", "ترويسة CORP غير مضبوطة", "Cross-Origin-Resource-Policy not set", (v) => !!v],
  ];
  for (const [n, id, sev, ar, en, okf] of simple) { const v = n === "referrer-policy" ? hv(n) || (html.match(/<meta[^>]+name=["']referrer["'][^>]*content=["']([^"']+)/i) || [])[1] || "" : hv(n); if (okf(v)) add({ id: id + "_ok", cat: "headers", sev: "pass", t_ar: `${n} مضبوطة`, t_en: `${n} set`, ev: v.slice(0, 120) }); else add({ id, cat: "headers", sev, t_ar: ar, t_en: en, ev: v || undefined }); }
  if (hv("x-xss-protection") && !/^0/.test(hv("x-xss-protection"))) add({ id: "xxss_legacy", cat: "headers", sev: "info", t_ar: "ترويسة X-XSS-Protection قديمة ويُنصح بضبطها على 0", t_en: "Legacy X-XSS-Protection enabled", ev: hv("x-xss-protection") });

  if (/\d+\.\d+/.test(server)) add({ id: "server_version", cat: "software", sev: "low", t_ar: "ترويسة Server تكشف رقم الإصدار", t_en: "Server header discloses version", ev: server });
  else add({ id: "server_ok", cat: "software", sev: "pass", t_ar: "ترويسة Server لا تكشف إصداراً", t_en: "Server header hides version", ev: server || undefined });
  if (powered) add({ id: "powered_by", cat: "software", sev: /\d/.test(powered) ? "low" : "info", t_ar: "ترويسة X-Powered-By تكشف التقنية المستخدمة", t_en: "X-Powered-By discloses technology", ev: powered });
  for (const n of ["x-aspnet-version", "x-aspnetmvc-version", "x-generator", "x-runtime"]) if (hv(n)) add({ id: "leak_" + n, cat: "software", sev: "low", t_ar: `ترويسة ${n} تكشف معلومات داخلية`, t_en: `${n} leaks internals`, ev: hv(n).slice(0, 80) });

  const cookies: string[] = (H as any).getSetCookie?.() || []; meta.cookies = cookies.length;
  for (const c of cookies.slice(0, 20)) {
    const name = c.split("=")[0].trim(); const miss: string[] = [];
    if (!/;\s*secure/i.test(c)) miss.push("Secure"); if (!/;\s*httponly/i.test(c)) miss.push("HttpOnly"); if (!/;\s*samesite=/i.test(c)) miss.push("SameSite");
    const sens = /sess|auth|token|sid|login|jwt/i.test(name);
    const ev = c.replace(/^([^=]+=)([^;]{0,4})[^;]*/, "$1$2…").slice(0, 160);
    if (miss.length) add({ id: "cookie_" + name.replace(/\W/g, "_").slice(0, 30), cat: "cookies", sev: sens && (miss.includes("Secure") || miss.includes("HttpOnly")) ? "medium" : miss.includes("Secure") ? "low" : "info", t_ar: `ملف تعريف الارتباط «${name}» ينقصه: ${miss.join("، ")}`, t_en: `Cookie "${name}" missing: ${miss.join(", ")}`, ev });
    else add({ id: "cookie_ok_" + name.replace(/\W/g, "_").slice(0, 30), cat: "cookies", sev: "pass", t_ar: `ملف «${name}» بخصائص آمنة`, t_en: `Cookie "${name}" has secure flags` });
  }

  const co = await get(url, { headers: { origin: "https://cors-check.alcode-shield.invalid" }, max: 1024, timeout: 8000 });
  const acao = co.headers.get("access-control-allow-origin") || "", acac = co.headers.get("access-control-allow-credentials") || "";
  if (acao === "https://cors-check.alcode-shield.invalid" && /true/i.test(acac)) add({ id: "cors_reflect_creds", cat: "headers", sev: "high", t_ar: "CORS يعكس أي أصل مع السماح ببيانات الاعتماد", t_en: "CORS reflects arbitrary origin with credentials", ev: `ACAO: ${acao}; ACAC: ${acac}` });
  else if (acao === "https://cors-check.alcode-shield.invalid") add({ id: "cors_reflect", cat: "headers", sev: "medium", t_ar: "CORS يعكس أي أصل يُرسَل إليه", t_en: "CORS reflects arbitrary origin", ev: acao });
  else if (acao === "*") add({ id: "cors_star", cat: "headers", sev: "info", t_ar: "CORS مفتوح للجميع (*) — مقبول للمحتوى العام الثابت فقط", t_en: "CORS wildcard (*) — fine for public static content", ev: acao });
  else add({ id: "cors_ok", cat: "headers", sev: "pass", t_ar: "لا يوجد CORS مفتوح على الصفحة الرئيسية", t_en: "No open CORS on homepage" });

  const apex = apexOf(host); meta.apex = apex;
  if (shared) meta.notes.push("dns_platform_managed");
  else {
    const [txt, dmarc, caa, mx, ds, aRec, mtasts, tlsrpt] = await Promise.all([doh(apex, "TXT"), doh("_dmarc." + apex, "TXT"), doh(apex, "CAA"), doh(apex, "MX"), doh(apex, "DS"), doh(apex, "SOA", true), doh("_mta-sts." + apex, "TXT"), doh("_smtp._tls." + apex, "TXT")]);
    const spf = txtOf(txt.ans).filter((t) => /^v=spf1/i.test(t)); const hasMx = mx.ans.some((x) => x.type === 15);
    const dm = txtOf(dmarc.ans).find((t) => /^v=DMARC1/i.test(t)) || null;
    meta.dns = { mx: mx.ans.filter((x) => x.type === 15).map((x) => x.data).slice(0, 5), spf: spf[0] || null, dmarc: dm, caa: caa.ans.filter((x) => x.type === 257).map((x) => x.data).slice(0, 5), ds: ds.ans.some((x) => x.type === 43), ad: aRec.ad };
    if (!spf.length) add({ id: "spf_missing", cat: "email", sev: hasMx ? "medium" : "low", t_ar: "سجل SPF مفقود — يمكن انتحال بريد نطاقك", t_en: "SPF record missing" });
    else if (spf.length > 1) add({ id: "spf_multi", cat: "email", sev: "medium", t_ar: "أكثر من سجل SPF (يُبطل SPF)", t_en: "Multiple SPF records (invalid)", ev: spf.join(" | ").slice(0, 200) });
    else if (/\+all\b/.test(spf[0])) add({ id: "spf_plusall", cat: "email", sev: "high", t_ar: "SPF يسمح لأي خادم بالإرسال باسمك (+all)", t_en: "SPF allows anyone (+all)", ev: spf[0] });
    else if (!/[~-]all\b/.test(spf[0])) add({ id: "spf_weak", cat: "email", sev: "low", t_ar: "سياسة SPF محايدة ولا تمنع الانتحال", t_en: "SPF neutral (?all / no all)", ev: spf[0] });
    else add({ id: "spf_ok", cat: "email", sev: "pass", t_ar: "سجل SPF سليم", t_en: "SPF valid", ev: spf[0].slice(0, 160) });
    if (!dm) add({ id: "dmarc_missing", cat: "email", sev: "medium", t_ar: "سجل DMARC مفقود", t_en: "DMARC missing" });
    else if (/p=none/i.test(dm)) add({ id: "dmarc_none", cat: "email", sev: "low", t_ar: "DMARC في وضع المراقبة فقط (p=none)", t_en: "DMARC policy is none", ev: dm });
    else add({ id: "dmarc_ok", cat: "email", sev: "pass", t_ar: "سياسة DMARC مفعّلة", t_en: "DMARC enforced", ev: dm.slice(0, 160) });
    if (hasMx) {
      const sels = ["google", "default", "selector1", "selector2", "k1", "s1", "s2", "mail", "dkim", "zoho", "protonmail"];
      const found: string[] = []; await Promise.all(sels.map(async (s) => { const r = await doh(`${s}._domainkey.${apex}`, "TXT"); if (r.ans.length) found.push(s); }));
      if (found.length) add({ id: "dkim_found", cat: "email", sev: "pass", t_ar: `مفاتيح DKIM موجودة (${found.join("، ")})`, t_en: `DKIM selectors found (${found.join(", ")})` });
      else add({ id: "dkim_unknown", cat: "email", sev: "info", t_ar: "لم نجد DKIM في المحدِّدات الشائعة (قد يستخدم مزوّدك محدِّداً مختلفاً)", t_en: "No DKIM on common selectors" });
      if (!txtOf(mtasts.ans).length) add({ id: "mtasts_missing", cat: "email", sev: "info", t_ar: "MTA-STS غير مفعّل لتشفير البريد الوارد", t_en: "MTA-STS not configured" });
      if (!txtOf(tlsrpt.ans).length) add({ id: "tlsrpt_missing", cat: "email", sev: "info", t_ar: "تقارير TLS-RPT غير مفعّلة", t_en: "TLS-RPT not configured" });
    } else add({ id: "no_mx", cat: "email", sev: "info", t_ar: "لا يوجد بريد (MX) على النطاق — يُنصح بـ «v=spf1 -all» وDMARC reject لمنع الانتحال", t_en: "No MX; use null SPF and DMARC reject" });
    if (!meta.dns.caa.length) add({ id: "caa_missing", cat: "dns", sev: "low", t_ar: "سجل CAA مفقود (يحدد من يحق له إصدار شهادات لنطاقك)", t_en: "CAA record missing" });
    else add({ id: "caa_ok", cat: "dns", sev: "pass", t_ar: "سجل CAA موجود", t_en: "CAA present", ev: meta.dns.caa.join(" | ").slice(0, 160) });
    if (meta.dns.ds && aRec.ad) add({ id: "dnssec_ok", cat: "dns", sev: "pass", t_ar: "DNSSEC مفعّل ومتحقق منه", t_en: "DNSSEC validated" });
    else add({ id: "dnssec_off", cat: "dns", sev: "low", t_ar: "DNSSEC غير مفعّل", t_en: "DNSSEC not enabled" });
  }

  // Exposed files — single GET each, robots respected, soft-404 baseline
  const rnd = crypto.randomUUID().slice(0, 8);
  const bl = await get(`${origin}${prefix}/alcode-shield-${rnd}.txt`, { max: 16384, timeout: 8000, redirect: "manual" });
  const blLen = bl.text.length; const soft = (r: any) => bl.status === 200 && r.status === 200 && Math.abs(r.text.length - blLen) < 64;
  const probes: [string, (r: any) => boolean, Sev, string, string][] = [
    ["/.git/HEAD", (r) => /^ref:\s*refs\//.test(r.text), "critical", "مستودع Git مكشوف (/.git)", "Exposed .git repository"],
    ["/.git/config", (r) => /\[core\]/.test(r.text), "critical", "إعدادات Git مكشوفة", "Exposed .git/config"],
    ["/.env", (r) => /^\s*[A-Z][A-Z0-9_]{2,}\s*=/m.test(r.text) && !/<html|<!doctype/i.test(r.text), "critical", "ملف البيئة .env مكشوف", "Exposed .env file"],
    ["/.env.local", (r) => /^\s*[A-Z][A-Z0-9_]{2,}\s*=/m.test(r.text) && !/<html|<!doctype/i.test(r.text), "critical", "ملف .env.local مكشوف", "Exposed .env.local"],
    ["/.svn/entries", (r) => /^\d+\s*$/m.test(r.text.slice(0, 20)), "high", "مستودع SVN مكشوف", "Exposed .svn"],
    ["/.DS_Store", (r) => r.bytes.length > 8 && r.text.slice(4, 8) === "Bud1", "low", "ملف .DS_Store يكشف أسماء الملفات", "Exposed .DS_Store"],
    ["/wp-config.php.bak", (r) => /DB_PASSWORD|DB_NAME/.test(r.text), "critical", "نسخة احتياطية من wp-config مكشوفة", "Exposed wp-config backup"],
    ["/backup.zip", (r) => r.text.startsWith("PK"), "high", "ملف نسخة احتياطية مكشوف", "Exposed backup archive"],
    ["/site.zip", (r) => r.text.startsWith("PK"), "high", "أرشيف الموقع مكشوف", "Exposed site archive"],
    ["/backup.sql", (r) => /(CREATE TABLE|INSERT INTO)/i.test(r.text) && !/<html/i.test(r.text), "critical", "تفريغ قاعدة بيانات مكشوف", "Exposed SQL dump"],
    ["/.htpasswd", (r) => /^[^:\s<]+:(\$apr1\$|\{SHA\}|\$2[aby]\$)/m.test(r.text), "critical", "ملف كلمات مرور .htpasswd مكشوف", "Exposed .htpasswd"],
    ["/phpinfo.php", (r) => /<title>phpinfo\(\)|PHP Version \d/i.test(r.text), "medium", "صفحة phpinfo مكشوفة", "Exposed phpinfo"],
    ["/server-status", (r) => /Apache Server Status/i.test(r.text), "medium", "صفحة server-status مكشوفة", "Exposed Apache server-status"],
    ["/config.json", (r) => /"(password|secret|apiKey|api_key|private_key)"\s*:/i.test(r.text), "high", "ملف إعدادات يحتوي حقولاً حساسة", "config.json with sensitive fields"],
    ["/.npmrc", (r) => /_authToken/i.test(r.text), "critical", "ملف .npmrc برمز دخول", "Exposed .npmrc token"],
    ["/docker-compose.yml", (r) => /^services:/m.test(r.text) && !/<html/i.test(r.text), "medium", "ملف docker-compose مكشوف", "Exposed docker-compose.yml"],
  ];
  let exposed = 0, skipped = 0, checked = 0;
  for (const [path, test, sev, ar, en] of probes) {
    const full = prefix + path; if (!allowed(full)) { skipped++; continue; }
    const r = await get(origin + full, { max: 16384, timeout: 7000, redirect: "manual" }); checked++;
    if (r.status === 200 && !soft(r) && test(r)) {
      exposed++;
      const ev = path.startsWith("/.env") ? r.text.split(/\r?\n/).filter((l) => /=/.test(l)).slice(0, 3).map((l) => l.split("=")[0].trim() + "=…").join(" ") : r.text.slice(0, 50).replace(/[A-Za-z0-9+/=_-]{12,}/g, (x) => mask(x)).replace(/[^\x20-\x7e]/g, ".");
      add({ id: "exposed_" + path.replace(/\W/g, "_"), cat: "exposure", sev, t_ar: ar, t_en: en, d_ar: "المسار: " + full, d_en: "Path: " + full, ev });
    }
    await sleep(120);
  }
  meta.probes = { checked, skipped };
  if (!exposed) add({ id: "exposure_ok", cat: "exposure", sev: "pass", t_ar: `لا ملفات حساسة مكشوفة (${checked} مساراً فُحص${skipped ? `، و${skipped} تُرك احتراماً لـ robots.txt` : ""})`, t_en: `No sensitive files exposed (${checked} paths checked${skipped ? `, ${skipped} skipped per robots.txt` : ""})` });
  let listing = false;
  for (const d of [prefix + "/assets/", prefix + "/images/", prefix + "/uploads/", prefix + "/files/", prefix + "/static/"]) {
    if (!allowed(d)) continue; const r = await get(origin + d, { max: 16384, timeout: 7000 });
    if (r.status === 200 && /<title>\s*Index of \//i.test(r.text)) { listing = true; add({ id: "dirlist", cat: "exposure", sev: "medium", t_ar: "استعراض محتويات المجلدات مفعّل", t_en: "Directory listing enabled", d_ar: d, d_en: d }); break; }
    await sleep(100);
  }
  if (!listing) add({ id: "dirlist_ok", cat: "exposure", sev: "pass", t_ar: "استعراض المجلدات معطّل", t_en: "Directory listing disabled" });
  const st = await get(origin + "/.well-known/security.txt", { max: 8192, timeout: 6000 });
  if (st.status === 200 && /contact:/i.test(st.text)) add({ id: "securitytxt_ok", cat: "exposure", sev: "pass", t_ar: "ملف security.txt موجود لاستقبال بلاغات الثغرات", t_en: "security.txt present" });
  else add({ id: "securitytxt_missing", cat: "exposure", sev: "info", t_ar: "لا يوجد ملف security.txt لاستقبال بلاغات الثغرات", t_en: "No security.txt" });

  // Content: mixed content, SRI, forms, generator, secrets, JS libraries vs OSV
  const pageUrl = p.url || url;
  const tags = [...html.matchAll(/<(script|iframe|link|img|source|audio|video|form|embed|object)\b[^>]*?\b(src|href|action|data)\s*=\s*["']?([^"'\s>]+)[^>]*>/gi)].map((m) => ({ tag: m[1].toLowerCase(), attr: m[2].toLowerCase(), val: m[3].replace(/&amp;/g, "&"), raw: m[0] }));
  const mixed = tags.filter((t) => /^http:\/\//i.test(t.val) && !(t.tag === "link" && !/stylesheet|preload|icon|manifest/i.test(t.raw)));
  const active = mixed.filter((t) => ["script", "iframe", "link", "embed", "object", "form"].includes(t.tag));
  if (active.length) add({ id: "mixed_active", cat: "content", sev: "medium", t_ar: `محتوى مختلط نشط (${active.length}) يُحمَّل عبر HTTP`, t_en: `Active mixed content (${active.length})`, ev: active.slice(0, 3).map((t) => t.val).join(" ") });
  const passive = mixed.filter((t) => !active.includes(t)); if (passive.length) add({ id: "mixed_passive", cat: "content", sev: "low", t_ar: `محتوى مختلط سلبي (${passive.length}) مثل صور عبر HTTP`, t_en: `Passive mixed content (${passive.length})`, ev: passive.slice(0, 3).map((t) => t.val).join(" ") });
  if (!mixed.length && html) add({ id: "mixed_ok", cat: "content", sev: "pass", t_ar: "لا يوجد محتوى مختلط", t_en: "No mixed content" });
  const scriptTags = tags.filter((t) => t.tag === "script" && t.attr === "src");
  const scripts = [...new Set(scriptTags.map((t) => { try { return new URL(t.val, pageUrl).href; } catch { return ""; } }).filter(Boolean))];
  const ext = scriptTags.filter((t) => { try { return new URL(t.val, pageUrl).host !== new URL(pageUrl).host; } catch { return false; } });
  const noSri = ext.filter((t) => !/integrity=/i.test(t.raw));
  meta.scripts = scripts.length; meta.third_party_hosts = [...new Set(ext.map((t) => { try { return new URL(t.val, pageUrl).host; } catch { return ""; } }))].slice(0, 20);
  if (noSri.length) add({ id: "sri_missing", cat: "content", sev: "info", t_ar: `${noSri.length} سكربت خارجي دون التحقق من سلامته (SRI)`, t_en: `${noSri.length} third-party scripts without SRI`, ev: noSri.slice(0, 3).map((t) => t.val.slice(0, 80)).join(" ") });
  const gen = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1]; if (gen) { meta.generator = gen; if (/\d/.test(gen)) add({ id: "generator", cat: "software", sev: "low", t_ar: "وسم generator يكشف المنصة وإصدارها", t_en: "Generator meta discloses platform/version", ev: gen }); }
  const httpForms = tags.filter((t) => t.tag === "form" && /^http:\/\//i.test(t.val)); if (httpForms.length) add({ id: "form_http", cat: "content", sev: "high", t_ar: "نموذج يرسل البيانات عبر HTTP غير مشفر", t_en: "Form submits over HTTP", ev: httpForms[0].val });
  const seen = new Set<string>(); findSecrets(html, "HTML الصفحة", F, seen);
  const libsFound = new Map<string, { name: string; npm: string; version: string; src: string }>();
  for (const s of scripts) for (const [name, npm] of LIBS) { const v = libUrlVer(npm, s); if (v) libsFound.set(npm, { name, npm, version: v, src: s }); }
  for (const [name, npm, res] of LIBS) for (const re of res) { const m = html.slice(0, 800000).match(re); if (m && !libsFound.has(npm)) libsFound.set(npm, { name, npm, version: m[1], src: "inline" }); }
  const toFetch = scripts.filter((s) => !/googletagmanager|google-analytics|facebook\.net|hotjar|clarity\.ms|doubleclick/i.test(s)).slice(0, 8);
  await Promise.all(toFetch.map(async (s) => {
    const r = await get(s, { max: 500_000, timeout: 9000 }); if (r.status !== 200) return;
    for (const [name, npm, res] of LIBS) { if (libsFound.has(npm)) continue; for (const re of res) { const m = r.text.match(re); if (m) { libsFound.set(npm, { name, npm, version: m[1], src: s }); break; } } }
    try { if (new URL(s).host === host) findSecrets(r.text, s.replace(origin, ""), F, seen); } catch { /**/ }
  }));
  meta.scripts_fetched = toFetch.length;
  const libs = [...libsFound.values()]; meta.libs = libs;
  const ov = await osv(libs.map((l) => ({ name: l.npm, version: l.version })));
  if (ov === null && libs.length) meta.notes.push("osv_unavailable");
  for (const l of ov || []) {
    const disp = libsFound.get(l.name)?.name || l.name;
    if (!l.count) { add({ id: "lib_ok_" + l.name, cat: "software", sev: "pass", t_ar: `${disp} ${l.version}: لا ثغرات معروفة`, t_en: `${disp} ${l.version}: no known vulnerabilities` }); continue; }
    const hi = l.vulns.some((v: any) => /HIGH|CRITICAL/i.test(v.sev || ""));
    add({ id: "lib_vuln_" + l.name.replace(/\W/g, "_"), cat: "software", sev: hi ? "high" : "medium", t_ar: `مكتبة ${disp} ${l.version} بها ${l.count} ثغرة معروفة`, t_en: `${disp} ${l.version} has ${l.count} known vulnerabilities`, ev: l.vulns.slice(0, 4).map((v: any) => `${v.alias || v.id}: ${v.summary}`).join(" | ").slice(0, 400) });
  }
  if (!libs.length) meta.notes.push("no_libs_detected");
  if (!seen.size) add({ id: "secrets_ok", cat: "content", sev: "pass", t_ar: `لا أنماط مفاتيح سرية في الصفحة و${toFetch.length} من سكربتاتها`, t_en: `No secret patterns in page and ${toFetch.length} scripts` });

  const sc = scoreOf(F); meta.finished = new Date().toISOString();
  return { findings: F, meta, ...sc };
}

// ---------------- IP protection helpers ----------------
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const words = (t: string) => t.toLowerCase().replace(/[\u064B-\u0652\u0640]/g, "").replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").match(/[\p{L}\p{N}]+/gu) || [];
function shingles(t: string, k = 6) { const w = words(t); const s = new Set<string>(); for (let i = 0; i + k <= w.length; i++) s.add(w.slice(i, i + k).join(" ")); return s; }
function overlap(src: string, cand: string) {
  const a = shingles(src), b = shingles(cand); if (!a.size || !b.size) return { contain: 0, jaccard: 0, matches: [] as string[] };
  let inter = 0; const m: string[] = []; for (const x of a) if (b.has(x)) { inter++; if (m.length < 6) m.push(x); }
  return { contain: inter / a.size, jaccard: inter / (a.size + b.size - inter), matches: m };
}
async function safeFetchPage(u: string, max = 2_000_000): Promise<any> {
  let url: URL; try { url = new URL(u); } catch { return { err: "bad_url" }; }
  if (!/^https?:$/.test(url.protocol) || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || !(await publicHost(url.hostname))) return { err: "blocked_host" };
  const r = await get(url.href, { max, timeout: 12000 }); if (!r.ok) return { err: "fetch_failed" };
  return { r };
}
async function dhash(u: string): Promise<string | { err: string }> {
  const f: any = await safeFetchPage(u, 8_000_000); if (f.err) return { err: f.err };
  if (f.r.status !== 200) return { err: "http_" + f.r.status };
  const ct = f.r.headers.get("content-type") || "";
  if (/svg/i.test(ct) || /^\s*(<svg|<\?xml)/i.test(f.r.text.slice(0, 100))) return { err: "svg_not_supported" };
  try {
    const { Image, decode } = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
    let img: any = await decode(f.r.bytes); if (!(img instanceof Image)) img = img[0];
    img.resize(9, 8);
    const g = (c: number) => ((c >>> 24) & 255) * 0.299 + ((c >>> 16) & 255) * 0.587 + ((c >>> 8) & 255) * 0.114;
    let bits = ""; for (let y = 1; y <= 8; y++) for (let x = 1; x <= 8; x++) bits += g(img.getPixelAt(x, y)) > g(img.getPixelAt(x + 1, y)) ? "1" : "0";
    return BigInt("0b" + bits).toString(16).padStart(16, "0");
  } catch { return { err: "decode_failed" }; }
}
const ham = (a: string, b: string) => { let x = BigInt("0x" + a) ^ BigInt("0x" + b), n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };
function typoVariants(domain: string) {
  const parts = domain.split("."); const name = parts[0], tld = parts.slice(1).join("."); const out = new Set<string>();
  const kb: Record<string, string> = { a: "qsz", b: "vgn", c: "xvd", d: "sfe", e: "wrd", f: "dgr", g: "fht", h: "gjy", i: "uko", j: "hku", k: "jli", l: "ko", m: "n", n: "bm", o: "ipl", p: "o", q: "wa", r: "et", s: "adw", t: "ry", u: "yi", v: "cb", w: "qe", x: "zc", y: "tu", z: "xa" };
  const hom: Record<string, string[]> = { o: ["0"], l: ["1", "i"], i: ["1", "l"], e: ["3"], a: ["4"], s: ["5"], m: ["rn"], w: ["vv"] };
  for (let i = 0; i < name.length; i++) {
    out.add(name.slice(0, i) + name.slice(i + 1)); out.add(name.slice(0, i) + name[i] + name.slice(i));
    if (i < name.length - 1) out.add(name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2));
    for (const c of kb[name[i]] || "") out.add(name.slice(0, i) + c + name.slice(i + 1));
    for (const c of hom[name[i]] || []) out.add(name.slice(0, i) + c + name.slice(i + 1));
    if (i > 0) out.add(name.slice(0, i) + "-" + name.slice(i));
  }
  const res = new Set<string>(); for (const n of out) if (n && n !== name && n.length > 2) res.add(n + "." + tld);
  for (const t of ["com", "net", "org", "co", "io", "shop", "store", "online", "site", "app", "ae", "com.ae", "me", "info", "xyz"]) if (t !== tld) res.add(name + "." + t);
  for (const pre of ["my", "get", "shop"]) res.add(pre + name + "." + tld);
  for (const suf of ["-ae", "-uae", "store", "-shop", "-login", "-support"]) res.add(name + suf + "." + tld);
  return [...res].filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && !/^-|-\./.test(d)).slice(0, 130);
}

const pickSite = async (owner: string, id: string) => { const r = await dbSel(`shield_sites?id=eq.${encodeURIComponent(String(id || ""))}&owner=eq.${owner}&select=*`); return r.ok ? r.j?.[0] : null; };
const uuidOk = (s: unknown) => /^[0-9a-f-]{36}$/i.test(String(s || ""));

async function runScanFor(owner: string, site: any) {
  const ins = await dbIns("shield_scans", { owner, site_id: site.id, status: "running" }); const scanId = ins.j?.[0]?.id;
  try {
    const res = await scanSite(site);
    const prev = await dbSel(`shield_scans?site_id=eq.${site.id}&status=eq.done&select=id,score&order=started_at.desc&limit=1`);
    await dbPatch(`shield_scans?id=eq.${scanId}`, { status: "done", score: res.score, grade: res.grade, categories: res.cats, findings: res.findings, meta: { ...res.meta, prev_id: prev.j?.[0]?.id || null, prev_score: prev.j?.[0]?.score ?? null }, finished_at: new Date().toISOString() });
    await dbPatch(`shield_sites?id=eq.${site.id}`, { last_score: res.score, last_grade: res.grade, last_scan_at: new Date().toISOString() });
    return { id: scanId, ...res };
  } catch (e) { await dbPatch(`shield_scans?id=eq.${scanId}`, { status: "failed", meta: { error: String(e).slice(0, 200) }, finished_at: new Date().toISOString() }); throw e; }
}

async function op(b: any, req: Request) {
  if (!SB || !ANON || !SRV) return json({ error: "backend_not_configured" }, 500);
  const tok = typeof b.token === "string" ? b.token : "";
  if (b.op === "login") {
    const email = String(b.email || "").trim().toLowerCase();
    const r = await sbj("/auth/v1/token?grant_type=password", { method: "POST", headers: hdr(), body: JSON.stringify({ email, password: String(b.password || "") }) });
    if (r.status === 429) return json({ error: "rate_limit" }, 429);
    if (!r.ok) return json({ error: "bad_credentials" }, 401);
    const m = await me(r.j.access_token); if (!m) { await fetch(SB + "/auth/v1/logout", { method: "POST", headers: hdr(r.j.access_token) }); return json({ error: "no_access" }, 403); }
    await audit(m.id, "login", { ua: (req.headers.get("user-agent") || "").slice(0, 120) });
    return json({ ok: true, session: sess(r.j), me: m });
  }
  if (b.op === "refresh") {
    const r = await sbj("/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: hdr(), body: JSON.stringify({ refresh_token: String(b.refresh_token || "") }) });
    if (!r.ok) return json({ error: "expired" }, 401); const m = await me(r.j.access_token); if (!m) return json({ error: "no_access" }, 403);
    return json({ ok: true, session: sess(r.j), me: m });
  }
  if (b.op === "cron") {
    if (!CRON_KEY || req.headers.get("x-cron-key") !== CRON_KEY) return json({ error: "auth" }, 401);
    const due = await dbSel(`shield_sites?verified=eq.true&schedule=neq.off&select=*&order=last_scan_at.asc.nullsfirst&limit=30`);
    const now = Date.now(); let ran = 0;
    for (const s of due.j || []) {
      const gap = s.schedule === "weekly" ? 7 : 30; if (s.last_scan_at && now - Date.parse(s.last_scan_at) < gap * 864e5 - 36e5) continue;
      const prof = await dbSel(`shield_profiles?user_id=eq.${s.owner}&active=eq.true&select=user_id`); if (!prof.j?.length) continue;
      const v = await checkVerification(s); if (!v.ok) { await dbPatch(`shield_sites?id=eq.${s.id}`, { verified: false }); await audit(s.owner, "scheduled_scan_skipped", { domain: s.domain, reason: "verification_lost" }); continue; }
      const r = await runScanFor(s.owner, s); await audit(s.owner, "scheduled_scan", { domain: s.domain, scan: r.id, score: r.score, grade: r.grade }); ran++;
      if (ran >= 2) break;
    }
    return json({ ok: true, ran });
  }
  const m = await me(tok); if (!m) return json({ error: "auth" }, 401);
  switch (b.op) {
    case "me": return json({ ok: true, me: m });
    case "logout": await audit(m.id, "logout"); await fetch(SB + "/auth/v1/logout", { method: "POST", headers: hdr(tok) }); return json({ ok: true });
    case "sites": {
      const r = await sbj(`/rest/v1/shield_sites?select=*&order=created_at`, { headers: hdr(tok) });
      const sc = await sbj(`/rest/v1/shield_scans?select=id,site_id,score,grade,started_at,status,categories&status=eq.done&order=started_at.desc&limit=500`, { headers: hdr(tok) });
      return json({ ok: true, sites: r.j || [], scans: sc.j || [] });
    }
    case "site_add": {
      const n = normSite(b.url); if (!n) return json({ error: "bad_domain" }, 400);
      const cnt = await dbSel(`shield_sites?owner=eq.${m.id}&select=id`); if ((cnt.j || []).length >= (m.role === "member" ? 5 : 50)) return json({ error: "limit" }, 400);
      if (!(await publicHost(n.domain))) return json({ error: "dns_not_found" }, 400);
      const r = await dbIns("shield_sites", { owner: m.id, domain: n.domain, base_path: n.base_path, label: String(b.label || "").slice(0, 60) || null });
      if (!r.ok) return json({ error: r.status === 409 ? "exists" : "failed" }, 400);
      await audit(m.id, "site_add", { domain: n.domain, path: n.base_path }); return json({ ok: true, site: r.j[0] });
    }
    case "site_verify": {
      const s = await pickSite(m.id, b.site_id); if (!s) return json({ error: "not_found" }, 404);
      const v = await checkVerification(s); await audit(m.id, v.ok ? "site_verified" : "verify_failed", { domain: s.domain, method: v.method });
      if (!v.ok) { if (s.verified) await dbPatch(`shield_sites?id=eq.${s.id}`, { verified: false }); return json({ ok: false, error: "not_verified" }); }
      const r = await dbPatch(`shield_sites?id=eq.${s.id}`, { verified: true, verify_method: v.method, verified_at: new Date().toISOString() }); return json({ ok: true, site: r.j?.[0] });
    }
    case "site_update": {
      const s = await pickSite(m.id, b.site_id); if (!s) return json({ error: "not_found" }, 404);
      const patch: any = {}; if (["off", "weekly", "monthly"].includes(b.schedule)) patch.schedule = b.schedule; if (typeof b.label === "string") patch.label = b.label.slice(0, 60);
      const r = await dbPatch(`shield_sites?id=eq.${s.id}`, patch); await audit(m.id, "site_update", { domain: s.domain, ...patch }); return json({ ok: true, site: r.j?.[0] });
    }
    case "site_delete": {
      const s = await pickSite(m.id, b.site_id); if (!s) return json({ error: "not_found" }, 404);
      await dbDel(`shield_sites?id=eq.${s.id}`); await audit(m.id, "site_delete", { domain: s.domain }); return json({ ok: true });
    }
    case "scan": {
      const s = await pickSite(m.id, b.site_id); if (!s) return json({ error: "not_found" }, 404);
      if (!s.verified) { await audit(m.id, "scan_refused", { domain: s.domain, reason: "not_verified" }); return json({ error: "not_verified" }, 403); }
      const v = await checkVerification(s); if (!v.ok) { await dbPatch(`shield_sites?id=eq.${s.id}`, { verified: false }); await audit(m.id, "scan_refused", { domain: s.domain, reason: "verification_lost" }); return json({ error: "verification_lost" }, 403); }
      const since = new Date(Date.now() - 3600e3).toISOString();
      const recent = await dbSel(`shield_scans?owner=eq.${m.id}&started_at=gt.${since}&select=id,site_id,started_at,status`);
      if ((recent.j || []).length >= (m.role === "member" ? 6 : 20)) return json({ error: "rate_limit_hour" }, 429);
      if ((recent.j || []).some((x: any) => x.site_id === s.id && (Date.now() - Date.parse(x.started_at) < 45e3 || (x.status === "running" && Date.now() - Date.parse(x.started_at) < 150e3)))) return json({ error: "too_soon" }, 429);
      const r = await runScanFor(m.id, s); await audit(m.id, "scan", { domain: s.domain, scan: r.id, score: r.score, grade: r.grade });
      return json({ ok: true, scan_id: r.id, score: r.score, grade: r.grade });
    }
    case "scan_get": {
      if (!uuidOk(b.scan_id)) return json({ error: "not_found" }, 404);
      const r = await sbj(`/rest/v1/shield_scans?id=eq.${b.scan_id}&select=*`, { headers: hdr(tok) });
      const s = r.j?.[0]; if (!s) return json({ error: "not_found" }, 404); return json({ ok: true, scan: s });
    }
    case "scan_list": {
      if (!uuidOk(b.site_id)) return json({ ok: true, scans: [] });
      const r = await sbj(`/rest/v1/shield_scans?site_id=eq.${b.site_id}&select=id,score,grade,status,started_at,finished_at,categories&order=started_at.desc&limit=100`, { headers: hdr(tok) });
      return json({ ok: true, scans: r.j || [] });
    }
    case "scan_delete": {
      if (!uuidOk(b.scan_id)) return json({ error: "not_found" }, 404);
      const r = await dbSel(`shield_scans?id=eq.${b.scan_id}&owner=eq.${m.id}&select=id`); if (!r.j?.length) return json({ error: "not_found" }, 404);
      await dbDel(`shield_scans?id=eq.${r.j[0].id}`); await audit(m.id, "scan_delete", { scan: r.j[0].id }); return json({ ok: true });
    }
    case "scan_ai": {
      if (!KEY) return json({ error: "no_key" }, 500); if (!uuidOk(b.scan_id)) return json({ error: "not_found" }, 404);
      const r = await dbSel(`shield_scans?id=eq.${b.scan_id}&owner=eq.${m.id}&select=*`); const s = r.j?.[0]; if (!s) return json({ error: "not_found" }, 404);
      if (s.ai && !b.force) return json({ ok: true, ai: s.ai });
      const site = await pickSite(m.id, s.site_id);
      const issues = (s.findings || []).filter((f: Finding) => f.sev !== "pass").map((f: Finding) => ({ id: f.id, cat: f.cat, sev: f.sev, title: f.t_en, detail: f.d_en, evidence: f.ev }));
      const prompt = `Site: ${site?.domain}${site?.base_path}. Platform: ${s.meta?.platform}; CDN: ${s.meta?.cdn || "none"}. Score ${s.score}/100 grade ${s.grade}.
Passed checks: ${(s.findings || []).filter((f: Finding) => f.sev === "pass").map((f: Finding) => f.t_en).join("; ")}
Issues (JSON): ${JSON.stringify(issues).slice(0, 30000)}
Return JSON only:
{"summary_ar":"3-4 sentences overall assessment in simple Arabic","summary_en":"same in English","verdict_ar":"one short line","verdict_en":"one short line","top_risk_ar":"the single most important thing to fix and why",
"findings":{"<issue id>":{"explain_ar":"what it means, simple Arabic, 1-3 sentences","explain_en":"1-2 sentences","impact_ar":"realistic impact if ignored","fix_ar":["step 1","step 2"],"fix_en":["step 1"],"snippets":[{"platform":"nginx|apache|cloudflare|github_pages|shopify|dns|html","code":"exact config"}]}},
"plan":[{"order":1,"title_ar":"","title_en":"","why_ar":"","effort":"low|medium|high","finding_ids":["..."]}]}
Rules: include EVERY issue id given. Snippets must be correct and copy-pasteable (Nginx add_header ... always; Apache Header always set ...; Cloudflare: Rules > Transform Rules > Modify Response Header steps or Worker; DNS as zone-file records). Prioritise the detected platform (${s.meta?.platform}). For github_pages: custom HTTP headers are NOT supported — say so and offer Cloudflare in front, or <meta http-equiv> where valid (CSP and referrer work via meta; HSTS, X-Frame-Options, frame-ancestors, Permissions-Policy do not). For shopify: merchants cannot set most response headers; say what is possible (DNS, apps, theme code) honestly. Info-level items: short explanation, can say "optional". Plan: 3-7 prioritised steps.`;
      const out: any = await gen(AI_BASE, [{ role: "user", parts: [{ text: prompt }] }], true, 20000);
      if (out.error) return json({ error: out.error }, 502);
      const ai = { ...out.data, model: out.model, at: new Date().toISOString() };
      await dbPatch(`shield_scans?id=eq.${s.id}`, { ai }); await audit(m.id, "ai_report", { scan: s.id });
      return json({ ok: true, ai });
    }
    case "chat": {
      if (!KEY) return json({ error: "no_key" }, 500);
      let ctx = "";
      if (uuidOk(b.scan_id)) { const r = await dbSel(`shield_scans?id=eq.${b.scan_id}&owner=eq.${m.id}&select=score,grade,findings,meta,site_id`); const s = r.j?.[0]; if (s) { const site = await pickSite(m.id, s.site_id); ctx = `Current report for ${site?.domain}${site?.base_path} (platform ${s.meta?.platform}): score ${s.score} ${s.grade}. Findings [severity, title, evidence]: ${JSON.stringify((s.findings || []).map((f: Finding) => [f.sev, f.t_en, f.ev || ""]))}`.slice(0, 24000); } }
      const hist = (Array.isArray(b.messages) ? b.messages : []).slice(-12).map((x: any) => ({ role: x.role === "model" ? "model" : "user", parts: [{ text: String(x.text || "").slice(0, 4000) }] }));
      if (!hist.length || hist[hist.length - 1].role !== "user") return json({ error: "bad_input" }, 400);
      const out: any = await gen(AI_BASE + " You are chatting with the site owner about their scan results. Answer in the user's language (default Arabic), concise, with fenced code blocks for configs. If asked to attack, exploit or scan sites they don't own, refuse politely.\n" + ctx, hist, false, 4000);
      if (out.error) return json({ error: out.error }, 502); await audit(m.id, "ai_chat", { scan: b.scan_id || null }); return json({ ok: true, text: out.text });
    }
    case "audit": {
      const r = await sbj(`/rest/v1/shield_audit?select=id,at,action,detail&order=id.desc&limit=300`, { headers: hdr(tok) }); return json({ ok: true, rows: r.j || [] });
    }
    case "profile_update": {
      const id = b.identity || {};
      const clean = { emails: [m.auth_email], handles: (Array.isArray(id.handles) ? id.handles : []).map((h: any) => String(h).replace(/^@/, "").trim().slice(0, 40)).filter(Boolean).slice(0, 8), github: String(id.github || "").replace(/[^\w-]/g, "").slice(0, 40), phone: String(id.phone || "").replace(/[^\d+ ]/g, "").slice(0, 20), name: String(id.name || "").slice(0, 80), brand: (Array.isArray(id.brand) ? id.brand : []).map((x: any) => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 8) };
      const prefs = { ...(m.prefs || {}), ...(b.prefs && typeof b.prefs === "object" ? { lang: b.prefs.lang === "en" ? "en" : "ar", theme: ["light", "dark", "auto"].includes(b.prefs.theme) ? b.prefs.theme : "auto" } : {}) };
      await dbPatch(`shield_profiles?user_id=eq.${m.id}`, { identity: clean, prefs }); await audit(m.id, "profile_update"); return json({ ok: true, identity: clean, prefs });
    }
    case "ip_text": {
      const text = String(b.text || "").slice(0, 60000); const urls: string[] = (Array.isArray(b.urls) ? b.urls : []).map(String).filter(Boolean).slice(0, 10);
      if (words(text).length < 12 || !urls.length) return json({ error: "bad_input" }, 400);
      const res = []; for (const u of urls) { const f: any = await safeFetchPage(u); if (f.err) { res.push({ url: u, error: f.err }); continue; } const o = overlap(text, strip(f.r.text)); res.push({ url: u, status: f.r.status, contain: Math.round(o.contain * 1000) / 10, jaccard: Math.round(o.jaccard * 1000) / 10, samples: o.matches }); await sleep(150); }
      await dbIns("shield_ip_checks", { owner: m.id, kind: "text", input: { chars: text.length, urls }, result: res }); await audit(m.id, "ip_text", { urls: urls.length });
      return json({ ok: true, results: res });
    }
    case "ip_clone": {
      const s = await pickSite(m.id, b.site_id); if (!s || !s.verified) return json({ error: "not_verified" }, 403);
      const mine = await get(`https://${s.domain}${s.base_path}`, { max: 2_000_000 }); const myText = strip(mine.text);
      const urls: string[] = (Array.isArray(b.urls) ? b.urls : []).map(String).filter(Boolean).slice(0, 8); if (!urls.length) return json({ error: "bad_input" }, 400);
      const myTitle = mine.text.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() || ""; const res = [];
      for (const u of urls) { const f: any = await safeFetchPage(u); if (f.err) { res.push({ url: u, error: f.err }); continue; } const o = overlap(myText, strip(f.r.text)); const t = f.r.text.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() || ""; const refs = (f.r.text.match(new RegExp(s.domain.replace(/\./g, "\\."), "g")) || []).length; res.push({ url: u, status: f.r.status, contain: Math.round(o.contain * 1000) / 10, same_title: !!myTitle && t === myTitle, title: t.slice(0, 120), refs_to_you: refs, samples: o.matches.slice(0, 3) }); }
      await dbIns("shield_ip_checks", { owner: m.id, kind: "clone", input: { site: s.domain, urls }, result: res }); await audit(m.id, "ip_clone", { site: s.domain, urls: urls.length });
      return json({ ok: true, results: res });
    }
    case "ip_image": {
      const ref = String(b.ref || ""); const urls: string[] = (Array.isArray(b.urls) ? b.urls : []).map(String).filter(Boolean).slice(0, 12);
      if (!ref || !urls.length) return json({ error: "bad_input" }, 400);
      const h0 = await dhash(ref); if (typeof h0 !== "string") return json({ error: "ref_" + h0.err }, 400);
      const res = []; for (const u of urls) { const h = await dhash(u); res.push(typeof h === "string" ? { url: u, hash: h, distance: ham(h0, h), similar: ham(h0, h) <= 10 } : { url: u, error: h.err }); }
      await dbIns("shield_ip_checks", { owner: m.id, kind: "image", input: { ref, urls }, result: { ref_hash: h0, res } }); await audit(m.id, "ip_image", { urls: urls.length });
      return json({ ok: true, ref_hash: h0, results: res });
    }
    case "ip_typo": {
      const s = await pickSite(m.id, b.site_id); if (!s || !s.verified) return json({ error: "not_verified" }, 403); if (isShared(s.domain)) return json({ error: "not_applicable" }, 400);
      const base = apexOf(s.domain); const vars = typoVariants(base); const hits: any[] = [];
      for (let i = 0; i < vars.length; i += 15) {
        await Promise.all(vars.slice(i, i + 15).map(async (d) => {
          const [a, ns] = await Promise.all([doh(d, "A"), doh(d, "NS")]);
          const ips = a.ans.filter((x) => x.type === 1).map((x) => x.data); const nss = ns.ans.filter((x) => x.type === 2).map((x) => x.data);
          if (ips.length || nss.length) hits.push({ domain: d, ips: ips.slice(0, 3), ns: nss.slice(0, 2) });
        }));
      }
      const brand = base.split(".")[0];
      await Promise.all(hits.slice(0, 30).map(async (h) => { const mx = await doh(h.domain, "MX"); h.mx = mx.ans.some((x) => x.type === 15); if (!h.ips.length) return; const r = await get("https://" + h.domain, { max: 150000, timeout: 7000 }); h.status = r.status || null; h.title = (r.text.match(/<title[^>]*>([^<]*)/i)?.[1] || "").trim().slice(0, 100); const tx = strip(r.text).slice(0, 60000); h.mentions_brand = new RegExp(brand, "i").test(tx); h.parked = /parked|for sale|buy this domain|domain is for sale|sedo|dan\.com|afternic|hugedomains/i.test(r.text.slice(0, 60000)); }));
      hits.sort((a, b) => (Number(!!b.mentions_brand) * 2 + Number(!!b.mx)) - (Number(!!a.mentions_brand) * 2 + Number(!!a.mx)));
      const res = { domain: base, checked: vars.length, registered: hits };
      await dbIns("shield_ip_checks", { owner: m.id, kind: "typo", input: { domain: base }, result: res }); await audit(m.id, "ip_typo", { domain: base, registered: hits.length });
      return json({ ok: true, ...res });
    }
    case "ip_ai": {
      if (!KEY) return json({ error: "no_key" }, 500);
      const kind = b.kind === "takedown" ? "takedown" : "summary"; const data = JSON.stringify(b.data || {}).slice(0, 20000);
      const owner = `${m.identity?.name || m.name || ""} — ${(m.identity?.brand || []).join(", ")} — contact ${m.auth_email}`;
      const prompt = kind === "takedown"
        ? `Draft a professional takedown / copyright infringement notice for the rights holder to REVIEW (it will NOT be sent automatically). Rights holder: ${owner}. Evidence (from our comparison tools): ${data}. Notes from owner: ${String(b.note || "").slice(0, 1500)}.
Return JSON: {"subject_ar":"","body_ar":"formal Arabic notice","subject_en":"","body_en":"DMCA-style English notice incl. good-faith and accuracy statements, placeholders like [signature] [address] where unknown","send_to_hint_ar":"where such notices are usually sent (hosting abuse contact via WHOIS/RDAP, registrar, platform report form) — generic guidance, never invent addresses","legal_basis_ar":"cite UAE Federal Decree-Law No. 38 of 2021 on Copyright and Neighbouring Rights (Art. 2 protected works, Art. 4(2) protection without registration, Art. 35 court orders, Art. 39 penalties) only; state it is not legal advice"}`
        : `Summarise these intellectual-property monitoring results for the owner (${owner}) in simple Arabic: what looks like real copying/misuse vs. noise, confidence, and next steps. Data: ${data}. Return JSON {"summary_ar":"","items":[{"target":"","assessment_ar":"","confidence":"low|medium|high","next_ar":""}],"next_steps_ar":[""]}`;
      const out: any = await gen(AI_BASE + " Do not invent evidence; base everything on the data. Mark uncertainty.", [{ role: "user", parts: [{ text: prompt }] }], true, 7000);
      if (out.error) return json({ error: out.error }, 502); await audit(m.id, "ip_ai", { kind }); return json({ ok: true, data: out.data });
    }
    case "ip_history": {
      const r = await sbj(`/rest/v1/shield_ip_checks?select=id,kind,input,result,created_at&order=created_at.desc&limit=50`, { headers: hdr(tok) }); return json({ ok: true, rows: r.j || [] });
    }
    case "privacy_ai": {
      if (!KEY) return json({ error: "no_key" }, 500);
      const prompt = `Owner identity (self, verified login email ${m.auth_email}; handles ${(m.identity?.handles || []).join(", ")}). Results of self-checks (items marked unavailable could not be checked — do not guess about them): ${JSON.stringify(b.results || {}).slice(0, 15000)}.
Return JSON {"summary_ar":"","risk":"low|medium|high","actions":[{"priority":1,"title_ar":"","steps_ar":[""],"why_ar":""}],"unavailable_note_ar":"what could not be checked and how to check it manually"}. Label generic hygiene (2FA, password manager, rotating any exposed tokens) as general advice.`;
      const out: any = await gen(AI_BASE + " You are a privacy advisor. Never claim a breach or exposure exists unless the data says so.", [{ role: "user", parts: [{ text: prompt }] }], true, 5000);
      if (out.error) return json({ error: out.error }, 502); await audit(m.id, "privacy_ai"); return json({ ok: true, data: out.data });
    }
    case "privacy_log": { await audit(m.id, "privacy_check", { kind: String(b.kind || "").slice(0, 30), summary: String(b.summary || "").slice(0, 200) }); return json({ ok: true }); }
  }
  return json({ error: "bad_op" }, 400);
}

Deno.serve(async (req) => {
  CORS = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try { const b = await req.json(); return await op(b, req); }
  catch (e) { console.error(e); return json({ error: "server" }, 500); }
});
