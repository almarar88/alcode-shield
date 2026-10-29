import { S, L, $, $$, esc, ic, api, rawLogin, saveSess, setBoot, applyPrefs, ERR, toast, refresh } from "./core.js";
import * as V from "./views.js";
import * as M from "./mods.js";
const root = $("#root");
const NAV = [["", "layout-dashboard", "لوحة التحكم", "Dashboard"], ["sites", "world", "المواقع", "Sites"], ["history", "history", "السجل", "History"],
  null, ["ip", "copyright", "حماية الملكية", "IP protection"], ["privacy", "user-shield", "بياناتي الشخصية", "My data exposure"], ["guide", "scale", "دليل حقوق المؤلف", "UAE copyright guide"],
  null, ["headers", "tool", "مولّد الترويسات", "Header builder"], ["audit", "list-details", "سجل التدقيق", "Audit log"], ["settings", "settings", "الإعدادات", "Settings"]];
const BNAV = [["", "layout-dashboard", "الرئيسية", "Home"], ["sites", "world", "المواقع", "Sites"], ["ip", "copyright", "الملكية", "IP"], ["privacy", "user-shield", "بياناتي", "Privacy"], ["menu", "menu-2", "المزيد", "More"]];
function loginView(msg = "") {
  root.innerHTML = `<div class="login"><div class="box card">
  <div class="shieldanim"><img src="icons/logo.svg" alt=""></div>
  <h1>${L("درع الكود", "Alcode Shield")}</h1><p class="mu sm" style="margin-top:-4px">${L("منصة خاصة لفحص أمان مواقعك وحماية ملكيتك الفكرية وبياناتك", "Private platform for website security, IP and data-exposure checks")}</p>
  <form id="lf" style="text-align:start">
   <label class="l" for="em">${L("البريد الإلكتروني", "Email")}</label><input class="in ltr" id="em" type="email" autocomplete="username" required>
   <label class="l" for="pw">${L("كلمة المرور", "Password")}</label><input class="in ltr" id="pw" type="password" autocomplete="current-password" required>
   <div id="lm" class="sm" style="color:var(--cr);min-height:22px;margin-top:8px">${esc(msg)}</div>
   <button class="btn pri" style="width:100%;justify-content:center" id="lb">${ic("lock")} ${L("دخول", "Sign in")}</button></form>
  <div class="terms">${ic("info-circle", "sm")} ${L("الدخول مقصور على الحسابات المصرّح لها. المنصة تفحص فقط المواقع التي يثبت صاحب الحساب ملكيتها، بفحوصات سلبية خفيفة (بدون استغلال أو تخمين أو هجمات حجب). باستخدامك المنصة توافق على ذلك.", "Access is limited to authorised accounts. Only sites whose ownership is verified are scanned, using passive, light checks (no exploitation, brute force or DoS). By using the platform you accept this.")}</div>
  <div class="row" style="justify-content:center;margin-top:12px"><button class="btn sm ghost" id="lg">${ic("language", "sm")} ${S.lang === "ar" ? "English" : "العربية"}</button></div>
  </div></div>`;
  $("#lg").onclick = () => { S.lang = S.lang === "ar" ? "en" : "ar"; localStorage.setItem("sh_lang", S.lang); applyPrefs(); loginView(); };
  $("#lf").onsubmit = async (e) => { e.preventDefault(); const b = $("#lb"); b.disabled = true; b.innerHTML = ic("loader-2", "spin") + " " + L("جارٍ الدخول…", "Signing in…");
    try { const { j } = await rawLogin($("#em").value.trim(), $("#pw").value); if (!j.ok) return loginView(ERR(j.error)); saveSess(j.session); S.me = j.me; location.hash = "#/"; shell(); } catch { loginView(ERR("network")); } };
}
function navHtml(items, cls) { const cur = (location.hash.slice(2).split("/")[0]) || ""; return items.map((n) => n ? `<a class="${cls} ${cur === n[0] || (n[0] === "sites" && ["site", "scan", "compare"].includes(cur)) ? "on" : ""}" href="#/${n[0]}" data-k="${n[0]}">${ic(n[1])}<span>${L(n[2], n[3])}</span></a>` : `<div class="navsep"></div>`).join(""); }
function shell() {
  root.innerHTML = `<div class="app"><aside class="side"><div class="brand"><img src="icons/logo.svg" alt=""><div><b>${L("درع الكود", "Alcode Shield")}</b><span>${L("مؤسسة الكود", "Alcode")}</span></div></div><nav id="sn"></nav><div class="sp"></div>
  <div class="row" style="padding:8px"><button class="btn sm ghost" id="tl" title="language">${ic("language", "sm")}</button><button class="btn sm ghost" id="tt" title="theme">${ic(S.theme === "dark" ? "sun" : "moon", "sm")}</button><span class="sp"></span><button class="btn sm ghost dan" id="lo" title="logout">${ic("logout", "sm")}</button></div>
  <div class="xs mu ltr" style="padding:0 10px;overflow-wrap:anywhere">${esc(S.me?.auth_email || "")}</div></aside>
  <div><header class="mtop"><img src="icons/logo.svg" alt=""><b>${L("درع الكود", "Alcode Shield")}</b><span class="sp"></span><button class="btn sm ghost" id="tl2">${ic("language", "sm")}</button><button class="btn sm ghost" id="tt2">${ic(S.theme === "dark" ? "sun" : "moon", "sm")}</button></header>
  <main class="main" id="view"></main></div></div><nav class="bnav" id="bn"></nav>
  <div class="drawer" id="dr"><div class="bk"></div><div class="pn"><div class="brand"><img src="icons/logo.svg" alt=""><div><b>${L("درع الكود", "Alcode Shield")}</b></div></div><div id="dn"></div><button class="btn ghost dan" id="lo2" style="margin:12px">${ic("logout")} ${L("خروج", "Sign out")}</button></div></div>`;
  const lang = () => { S.lang = S.lang === "ar" ? "en" : "ar"; localStorage.setItem("sh_lang", S.lang); applyPrefs(); shell(); };
  const theme = () => { S.theme = S.theme === "dark" ? "light" : "dark"; localStorage.setItem("sh_theme", S.theme); applyPrefs(); shell(); };
  const out = async () => { try { await api("logout"); } catch {} saveSess(null); S.me = null; location.hash = ""; loginView(); };
  $("#tl").onclick = $("#tl2").onclick = lang; $("#tt").onclick = $("#tt2").onclick = theme; $("#lo").onclick = $("#lo2").onclick = out;
  $("#dr .bk").onclick = () => $("#dr").classList.remove("open");
  route();
}
async function route() {
  if (!S.sess) return loginView();
  const [k, ...a] = location.hash.slice(2).split("/");
  $("#sn").innerHTML = navHtml(NAV, "nav"); $("#dn").innerHTML = navHtml(NAV, "nav"); $("#bn").innerHTML = navHtml(BNAV, "");
  $$("#bn a[data-k=menu]").forEach((x) => (x.onclick = (e) => { e.preventDefault(); $("#dr").classList.add("open"); }));
  $("#dr").classList.remove("open"); $(".chat")?.remove(); $(".fab")?.remove();
  const v = $("#view"); v.innerHTML = `<div class="grid g3"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>`; window.scrollTo(0, 0);
  const R = { "": V.dashboard, sites: V.sites, site: V.site, scan: V.scan, compare: V.compare, history: V.history, audit: V.audit, settings: V.settings, headers: M.headers, ip: M.ip, privacy: M.privacy, guide: M.guide };
  try { await (R[k] || V.dashboard)(v, ...a); } catch (e) { if (e.message !== "auth") v.innerHTML = `<div class="card empty">${ic("alert-triangle")}<p>${esc(ERR(e))}</p><button class="btn" onclick="location.reload()">${ic("refresh")} ${L("إعادة المحاولة", "Retry")}</button></div>`; }
}
async function start() {
  applyPrefs();
  setBoot(() => { saveSess(null); loginView(L("انتهت الجلسة، سجّل الدخول مجدداً", "Session ended, sign in again")); });
  if (!S.sess) return loginView();
  root.innerHTML = `<div class="login"><div class="shieldanim"><img src="icons/logo.svg" alt=""></div></div>`;
  try { const j = await api("me"); S.me = j.me; shell(); } catch (e) { if (e.message !== "auth") { if (await refresh()) shell(); else loginView(); } }
}
addEventListener("hashchange", () => { if (S.sess && $("#view")) route(); });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
start();
