import { S, L, $, $$, esc, ic, api, ERR, toast, sevPill, SEV, SEVORD, CATN, ring, animate, fmtDate, siteName, copyBtns, md, download, gradeColor } from "./core.js";
async function loadSites() { const j = await api("sites"); S.sites = j.sites; S.scans = j.scans; return j; }
const top = (title, sub = "", actions = "") => `<div class="top"><div><h1>${title}</h1>${sub ? `<div class="mu sm">${sub}</div>` : ""}</div><span class="sp"></span>${actions}</div>`;
function trendSvg(series, h = 120) {
  const pts = series.filter((x) => x.score != null); if (pts.length < 2) return `<div class="mu sm" style="padding:30px 0;text-align:center">${L("يظهر منحنى التطور بعد فحصين أو أكثر", "Trend appears after two or more scans")}</div>`;
  const W = 600, n = pts.length, X = (i) => 10 + (i * (W - 20)) / (n - 1), Y = (v) => h - 10 - ((v / 100) * (h - 20));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.score).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" role="img" aria-label="trend"><defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9b26a" stop-opacity=".35"/><stop offset="1" stop-color="#d9b26a" stop-opacity="0"/></linearGradient></defs>
  ${[25, 50, 75].map((v) => `<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="currentColor" opacity=".08"/>`).join("")}
  <path d="${d} L${X(n - 1)},${h} L${X(0)},${h} Z" fill="url(#tg)"/><path d="${d}" fill="none" stroke="#d9b26a" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
  ${pts.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.score)}" r="3.5" fill="${gradeColor(p.grade)}" vector-effect="non-scaling-stroke"><title>${p.score} ${p.grade} · ${fmtDate(p.started_at)}</title></circle>`).join("")}</svg>`;
}
export async function scanNow(site, btn) {
  const v = $("#view"); const steps = [["certificate", "شهادة TLS والبروتوكولات", "TLS certificate & protocols"], ["arrows-right-left", "التحويل إلى HTTPS و HSTS", "HTTPS redirect & HSTS"], ["shield-half", "ترويسات الأمان والكوكيز", "Security headers & cookies"], ["server-2", "DNS وأمان البريد", "DNS & email security"], ["file-alert", "الملفات المكشوفة (طلبات GET خفيفة)", "Exposed files (light GETs)"], ["package", "مكتبات JavaScript مقابل قاعدة OSV", "JS libraries vs OSV"], ["code", "المحتوى المختلط والأسرار", "Mixed content & secrets"]];
  v.innerHTML = `<div class="card scanning"><div class="radar"></div><h2>${L("جارٍ فحص", "Scanning")} <span class="ltr">${esc(siteName(site))}</span></h2><p class="mu sm">${L("فحص سلبي خفيف — يستغرق عادة 10 إلى 30 ثانية", "Passive light scan — usually 10–30 seconds")}</p>
  <div class="steps">${steps.map((s, i) => `<div data-i="${i}">${ic(s[0], "sm")} ${L(s[1], s[2])}</div>`).join("")}</div></div>`;
  let i = 0; const t = setInterval(() => { const el = $$(".steps div"); if (!el.length) return clearInterval(t); el.forEach((e, k) => { e.className = k < i ? "ok" : k === i ? "on" : ""; }); if (i < steps.length - 1) i++; }, 2600);
  try { const j = await api("scan", { site_id: site.id }); clearInterval(t); location.hash = `#/scan/${j.scan_id}`; }
  catch (e) { clearInterval(t); toast(ERR(e)); location.hash = `#/site/${site.id}`; if (location.hash === `#/site/${site.id}`) site_(v, site.id); }
}
export async function dashboard(v) {
  await loadSites(); const sites = S.sites, scans = S.scans;
  const ver = sites.filter((s) => s.verified), scored = sites.filter((s) => s.last_score != null);
  const avg = scored.length ? Math.round(scored.reduce((a, s) => a + s.last_score, 0) / scored.length) : null;
  const g = avg == null ? "—" : avg >= 95 ? "A+" : avg >= 88 ? "A" : avg >= 78 ? "B" : avg >= 65 ? "C" : avg >= 50 ? "D" : "F";
  const series = [...scans].reverse(); const hour = new Date().getHours();
  const hi = L(hour < 12 ? "صباح الخير" : "مساء الخير", hour < 12 ? "Good morning" : "Good evening") + (S.me?.name ? "، " + esc(S.me.name) : "");
  v.innerHTML = top(hi, L("نظرة عامة على أمان مواقعك", "Your security at a glance"), `<a class="btn pri" href="#/sites">${ic("plus")} ${L("إضافة موقع", "Add site")}</a>`) + `
  <div class="grid g2"><div class="card"><div class="hero">${ring(avg, g)}<div style="flex:1;min-width:180px"><h2>${L("متوسط الأمان", "Average security")}</h2>
   <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px"><div><div class="mu xs">${L("المواقع", "Sites")}</div><b style="font-size:22px">${sites.length}</b></div><div><div class="mu xs">${L("موثّقة", "Verified")}</div><b style="font-size:22px">${ver.length}</b></div><div><div class="mu xs">${L("الفحوصات", "Scans")}</div><b style="font-size:22px">${scans.length}</b></div></div></div></div></div>
   <div class="card"><div class="row"><h2>${ic("trending-up")} ${L("تطور النتيجة", "Score trend")}</h2></div>${trendSvg(series)}</div></div>
  <h2 style="margin:24px 0 12px">${L("مواقعك", "Your sites")}</h2>
  <div class="grid g3">${sites.map((s, k) => `<div class="card" style="animation-delay:${k * 60}ms"><div class="site">${ring(s.last_score, s.last_grade, "sm")}<div class="meta"><div class="d ltr" style="text-align:start">${esc(siteName(s))}</div>
   <div class="xs mu">${s.verified ? `<span class="s-pass">${ic("circle-check", "sm")} ${L("موثّق", "Verified")}</span>` : `<span class="s-medium">${ic("alert-triangle", "sm")} ${L("بانتظار التوثيق", "Pending verification")}</span>`} · ${s.last_scan_at ? fmtDate(s.last_scan_at) : L("لم يُفحص بعد", "Never scanned")}</div></div></div>
   <div class="row" style="margin-top:14px"><a class="btn sm" href="#/site/${s.id}">${ic("file-report", "sm")} ${L("التفاصيل", "Details")}</a>${s.verified ? `<button class="btn sm pri" data-scan="${s.id}">${ic("radar-2", "sm")} ${L("افحص الآن", "Scan now")}</button>` : ""}</div></div>`).join("") || `<div class="card empty">${ic("world")}<p>${L("لا توجد مواقع بعد", "No sites yet")}</p></div>`}</div>
  <div class="grid g3" style="margin-top:24px">
   <a class="card" href="#/ip" style="text-decoration:none;color:inherit">${ic("copyright", "lg")}<h3 style="margin-top:8px">${L("حماية الملكية الفكرية", "IP protection")}</h3><div class="mu sm">${L("اكتشف نسخ نصوصك وصورك ومواقعك والنطاقات المشابهة", "Find copies of your text, images, site and lookalike domains")}</div></a>
   <a class="card" href="#/privacy" style="text-decoration:none;color:inherit">${ic("user-shield", "lg")}<h3 style="margin-top:8px">${L("انكشاف بياناتي", "My data exposure")}</h3><div class="mu sm">${L("كلمات مرور مسرّبة، أسرار في مستودعاتك، وخطة خصوصية", "Leaked passwords, repo secrets and a privacy plan")}</div></a>
   <a class="card" href="#/headers" style="text-decoration:none;color:inherit">${ic("tool", "lg")}<h3 style="margin-top:8px">${L("مولّد ترويسات الأمان", "Security header builder")}</h3><div class="mu sm">${L("إعدادات جاهزة لـ Nginx و Apache و Cloudflare", "Ready configs for Nginx, Apache, Cloudflare")}</div></a></div>`;
  $$("[data-scan]", v).forEach((b) => (b.onclick = () => scanNow(S.sites.find((s) => s.id === b.dataset.scan), b))); animate(v);
}
export async function sites(v) {
  await loadSites();
  v.innerHTML = top(L("المواقع", "Sites"), L("لا نفحص إلا المواقع التي تثبت ملكيتها", "Only sites with proven ownership are scanned")) + `
  <div class="card"><h2>${ic("plus")} ${L("إضافة موقع", "Add a site")}</h2><form id="af" class="row" style="align-items:end">
   <div style="flex:2;min-width:220px"><label class="l">${L("رابط الموقع أو النطاق", "Site URL or domain")}</label><input class="in ltr" id="au" placeholder="example.com" required></div>
   <div style="flex:1;min-width:150px"><label class="l">${L("اسم مختصر (اختياري)", "Label (optional)")}</label><input class="in" id="al" maxlength="60"></div>
   <button class="btn pri" id="ab">${ic("plus")} ${L("إضافة", "Add")}</button></form>
   <p class="xs mu" style="margin:10px 0 0">${L("بعد الإضافة ستحصل على رمز توثيق تضعه في سجل DNS أو ملف على موقعك.", "After adding you get a token to place in DNS or a file on your site.")}</p></div>
  <div class="grid g2" style="margin-top:16px">${S.sites.map((s) => siteCard(s)).join("")}</div>`;
  $("#af").onsubmit = async (e) => { e.preventDefault(); const b = $("#ab"); b.disabled = true; try { const j = await api("site_add", { url: $("#au").value.trim(), label: $("#al").value.trim() }); toast(L("أُضيف الموقع", "Site added")); location.hash = `#/site/${j.site.id}`; } catch (er) { toast(ERR(er)); b.disabled = false; } };
  animate(v);
}
const siteCard = (s) => `<a class="card" href="#/site/${s.id}" style="text-decoration:none;color:inherit"><div class="site">${ring(s.last_score, s.last_grade, "sm")}<div class="meta"><div class="d ltr" style="text-align:start">${esc(siteName(s))}</div><div class="xs mu">${esc(s.label || "")} ${s.verified ? `<span class="s-pass">· ${L("موثّق", "Verified")}</span>` : `<span class="s-medium">· ${L("غير موثّق", "Unverified")}</span>`} · ${L("الجدولة", "Schedule")}: ${L({ off: "متوقفة", weekly: "أسبوعياً", monthly: "شهرياً" }[s.schedule], s.schedule)}</div></div>${ic("chevron-left")}</div></a>`;
const METH = { dns: ["سجل DNS", "DNS record"], file: ["ملف التحقق", "Verification file"], owner_attested: ["إقرار المالك (مسبق)", "Owner attested (pre-verified)"], github_account: ["حساب GitHub المملوك", "Owned GitHub account"] };
export async function site(v, id) { return site_(v, id); }
async function site_(v, id) {
  await loadSites(); const s = S.sites.find((x) => x.id === id); if (!s) { v.innerHTML = `<div class="card empty">${ic("world")}<p>${L("الموقع غير موجود", "Site not found")}</p></div>`; return; }
  const hist = (await api("scan_list", { site_id: id })).scans.filter((x) => x.status === "done");
  const shared = /\.github\.io$|\.netlify\.app$|\.vercel\.app$|\.pages\.dev$/.test(s.domain); const fp = (shared ? s.base_path.replace(/\/$/, "") : "") + `/.well-known/alcode-verify-${s.verify_token}.txt`;
  v.innerHTML = top(`<span class="ltr">${esc(siteName(s))}</span>`, esc(s.label || ""), `${s.verified ? `<button class="btn pri" id="sn">${ic("radar-2")} ${L("افحص الآن", "Scan now")}</button>` : ""}<a class="btn ghost" href="#/sites">${ic("chevron-right")} ${L("رجوع", "Back")}</a>`) + `
  <div class="grid g2">${s.verified ? `<div class="card"><h2>${ic("shield-check")} ${L("التوثيق", "Verification")}</h2><div class="kv"><span>${L("الحالة", "Status")}</span><span class="s-pass">${L("موثّق", "Verified")}</span><span>${L("الطريقة", "Method")}</span><span>${L(...(METH[s.verify_method] || [s.verify_method, s.verify_method]))}</span><span>${L("التاريخ", "Date")}</span><span>${fmtDate(s.verified_at)}</span></div><p class="xs mu">${L("نعيد التحقق من التوثيق قبل كل فحص.", "Verification is re-checked before every scan.")}</p></div>`
  : `<div class="card"><h2>${ic("key")} ${L("أثبت ملكيتك للموقع", "Prove you own this site")}</h2><p class="sm mu">${L("اختر إحدى الطريقتين ثم اضغط «تحقق»:", "Use one of these methods, then press Verify:")}</p>
   <h3>1) ${L("سجل DNS من نوع TXT", "DNS TXT record")}</h3><div class="kv mono ltr"><span>Name</span><span>_alcode-verify.${esc(s.domain)}</span><span>Type</span><span>TXT</span><span>Value</span><span>alcode-verify=${esc(s.verify_token)}</span></div>
   <pre class="code">alcode-verify=${esc(s.verify_token)}</pre>
   <h3>2) ${L("ملف على موقعك", "A file on your site")}</h3><pre class="code">https://${esc(s.domain)}${esc(fp)}</pre><p class="xs mu">${L("محتوى الملف هو الرمز نفسه:", "File content is the token itself:")}</p><pre class="code">${esc(s.verify_token)}</pre>
   <div class="row"><button class="btn pri" id="vf">${ic("shield-check")} ${L("تحقق", "Verify")}</button></div></div>`}
   <div class="card"><h2>${ic("calendar-time")} ${L("الإعدادات", "Settings")}</h2><label class="l">${L("إعادة الفحص المجدولة", "Scheduled rescans")}</label>
   <select class="in" id="sc">${["off", "weekly", "monthly"].map((o) => `<option value="${o}" ${s.schedule === o ? "selected" : ""}>${L({ off: "متوقفة", weekly: "أسبوعياً", monthly: "شهرياً" }[o], o)}</option>`).join("")}</select>
   <label class="l">${L("الاسم المختصر", "Label")}</label><input class="in" id="lb" value="${esc(s.label || "")}" maxlength="60">
   <div class="row" style="margin-top:12px"><button class="btn" id="sv">${ic("check")} ${L("حفظ", "Save")}</button><span class="sp"></span><button class="btn ghost dan" id="dl">${ic("trash")} ${L("حذف الموقع", "Delete site")}</button></div></div></div>
  <div class="card" style="margin-top:16px"><div class="row"><h2>${ic("history")} ${L("سجل الفحوصات", "Scan history")}</h2><span class="sp"></span>${hist.length > 1 ? `<button class="btn sm" id="cmp">${ic("git-compare", "sm")} ${L("قارن آخر فحصين", "Compare last two")}</button>` : ""}</div>
   ${trendSvg([...hist].reverse())}
   <div class="tw"><table class="t"><thead><tr><th>${L("التاريخ", "Date")}</th><th>${L("النتيجة", "Score")}</th><th></th></tr></thead><tbody>${hist.map((h) => `<tr><td>${fmtDate(h.started_at)}</td><td><b style="color:${gradeColor(h.grade)}">${esc(h.grade)}</b> · ${h.score}</td><td style="text-align:end"><a class="btn sm" href="#/scan/${h.id}">${ic("file-report", "sm")} ${L("التقرير", "Report")}</a></td></tr>`).join("") || `<tr><td colspan="3" class="mu">${L("لا توجد فحوصات", "No scans yet")}</td></tr>`}</tbody></table></div></div>`;
  copyBtns(v);
  $("#sn") && ($("#sn").onclick = () => scanNow(s));
  $("#vf") && ($("#vf").onclick = async () => { const b = $("#vf"); b.disabled = true; b.innerHTML = ic("loader-2", "spin") + " " + L("جارٍ التحقق…", "Checking…"); try { const j = await api("site_verify", { site_id: id }); toast(L("تم التوثيق بنجاح", "Verified")); site_(v, id); } catch (e) { toast(ERR(e)); b.disabled = false; b.innerHTML = ic("shield-check") + " " + L("تحقق", "Verify"); } });
  $("#sv").onclick = async () => { try { await api("site_update", { site_id: id, schedule: $("#sc").value, label: $("#lb").value }); toast(L("تم الحفظ", "Saved")); } catch (e) { toast(ERR(e)); } };
  $("#dl").onclick = async () => { if (!confirm(L("حذف الموقع وكل فحوصاته؟", "Delete this site and all its scans?"))) return; try { await api("site_delete", { site_id: id }); location.hash = "#/sites"; } catch (e) { toast(ERR(e)); } };
  $("#cmp") && ($("#cmp").onclick = () => (location.hash = `#/compare/${hist[1].id}/${hist[0].id}`));
  animate(v);
}
const NOTES = { legacy_tls_not_tested: ["لم يُختبر دعم TLS القديم", "Legacy TLS not tested"], dns_platform_managed: ["DNS يُدار من المنصة المستضيفة (github.io) — بعض فحوص DNS/البريد غير منطبقة", "DNS is platform-managed — some DNS/email checks don't apply"], no_libs_detected: ["لم تُكتشف مكتبات JavaScript معروفة الإصدار", "No versioned JS libraries detected"], osv_unavailable: ["تعذّر الوصول لقاعدة OSV مؤقتاً", "OSV database unavailable"], cert_details_unavailable: ["تعذّرت قراءة تفاصيل الشهادة", "Certificate details unavailable"] };
const PLAT = { github_pages: "GitHub Pages", shopify: "Shopify", cloudflare: "Cloudflare", nginx: "Nginx", apache: "Apache", netlify: "Netlify", vercel: "Vercel", wordpress: "WordPress" };
function findingHtml(f, ai, k) {
  const a = ai?.findings?.[f.id]; const open = f.sev === "critical" || f.sev === "high";
  const snips = (a?.snippets || []).filter((x) => x?.code);
  return `<details class="find" ${open ? "open" : ""} style="animation-delay:${Math.min(k, 20) * 30}ms"><summary><span class="sevdot s-${f.sev}"></span><span style="flex:1">${esc(L(f.t_ar, f.t_en))}</span>${sevPill(f.sev)}</summary><div class="bd">
  ${f.ev ? `<div class="xs mu">${L("الدليل", "Evidence")}:</div><pre class="code">${esc(f.ev)}</pre>` : ""}
  ${a ? `<p>${esc(L(a.explain_ar, a.explain_en))}</p>${a.impact_ar ? `<div class="note warn"><b>${L("الأثر", "Impact")}:</b> ${esc(L(a.impact_ar, a.impact_en || a.impact_ar))}</div>` : ""}
   ${(L(a.fix_ar, a.fix_en) || []).length ? `<h3 style="margin-top:12px">${ic("tool", "sm")} ${L("خطوات الإصلاح", "How to fix")}</h3><ol>${(L(a.fix_ar, a.fix_en) || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
   ${snips.length ? `<div class="tabs noprint">${snips.map((x, i) => `<button class="tab ${i ? "" : "on"}" data-t="${i}">${esc(x.platform)}</button>`).join("")}</div>${snips.map((x, i) => `<pre class="code" data-p="${i}" ${i ? 'style="display:none"' : ""}>${esc(x.code)}</pre>`).join("")}` : ""}`
   : f.sev !== "pass" && f.sev !== "info" ? `<p class="xs mu">${L("اضغط «شرح بالذكاء الاصطناعي» للحصول على الشرح وخطوات الإصلاح.", "Press “AI explain” for explanation and fix steps.")}</p>` : ""}
  </div></details>`;
}
export async function scan(v, id) {
  const { scan: sc } = await api("scan_get", { scan_id: id }); if (!S.sites.length) await loadSites(); const s = S.sites.find((x) => x.id === sc.site_id) || { domain: "?", base_path: "/" };
  const F = [...(sc.findings || [])].sort((a, b) => SEVORD[a.sev] - SEVORD[b.sev]); const m = sc.meta || {};
  const cnt = {}; F.forEach((f) => (cnt[f.sev] = (cnt[f.sev] || 0) + 1));
  const render = () => {
    const ai = sc.ai; const issues = F.filter((f) => !["pass", "info"].includes(f.sev));
    v.innerHTML = `<div class="printhead"><img src="icons/logo.svg" alt=""><div><b>${L("درع الكود — تقرير أمان", "Alcode Shield — Security report")}</b><div class="xs">${esc(siteName(s))} · ${fmtDate(sc.started_at)}</div></div></div>` +
    top(`<span class="ltr">${esc(siteName(s))}</span>`, fmtDate(sc.started_at) + (m.platform ? " · " + esc(PLAT[m.platform] || m.platform) : "") + (m.cdn && m.cdn !== m.platform ? " · " + esc(PLAT[m.cdn] || m.cdn) : ""),
      `<button class="btn" id="pr">${ic("printer")} PDF</button><button class="btn" id="csv">${ic("file-spreadsheet")} CSV</button><a class="btn ghost" href="#/site/${s.id}">${ic("chevron-right")}</a>`) + `
    <div class="grid g2"><div class="card"><div class="hero">${ring(sc.score, sc.grade)}<div style="flex:1;min-width:200px">
      ${m.prev_score != null ? `<div class="sm ${sc.score >= m.prev_score ? "diff-up" : "diff-down"}">${ic(sc.score >= m.prev_score ? "arrow-up-right" : "arrow-down-right", "sm")} ${sc.score - m.prev_score >= 0 ? "+" : ""}${sc.score - m.prev_score} ${L("عن الفحص السابق", "vs previous scan")} ${m.prev_id ? `<a href="#/compare/${m.prev_id}/${sc.id}" class="noprint">${L("قارن", "compare")}</a>` : ""}</div>` : ""}
      <div class="row" style="margin:8px 0">${["critical", "high", "medium", "low", "pass"].map((k) => `<span class="chip"><span class="sevdot s-${k}" style="width:8px;height:8px"></span>${L(...SEV[k])} <b>${cnt[k] || 0}</b></span>`).join("")}</div>
      ${ai ? `<p style="margin:6px 0">${esc(L(ai.summary_ar, ai.summary_en))}</p>${ai.top_risk_ar ? `<div class="note warn sm"><b>${L("الخطر الأبرز", "Top risk")}:</b> ${esc(L(ai.top_risk_ar, ai.top_risk_en || ai.top_risk_ar))}</div>` : ""}`
        : `<button class="btn pri noprint" id="ai">${ic("sparkles")} ${L("شرح بالذكاء الاصطناعي وخطة الإصلاح", "AI explanation & fix plan")}</button>`}
     </div></div></div>
     <div class="card"><h2>${L("الفئات", "Categories")}</h2>${Object.entries(sc.categories || {}).map(([c, x]) => `<div style="margin:8px 0"><div class="row sm"><span>${ic(CATN[c]?.[2] || "shield", "sm")} ${L(CATN[c]?.[0] || c, CATN[c]?.[1])}</span><span class="sp"></span><b>${x.score}</b></div><div class="bar"><i data-w="${x.score}"></i></div></div>`).join("")}</div></div>
    ${ai?.plan?.length ? `<div class="card" style="margin-top:16px"><div class="row"><h2>${ic("list-details")} ${L("خطة العمل حسب الأولوية", "Prioritised action plan")}</h2><span class="sp"></span><button class="btn sm ghost noprint" id="air">${ic("refresh", "sm")} ${L("إعادة التحليل", "Re-analyse")}</button></div>
      <div class="grid g3">${ai.plan.map((p) => `<div style="border:1px solid var(--line);border-radius:14px;padding:14px;background:var(--bg2)"><div class="row"><b style="font-size:22px;color:var(--gold)">${p.order}</b><span class="pill s-${p.effort === "high" ? "high" : p.effort === "medium" ? "medium" : "pass"}">${L("الجهد", "Effort")}: ${L({ low: "منخفض", medium: "متوسط", high: "مرتفع" }[p.effort] || p.effort, p.effort)}</span></div><h3 style="margin-top:6px">${esc(L(p.title_ar, p.title_en))}</h3><div class="sm mu">${esc(L(p.why_ar, p.why_en || p.why_ar))}</div></div>`).join("")}</div></div>` : ""}
    <div class="card" style="margin-top:16px"><div class="row"><h2>${ic("alert-triangle")} ${L("الملاحظات", "Findings")} <span class="mu sm">(${issues.length})</span></h2><span class="sp"></span><div class="tabs noprint" id="flt"><button class="tab on" data-f="issues">${L("المشكلات", "Issues")}</button><button class="tab" data-f="all">${L("الكل", "All")}</button><button class="tab" data-f="pass">${L("السليم", "Passed")}</button></div></div><div id="fl"></div></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h2>${ic("info-circle")} ${L("تفاصيل تقنية", "Technical details")}</h2><div class="kv sm">
      ${m.tls ? `<span>TLS</span><span class="ltr">${esc(Object.entries(m.tls.versions || {}).filter(([, x]) => x).map(([k]) => k).join(", "))}</span><span>${L("المُصدِر", "Issuer")}</span><span class="ltr">${esc(m.tls.issuer?.O || m.tls.issuer?.CN || "—")}</span><span>${L("الانتهاء", "Expires")}</span><span>${m.tls.valid_to ? fmtDate(m.tls.valid_to) : "—"}</span><span>${L("المفتاح", "Key")}</span><span class="ltr">${esc((m.tls.key || "") + " " + (m.tls.curve || m.tls.bits || ""))}</span>` : ""}
      ${m.page ? `<span>${L("زمن الاستجابة", "Response")}</span><span class="ltr">${m.page.ms} ms · ${Math.round(m.page.bytes / 1024)} KB · HTTP ${m.page.status}</span>` : ""}
      ${m.probes ? `<span>${L("مسارات مفحوصة", "Paths probed")}</span><span>${m.probes.checked} (${L("تخطّي احتراماً لـ robots", "skipped per robots")}: ${m.probes.skipped})</span>` : ""}
      ${m.libs?.length ? `<span>${L("المكتبات", "Libraries")}</span><span class="ltr">${esc(m.libs.map((x) => x.name + " " + x.version).join(", "))}</span>` : ""}
      ${m.third_party_hosts?.length ? `<span>${L("نطاقات خارجية", "Third-party hosts")}</span><span class="ltr xs">${esc(m.third_party_hosts.slice(0, 12).join(", "))}</span>` : ""}
      ${m.dns?.mx?.length ? `<span>MX</span><span class="ltr xs">${esc(m.dns.mx.join(", "))}</span>` : ""}</div>
      ${(m.notes || []).length ? `<div style="margin-top:10px">${m.notes.map((n) => `<div class="note sm" style="margin-top:6px">${esc(L(...(NOTES[n] || [n, n])))}</div>`).join("")}</div>` : ""}</div>
     <div class="card noprint"><h2>${ic("message-chatbot")} ${L("اسأل المستشار الأمني", "Ask the security advisor")}</h2><p class="sm mu">${L("محادثة ذكاء اصطناعي تعرف نتائج هذا التقرير بالتحديد.", "An AI chat that knows this exact report.")}</p><button class="btn pri" id="och">${ic("message-chatbot")} ${L("ابدأ المحادثة", "Start chat")}</button></div></div>
    <p class="xs mu" style="margin-top:16px">${L("فحص سلبي خفيف: لا استغلال، لا تخمين، لا هجمات. النتيجة تقديرية ولا تغني عن اختبار اختراق مرخّص.", "Passive light scan: no exploitation, brute force or attacks. The score is indicative and not a substitute for an authorised penetration test.")}</p>`;
    const drawF = (mode) => { const list = mode === "all" ? F : mode === "pass" ? F.filter((f) => f.sev === "pass") : F.filter((f) => !["pass", "info"].includes(f.sev)); $("#fl").innerHTML = list.map((f, k) => findingHtml(f, sc.ai, k)).join("") || `<div class="empty">${ic("circle-check")}<p>${L("لا توجد مشكلات", "No issues")}</p></div>`; copyBtns($("#fl"));
      $$("#fl .find", v).forEach((d) => $$(".tab", d).forEach((t) => (t.onclick = () => { $$(".tab", d).forEach((x) => x.classList.toggle("on", x === t)); $$("pre[data-p]", d).forEach((p) => (p.style.display = p.dataset.p === t.dataset.t ? "" : "none")); }))); };
    drawF("issues"); $$("#flt .tab").forEach((t) => (t.onclick = () => { $$("#flt .tab").forEach((x) => x.classList.toggle("on", x === t)); drawF(t.dataset.f); }));
    const runAi = async (force, b) => { b.disabled = true; b.innerHTML = ic("loader-2", "spin") + " " + L("الذكاء الاصطناعي يحلل النتائج… (حتى 40 ثانية)", "AI is analysing… (up to 40s)"); try { const j = await api("scan_ai", { scan_id: id, force }); sc.ai = j.ai; render(); } catch (e) { toast(ERR(e)); b.disabled = false; b.innerHTML = ic("sparkles") + " " + L("أعد المحاولة", "Retry"); } };
    $("#ai") && ($("#ai").onclick = (e) => runAi(false, e.currentTarget)); $("#air") && ($("#air").onclick = (e) => runAi(true, e.currentTarget));
    $("#pr").onclick = () => { $$(".find").forEach((d) => (d.open = true)); setTimeout(() => print(), 100); };
    $("#csv").onclick = () => { const q = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`; download(`alcode-shield-${s.domain}-${sc.started_at.slice(0, 10)}.csv`, "\ufeff" + [["severity", "category", "id", "title_ar", "title_en", "evidence", "fix_ar"].join(","), ...F.map((f) => [f.sev, f.cat, f.id, f.t_ar, f.t_en, f.ev, (sc.ai?.findings?.[f.id]?.fix_ar || []).join(" | ")].map(q).join(","))].join("\n"), "text/csv"); };
    $("#och").onclick = () => openChat(id, s);
    animate(v);
  };
  render(); chatFab(id, s);
}
function chatFab(scanId, s) { const b = document.createElement("button"); b.className = "btn pri fab noprint"; b.innerHTML = ic("message-chatbot") + `<span>${L("المستشار", "Advisor")}</span>`; b.onclick = () => openChat(scanId, s); document.body.append(b); }
const chats = {};
function openChat(scanId, s) {
  let c = $(".chat"); if (c) { c.classList.add("open"); $("textarea", c)?.focus(); return; }
  const hist = (chats[scanId] ||= []);
  c = document.createElement("div"); c.className = "chat open"; c.innerHTML = `<div class="hd">${ic("message-chatbot")}<b>${L("المستشار الأمني", "Security advisor")}</b><span class="xs mu ltr">${esc(siteName(s))}</span><span class="sp"></span><button class="btn sm ghost" id="cx">${ic("x", "sm")}</button></div>
  <div class="ms" id="cm"></div><form id="cf"><textarea class="in" id="ct" rows="1" style="min-height:44px" placeholder="${L("اكتب سؤالك…", "Ask something…")}"></textarea><button class="btn pri" id="cs">${ic("send")}</button></form>`;
  document.body.append(c);
  const draw = () => { const m = $("#cm", c); m.innerHTML = (hist.length ? "" : `<div class="msg">${L("أهلاً! اسألني عن أي ملاحظة في التقرير، أو كيف أطبّق الإصلاح على منصتك.", "Hi! Ask me about any finding or how to apply a fix on your platform.")}</div><div class="row">${[L("ما أهم شيء أصلحه أولاً؟", "What should I fix first?"), L("اكتب لي CSP مناسباً لموقعي", "Write a suitable CSP for my site"), L("اشرح النتيجة لشخص غير تقني", "Explain the score to a non-technical person")].map((q) => `<button class="chip" type="button" data-q="${esc(q)}" style="cursor:pointer">${esc(q)}</button>`).join("")}</div>`) + hist.map((x) => `<div class="msg ${x.role === "user" ? "u" : ""}">${x.role === "user" ? esc(x.text) : md(x.text)}</div>`).join(""); copyBtns(m); m.scrollTop = m.scrollHeight; $$("[data-q]", m).forEach((b) => (b.onclick = () => send(b.dataset.q))); };
  const send = async (t) => { t = t.trim(); if (!t) return; hist.push({ role: "user", text: t }); $("#ct", c).value = ""; draw(); $("#cm", c).insertAdjacentHTML("beforeend", `<div class="msg" id="typing">${ic("loader-2", "spin sm")} ${L("يكتب…", "typing…")}</div>`); $("#cs", c).disabled = true;
    try { const j = await api("chat", { scan_id: scanId, messages: hist }); hist.push({ role: "model", text: j.text }); } catch (e) { hist.pop(); toast(ERR(e)); } $("#cs", c).disabled = false; draw(); };
  $("#cf", c).onsubmit = (e) => { e.preventDefault(); send($("#ct", c).value); }; $("#ct", c).onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e.target.value); } };
  $("#cx", c).onclick = () => c.classList.remove("open"); draw();
}
export async function compare(v, a, b) {
  const [A, B] = await Promise.all([api("scan_get", { scan_id: a }), api("scan_get", { scan_id: b })]).then((r) => r.map((x) => x.scan)); if (!S.sites.length) await loadSites();
  const s = S.sites.find((x) => x.id === B.site_id) || {}; const key = (f) => f.id + "|" + f.t_en; const iss = (sc) => (sc.findings || []).filter((f) => !["pass", "info"].includes(f.sev));
  const ak = new Set(iss(A).map(key)), bk = new Set(iss(B).map(key)); const fixed = iss(A).filter((f) => !bk.has(key(f))), added = iss(B).filter((f) => !ak.has(key(f))), same = iss(B).filter((f) => ak.has(key(f)));
  const col = (t, list, icn, cls) => `<div class="card"><h2 class="${cls}">${ic(icn)} ${t} <span class="mu sm">(${list.length})</span></h2>${list.map((f) => `<div class="row sm" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="sevdot s-${f.sev}" style="width:8px;height:8px"></span><span style="flex:1">${esc(L(f.t_ar, f.t_en))}</span>${sevPill(f.sev)}</div>`).join("") || `<div class="mu sm">—</div>`}</div>`;
  v.innerHTML = top(L("مقارنة فحصين", "Compare scans"), `<span class="ltr">${esc(siteName(s))}</span>`, `<a class="btn ghost" href="#/site/${s.id}">${ic("chevron-right")}</a>`) + `
  <div class="card"><div class="row" style="justify-content:space-around;text-align:center"><div>${ring(A.score, A.grade)}<div class="sm mu" style="margin-top:6px">${fmtDate(A.started_at)}</div></div>
  <div style="font-size:28px" class="${B.score >= A.score ? "diff-up" : "diff-down"}">${ic(B.score >= A.score ? "arrow-up-right" : "arrow-down-right", "lg")}<div><b>${B.score - A.score >= 0 ? "+" : ""}${B.score - A.score}</b></div></div>
  <div>${ring(B.score, B.grade)}<div class="sm mu" style="margin-top:6px">${fmtDate(B.started_at)}</div></div></div></div>
  <div class="grid g3" style="margin-top:16px">${col(L("تم إصلاحها", "Fixed"), fixed, "circle-check", "s-pass")}${col(L("جديدة", "New"), added, "alert-triangle", "s-high")}${col(L("ما زالت قائمة", "Still open"), same, "clock-hour-4", "")}</div>`;
  animate(v);
}
export async function history(v) {
  await loadSites(); const byId = Object.fromEntries(S.sites.map((s) => [s.id, s]));
  v.innerHTML = top(L("سجل الفحوصات", "Scan history"), L("كل الفحوصات المكتملة", "All completed scans")) + `<div class="card"><div class="tw"><table class="t"><thead><tr><th>${L("الموقع", "Site")}</th><th>${L("التاريخ", "Date")}</th><th>${L("النتيجة", "Score")}</th><th></th></tr></thead><tbody>${S.scans.map((h) => `<tr><td class="ltr" style="text-align:start">${esc(siteName(byId[h.site_id]))}</td><td>${fmtDate(h.started_at)}</td><td><b style="color:${gradeColor(h.grade)}">${esc(h.grade)}</b> · ${h.score}</td><td style="text-align:end;white-space:nowrap"><a class="btn sm" href="#/scan/${h.id}">${ic("file-report", "sm")}</a> <button class="btn sm ghost dan" data-del="${h.id}">${ic("trash", "sm")}</button></td></tr>`).join("") || `<tr><td colspan="4" class="mu">${L("لا توجد فحوصات", "No scans")}</td></tr>`}</tbody></table></div></div>`;
  $$("[data-del]", v).forEach((b) => (b.onclick = async () => { if (!confirm(L("حذف هذا الفحص؟", "Delete this scan?"))) return; try { await api("scan_delete", { scan_id: b.dataset.del }); b.closest("tr").remove(); } catch (e) { toast(ERR(e)); } }));
}
const ACT = { login: ["تسجيل دخول", "Sign in"], logout: ["تسجيل خروج", "Sign out"], site_add: ["إضافة موقع", "Site added"], site_update: ["تعديل موقع", "Site updated"], site_delete: ["حذف موقع", "Site deleted"], site_verify: ["توثيق موقع", "Site verified"], scan: ["فحص", "Scan"], scan_refused: ["رفض فحص", "Scan refused"], scan_delete: ["حذف فحص", "Scan deleted"], scan_ai: ["تحليل ذكاء اصطناعي", "AI analysis"], ai_chat: ["محادثة المستشار", "Advisor chat"], scheduled_scan: ["فحص مجدول", "Scheduled scan"], profile_update: ["تحديث الملف", "Profile updated"], ip_text: ["فحص نص", "Text check"], ip_clone: ["فحص استنساخ", "Clone check"], ip_image: ["فحص صور", "Image check"], ip_typo: ["نطاقات مشابهة", "Lookalike domains"], ip_ai: ["ذكاء اصطناعي - ملكية", "IP AI"], privacy_ai: ["خطة خصوصية", "Privacy plan"], privacy_check: ["فحص خصوصية", "Privacy check"] };
export async function audit(v) {
  const { rows } = await api("audit");
  v.innerHTML = top(L("سجل التدقيق", "Audit log"), L("كل العمليات على حسابك (آخر 300)", "Every action on your account (last 300)"), `<button class="btn" id="ex">${ic("download")} CSV</button>`) + `<div class="card"><div class="tw"><table class="t"><thead><tr><th>${L("الوقت", "Time")}</th><th>${L("العملية", "Action")}</th><th>${L("التفاصيل", "Detail")}</th></tr></thead><tbody>${rows.map((r) => `<tr><td style="white-space:nowrap">${fmtDate(r.at)}</td><td>${esc(L(...(ACT[r.action] || [r.action, r.action])))}</td><td class="ltr xs mono" style="text-align:start;overflow-wrap:anywhere">${esc(Object.entries(r.detail || {}).filter(([k]) => k !== "ua").map(([k, x]) => k + ": " + (typeof x === "object" ? JSON.stringify(x) : x)).join(" · "))}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#ex").onclick = () => download("alcode-shield-audit.csv", "\ufeffat,action,detail\n" + rows.map((r) => [r.at, r.action, JSON.stringify(r.detail || {})].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv");
}
export async function settings(v) {
  const me = (await api("me")).me; S.me = me; const id = me.identity || {};
  const f = (k, ar, en, ph = "") => `<label class="l">${ar === en ? ar : L(ar, en)}</label><input class="in ltr" data-k="${k}" value="${esc((id[k] || []).join ? (id[k] || []).join(", ") : id[k] || "")}" placeholder="${ph}">`;
  v.innerHTML = top(L("الإعدادات", "Settings"), esc(me.auth_email)) + `<div class="grid g2"><div class="card"><h2>${ic("user")} ${L("هويتي (لوحدات الملكية والخصوصية)", "My identity (for IP & privacy modules)")}</h2>
  <label class="l">${L("الاسم", "Name")}</label><input class="in" data-k="name" value="${esc(id.name || me.name || "")}">
  <label class="l">${L("البريد الإلكتروني (مقفل على بريد الدخول)", "Email (locked to sign-in email)")}</label><input class="in ltr" value="${esc(me.auth_email)}" disabled>
  <label class="l">${L("رقم الهاتف", "Phone")}</label><input class="in ltr" data-k="phone" value="${esc(id.phone || "")}" placeholder="+971…">${f("handles", "المعرّفات في المنصات", "Social handles", "liwadc")}${f("brand", "العلامات التجارية", "Brand names")}
  <label class="l">GitHub</label><input class="in ltr" data-k="github" value="${esc(id.github || "")}">
  <p class="xs mu">${L("يُستخدم البريد الأول للتحقق من بيانات صاحب الحساب فقط. لن تُفحص بيانات أي شخص آخر.", "Used only to check the account owner's own data.")}</p>
  <button class="btn pri" id="sv">${ic("check")} ${L("حفظ", "Save")}</button></div>
  <div class="card"><h2>${ic("info-circle")} ${L("عن المنصة", "About")}</h2><div class="kv sm"><span>${L("الدور", "Role")}</span><span>${esc(me.role)}</span><span>${L("الخطة", "Plan")}</span><span>${esc(me.plan || "private")}</span><span>${L("حد الفحص", "Scan limit")}</span><span>${me.role === "member" ? 6 : 20} / ${L("ساعة", "hour")}</span></div>
  <div class="note sm" style="margin-top:12px">${L("المنصة خاصة حالياً. البنية جاهزة لتعدد المستخدمين (أدوار، مواقع لكل مستخدم، عزل بيانات على مستوى قاعدة البيانات).", "Private for now; built multi-tenant ready (roles, per-user sites, row-level isolation).")}</div></div></div>`;
  $("#sv").onclick = async () => { const o = { name: $("[data-k=name]").value.trim(), github: $("[data-k=github]").value.trim(), phone: $("[data-k=phone]").value.trim() }; ["handles", "brand"].forEach((k) => (o[k] = $(`[data-k=${k}]`).value.split(",").map((x) => x.trim()).filter(Boolean)));
    try { await api("profile_update", { identity: o }); toast(L("تم الحفظ", "Saved")); } catch (e) { toast(ERR(e)); } };
}
