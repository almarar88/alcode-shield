import { ic } from "./icons.js";
export const FN = "https://olkhmscftouksbgjmtjt.supabase.co/functions/v1/shield";
export const S = { lang: localStorage.getItem("sh_lang") || "ar", theme: localStorage.getItem("sh_theme") || "dark", sess: null, me: null, sites: [], scans: [] };
try { S.sess = JSON.parse(localStorage.getItem("sh_sess") || "null"); } catch { S.sess = null; }
export const L = (ar, en) => (S.lang === "en" ? (en ?? ar) : ar);
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export { ic };
export function applyPrefs() {
  document.documentElement.lang = S.lang; document.documentElement.dir = S.lang === "ar" ? "rtl" : "ltr";
  document.documentElement.dataset.theme = S.theme;
}
export function saveSess(s) { S.sess = s; if (s) localStorage.setItem("sh_sess", JSON.stringify(s)); else localStorage.removeItem("sh_sess"); }
let refreshing = null;
async function raw(body) {
  const r = await fetch(FN, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { j = { error: "network" }; }
  return { status: r.status, j };
}
export async function refresh() {
  if (!S.sess?.refresh_token) return false;
  refreshing ||= raw({ op: "refresh", refresh_token: S.sess.refresh_token }).then(({ j }) => { refreshing = null; if (j.ok) { saveSess(j.session); S.me = j.me; return true; } saveSess(null); return false; });
  return refreshing;
}
export async function api(op, data = {}) {
  if (!S.sess) throw new Error("auth");
  if (S.sess.expires_at && Date.now() / 1000 > S.sess.expires_at - 60) { if (!(await refresh())) { location.hash = ""; boot(); throw new Error("auth"); } }
  let { status, j } = await raw({ op, token: S.sess.access_token, ...data });
  if (status === 401 && j.error === "auth") { if (await refresh()) ({ status, j } = await raw({ op, token: S.sess.access_token, ...data })); else { boot(); throw new Error("auth"); } }
  if (j.error) { const e = new Error(j.error); e.data = j; e.status = status; throw e; }
  return j;
}
export async function rawLogin(email, password) { return raw({ op: "login", email, password }); }
export let boot = () => {}; export function setBoot(f) { boot = f; }
export const ERR = (e) => {
  const k = typeof e === "string" ? e : e?.message;
  const m = { bad_credentials: ["بيانات الدخول غير صحيحة", "Wrong email or password"], no_access: ["هذا الحساب غير مخوّل لاستخدام المنصة", "This account has no access"], rate_limit: ["محاولات كثيرة، انتظر قليلاً", "Too many attempts, wait a bit"],
    not_verified: ["النطاق غير موثّق — لن نفحص إلا المواقع التي تثبت ملكيتها", "Domain not verified — we only scan sites you prove you own"], verification_lost: ["لم يعد التوثيق موجوداً — أعد التحقق", "Verification record no longer found — re-verify"],
    rate_limit_hour: ["بلغت حد الفحوصات في الساعة", "Hourly scan limit reached"], too_soon: ["فحص هذا الموقع جرى للتو، انتظر دقيقة", "This site was just scanned, wait a minute"],
    bad_domain: ["عنوان غير صالح (لا نقبل عناوين IP أو الشبكات الخاصة)", "Invalid address (IPs/private hosts not allowed)"], dns_not_found: ["النطاق لا يملك سجلات DNS عامة", "Domain has no public DNS"], exists: ["الموقع مضاف مسبقاً", "Site already added"], limit: ["بلغت الحد الأقصى للمواقع", "Site limit reached"],
    no_key: ["الذكاء الاصطناعي غير مهيأ", "AI not configured"], ai_failed: ["تعذّر رد الذكاء الاصطناعي، حاول مجدداً", "AI failed, try again"], bad_input: ["مدخلات ناقصة أو غير صالحة", "Missing or invalid input"], not_applicable: ["غير متاح لهذا النوع من النطاقات", "Not applicable for this domain"],
    network: ["تعذّر الاتصال بالخادم", "Network error"], auth: ["انتهت الجلسة", "Session ended"], server: ["خطأ في الخادم", "Server error"] };
  const v = m[k] || (/^ai|gemini|quota/i.test(k || "") ? m.ai_failed : null);
  return v ? L(v[0], v[1]) : L("حدث خطأ: ", "Error: ") + (k || "");
};
export function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.append(d); setTimeout(() => d.remove(), 3200); }
export const SEV = { critical: ["حرج", "Critical"], high: ["عالٍ", "High"], medium: ["متوسط", "Medium"], low: ["منخفض", "Low"], info: ["معلومة", "Info"], pass: ["سليم", "Pass"] };
export const SEVORD = { critical: 0, high: 1, medium: 2, low: 3, info: 4, pass: 5 };
export const sevPill = (s) => `<span class="pill s-${s}">${L(...SEV[s])}</span>`;
export const CATN = { tls: ["شهادة TLS", "TLS certificate", "certificate"], transport: ["النقل الآمن", "Transport", "arrows-right-left"], headers: ["ترويسات الأمان", "Security headers", "shield-half"], cookies: ["الكوكيز", "Cookies", "cookie"], dns: ["DNS", "DNS", "server-2"], email: ["أمان البريد", "Email security", "mail"], exposure: ["ملفات مكشوفة", "Exposed files", "file-alert"], software: ["المكتبات والثغرات", "Libraries & CVEs", "package"], content: ["المحتوى والأسرار", "Content & secrets", "code"] };
export const gradeColor = (g) => ({ "A+": "#4fbf8a", A: "#6fcf97", B: "#d9b26a", C: "#e3b341", D: "#ef7b45", F: "#e5484d" }[g] || "var(--gold)");
export const ring = (score, grade, cls = "") => `<div class="ring ${cls}" style="--c:${gradeColor(grade)}" data-v="${score ?? 0}"><div><div class="g">${esc(grade || "—")}</div><div class="s">${score ?? "—"}/100</div></div></div>`;
export function animate(root = document) { requestAnimationFrame(() => { $$(".ring[data-v]", root).forEach((r) => r.style.setProperty("--v", r.dataset.v)); $$(".bar i[data-w]", root).forEach((b) => (b.style.width = b.dataset.w + "%")); }); }
export const fmtDate = (d) => d ? new Date(d).toLocaleString(S.lang === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" }) : "—";
export const siteName = (s) => s ? s.domain + (s.base_path && s.base_path !== "/" ? s.base_path : "") : "";
export function copyBtns(root) { $$("pre.code", root).forEach((p) => { if (p.querySelector(".cp")) return; const b = document.createElement("button"); b.className = "btn sm ghost cp noprint"; b.style.cssText = "position:absolute;top:6px;right:6px;min-height:28px"; b.innerHTML = ic("copy", "sm"); b.onclick = () => { navigator.clipboard.writeText(p.dataset.c ?? p.innerText); toast(L("تم النسخ", "Copied")); }; p.append(b); }); }
export function md(t) { // tiny safe markdown: code fences, bold, inline code, lists
  const parts = String(t || "").split(/```(\w*)\n?([\s\S]*?)```/g); let o = "";
  for (let i = 0; i < parts.length; i++) { if (i % 3 === 1) continue; if (i % 3 === 2) { o += `<pre class="code" data-c="${esc(parts[i])}">${esc(parts[i])}</pre>`; continue; }
    o += esc(parts[i]).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, '<code class="mono">$1</code>'); }
  return o;
}
export function download(name, text, type = "text/plain") { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
