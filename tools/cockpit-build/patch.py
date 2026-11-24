"""Build the Cockpit page: the artifact's app + Supabase sign-in/storage + command centre in Today."""
import sys, re, pathlib

src = pathlib.Path(sys.argv[1]).read_text()
layer = pathlib.Path(sys.argv[2]).read_text()
out_path = pathlib.Path(sys.argv[3])

def replace_once(s, old, new, label):
    n = s.count(old)
    if n != 1:
        sys.exit(f"patch '{label}': expected 1 match, found {n}")
    return s.replace(old, new)

# 1. Supabase client library (pinned) before the app script.
s = replace_once(src, '<div class="toast" id="toast"></div>\n\n<script>\n(function(){',
    '<div class="toast" id="toast"></div>\n\n<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>\n<script>\n(function(){',
    "supabase script")

# 2. Swap localStorage persistence for the Supabase layer.
start = s.index("let state = load();\nfunction load(){")
end_marker = "function uid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4); }\n"
end = s.index(end_marker, start) + len(end_marker)
s = s[:start] + layer + "\n" + s[end:]

# 3. Sign-in screen styles + Today frame styles.
s = replace_once(s, "  .app{ display:flex; min-height:100vh; }",
    """  .app{ display:flex; min-height:100vh; }
  .login-screen{ width:100%; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); }
  .login-card{ width:320px; max-width:90vw; text-align:center; }
  .login-card h2{ margin:0 0 2px; font-size:19px; }
  .login-card .field{ text-align:left; }
  .login-error{ color:var(--bad); font-size:12.5px; margin-top:8px; min-height:16px; }
  .cc-frame-wrap{ background:#05070c; min-height:100vh; }
  .cc-frame{ display:block; width:100%; height:100vh; border:0; background:#05070c; }
  @media (max-width:880px){ .cc-frame{ height:calc(100vh - 64px); } }""",
    "css")

# 4. Sidebar footer: Supabase note + sign out.
s = replace_once(s, '<div class="storage-note">Saved to this browser only. <button id="exportAllBtn">Export backup</button></div>',
    '<div class="storage-note">Synced to your account. <button id="exportAllBtn">Export backup</button> · <button id="logoutBtn">Sign out</button></div>',
    "storage note")
s = replace_once(s, '  document.getElementById("exportAllBtn").addEventListener("click", exportAllJSON);\n  renderView();',
    '  document.getElementById("exportAllBtn").addEventListener("click", exportAllJSON);\n  document.getElementById("logoutBtn").addEventListener("click", logout);\n  renderView();',
    "logout binding")

# 5. Today tab = the Daily Command Centre.
s = replace_once(s, '  if(activeView==="today") host.innerHTML = viewWorkflow();',
    '  if(activeView==="today") host.innerHTML = viewCommandCentre();', "today route")
s = replace_once(s, "/* ============================= TODAY ============================= */",
    """/* ============================= TODAY =============================
   The Today tab hosts the Daily Command Centre (served from /command-centre/
   on the same site, so it shares the sign-in). */
function viewCommandCentre(){
  return `<div class="cc-frame-wrap"><iframe class="cc-frame" src="/command-centre/?embed=1" title="Daily Command Centre"></iframe></div>`;
}
""", "today view")

# 6. Start-up: sign in, load from Supabase, then render.
s = replace_once(s, "/* ============================= INIT ============================= */\nmergeSheetImport();\nrenderShell();\nstartLiveCalendar();",
"""/* ============================= INIT ============================= */
function renderLogin(){
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="brand-mark" style="margin:0 auto 14px">RE</div>
        <h2>Reach Eyeballs Cockpit</h2>
        <div class="sub" style="margin-bottom:18px">Sign in to continue</div>
        <div class="field"><label for="loginEmail">Email</label><input type="email" id="loginEmail" autocomplete="username" /></div>
        <div class="field" style="margin-top:10px"><label for="loginPassword">Password</label><input type="password" id="loginPassword" autocomplete="current-password" /></div>
        <div id="loginError" class="login-error" role="alert"></div>
        <button class="btn primary" id="loginSubmit" style="width:100%;margin-top:14px;justify-content:center">Sign in</button>
      </div>
    </div>
  `;
  const submit = async ()=>{
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const errEl = document.getElementById("loginError");
    errEl.textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error){ errEl.textContent = error.message; return; }
    boot();
  };
  document.getElementById("loginSubmit").onclick = submit;
  document.getElementById("loginPassword").addEventListener("keydown", e=>{ if(e.key==="Enter") submit(); });
}
async function logout(){
  clearTimeout(saveTimer);
  syncAll();
  await sb.auth.signOut();
  boot();
}
async function boot(){
  const app = document.getElementById("app");
  const { data: { session } } = await sb.auth.getSession();
  if(!session){ renderLogin(); return; }
  window.__userEmail = session.user.email;
  app.innerHTML = `<div class="login-screen"><div class="sub">Loading…</div></div>`;
  await loadState();
  mergeSheetImport();
  renderShell();
}
boot();""", "init")

# 7. Meta Ads: outside claude.ai there is no Meta connector, so the tab talks
#    to /api/meta (the Cockpit server calls the Marketing API with the token
#    saved to the user's account). Same request/response shape as the
#    connector, so the rest of the tab is unchanged. Loaders stop once Meta is
#    known to be unavailable, so failures can't re-render in a loop.
for fn in ["function metaLoadOverview(force){", "function metaLoadClient(acct, force){", "function metaLoadChildren(acct, campaignId){"]:
    s = replace_once(s, fn, fn + "\n  if(metaLive===false) return;", fn)
s = replace_once(s, """  const mcp = window.claude && window.claude.mcp;
  if(!mcp){ return Promise.reject({ code:"capability_disabled" }); }
  return metaSchedule(()=>mcp.callTool(META_SERVER, tool, args, { cache: force ? { staleTime:0, refresh:true } : { staleTime:300000 } }))""", """  const mcp = window.claude && window.claude.mcp;
  const call = mcp ? ()=>mcp.callTool(META_SERVER, tool, args, { cache: force ? { staleTime:0, refresh:true } : { staleTime:300000 } }) : ()=>metaServer({ tool, args });
  return metaSchedule(call)""", "meta invoke via server")
s = replace_once(s, """  if(!(window.claude && window.claude.mcp)){ metaLive = false; return Promise.reject({ code:"capability_disabled" }); }
""", "", "meta call no connector check")
s = replace_once(s, 'const META_FATAL = ["not_granted",', 'const META_FATAL = ["not_connected","not_signed_in","not_granted",', "meta fatal codes")
s = replace_once(s, """  if(code==="needs_reauth") return "Reconnect Meta Ads in claude.ai Settings → Connectors to load live data.";""", """  if(code==="not_connected") return "Connect Meta to load live ad data.";
  if(code==="needs_reauth") return "Your Meta access token has expired or was revoked. Paste a new one to reload live data.";
  if(code==="rate_limited") return "Meta is rate-limiting requests. Press Refresh in a minute.";""", "meta error text")
s = replace_once(s, """hint:"Your Meta sign-in expired. Reconnect Meta Ads in claude.ai Settings → Connectors." };""", """hint:"Your Meta access token expired. Paste a new one at the top of Client Ads." };""", "meta reauth hint")
s = replace_once(s, """  if(!metaAccounts || force) MetaData.accounts(force).then(metaRerender, metaRerender);
  metaClients().forEach(c=>{ if(!metaDelivery[c.id] || force) MetaData.delivery(c.id, force).then(metaRerender, ()=>{}); });""", """  if((!metaAccounts && !metaTried.accounts) || force){ metaTried.accounts = true; MetaData.accounts(force).then(metaRerender, metaRerender); }
  metaClients().forEach(c=>{ if((!metaDelivery[c.id] && !metaTried["d"+c.id]) || force){ metaTried["d"+c.id] = true; MetaData.delivery(c.id, force).then(metaRerender, metaRerender); } });""", "meta overview tried flags")
s = replace_once(s, """  if(!metaAccounts) MetaData.accounts().then(metaRerender, ()=>{});
  if(!metaDelivery[acct] || force) MetaData.delivery(acct, force).then(metaRerender, ()=>{});""", """  if(!metaAccounts && !metaTried.accounts){ metaTried.accounts = true; MetaData.accounts().then(metaRerender, metaRerender); }
  if((!metaDelivery[acct] && !metaTried["d"+acct]) || force){ metaTried["d"+acct] = true; MetaData.delivery(acct, force).then(metaRerender, metaRerender); }""", "meta client tried flags")
s = replace_once(s, """function mStatusNote(){
""", """function mStatusNote(){
  const code = metaError && metaError.code;
  if(!(window.claude && window.claude.mcp) && (code==="not_connected" || code==="needs_reauth")) return metaConnectPanel(code);
""", "meta connect panel hook")
s = replace_once(s, "let metaAccounts = null;", """let metaAccounts = null;
const metaTried = {};
/* Server path (outside claude.ai): the Cockpit's /api/meta, with the user's sign-in. */
async function metaServer(body){
  const { data: { session } } = await sb.auth.getSession();
  if(!session) throw { code:"not_signed_in", message:"Sign in to the Cockpit first." };
  let res;
  try{ res = await fetch("/api/meta", { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${session.access_token}` }, body: JSON.stringify(body) }); }
  catch(e){ throw { code:"server_unavailable", message:"Network error", retryable:true }; }
  const j = await res.json().catch(()=>({}));
  if(!res.ok) throw { code:j.code || "server_unavailable", message:j.error || ("status "+res.status), retryable:!!j.retryable, retryAfterMs: j.retryable ? 20000 : undefined };
  return j;
}
function metaResetLive(){
  metaLive = null; metaError = null; metaAccounts = null;
  Object.keys(metaCache).forEach(k=>delete metaCache[k]);
  Object.keys(metaTried).forEach(k=>delete metaTried[k]);
  Object.keys(metaDelivery).forEach(k=>delete metaDelivery[k]);
  Object.keys(metaClientErr).forEach(k=>delete metaClientErr[k]);
  Object.keys(metaState.overview).forEach(k=>delete metaState.overview[k]);
  Object.keys(metaState.client).forEach(k=>delete metaState.client[k]);
}
function metaConnectPanel(code){
  return `<div class="m-connect">
    <div class="m-connect-h">${icon("target")} <b>${code==="needs_reauth" ? "Reconnect Meta" : "Connect Meta Ads"}</b></div>
    <p>${code==="needs_reauth" ? "Your Meta access token has expired or was revoked. Paste a new one and the live numbers come back." : "Paste a Meta access token with <b>ads_read</b> permission. It’s saved to your Cockpit account and only used by the Cockpit’s server, never shown in the page."}</p>
    <form id="metaConnectForm" class="m-connect-form">
      <input id="metaToken" type="password" autocomplete="off" placeholder="EAA…" aria-label="Meta access token" />
      <button class="m-btn primary" type="submit">Connect</button>
    </form>
    <details class="m-connect-how"><summary>How to get a token that doesn’t expire (recommended)</summary>
      <ol>
        <li>Go to <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener">Business settings → Users → System users</a> and click <b>Add</b>. Name it “Cockpit”, role <b>Employee</b>.</li>
        <li>Click <b>Assign assets</b> → <b>Ad accounts</b>, tick every client account, and give <b>View performance</b> (or Manage campaigns).</li>
        <li>Click <b>Generate new token</b>, pick any app you own (create a free one at <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> if you have none, type “Business”), set expiry to <b>Never</b>, tick <b>ads_read</b> and generate.</li>
        <li>Copy the token (starts with EAA) and paste it above.</li>
      </ol>
      <p>Quick test instead: <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener">Graph API Explorer</a> → add the <b>ads_read</b> permission → Generate Access Token. That one lasts about an hour unless you extend it in the Access Token Debugger.</p>
    </details>
  </div>`;
}
document.addEventListener("submit", async (e)=>{
  if(!e.target || e.target.id!=="metaConnectForm") return;
  e.preventDefault();
  const input = document.getElementById("metaToken"); const token = (input.value||"").trim();
  if(!token){ input.focus(); return; }
  const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Connecting…";
  try{
    const r = await metaServer({ action:"connect", token });
    toast(`Connected to Meta as ${r.user} · ${r.accounts} ad account${r.accounts===1?"":"s"}`);
    metaResetLive(); metaRefreshCurrent();
  }catch(err){ toast(err.message || "Meta didn’t accept that token."); btn.disabled = false; btn.textContent = "Connect"; }
});""", "meta server layer")

s = replace_once(s, "  .m-note.warn{", """  .m-connect{ background:#fff; border:1px solid #d6e2fd; border-radius:14px; padding:16px 18px; box-shadow:0 6px 20px -12px rgba(37,99,235,.35); }
  .m-connect-h{ display:flex; align-items:center; gap:8px; font-size:14px; color:#1e3a8a; }
  .m-connect-h svg{ width:16px; height:16px; }
  .m-connect p{ font-size:12.5px; color:var(--text-dim); margin:6px 0 10px; line-height:1.5; }
  .m-connect-form{ display:flex; gap:8px; flex-wrap:wrap; }
  .m-connect-form input{ flex:1; min-width:220px; }
  .m-btn.primary{ background:#2563EB; border-color:#2563EB; color:#fff; }
  .m-connect-how{ margin-top:10px; font-size:12.5px; color:var(--text-dim); }
  .m-connect-how summary{ cursor:pointer; font-weight:600; color:#1e3a8a; }
  .m-connect-how ol{ margin:8px 0 6px 18px; line-height:1.7; }
  .m-note.warn{""", "meta connect css")

# 8. Assistant chat (bottom-right) and collapsible sidebar.
here = pathlib.Path(__file__).parent
chat_js = (here / "chat-widget.js").read_text()
chat_css = (here / "chat-widget.css").read_text()
s = replace_once(s, "  .app{ display:flex; min-height:100vh; }", "  .app{ display:flex; min-height:100vh; }\n" + chat_css, "chat css")
s = replace_once(s, "/* ============================= INIT ============================= */", chat_js + "\n/* ============================= INIT ============================= */", "chat js")
s = replace_once(s, "  renderShell();\n}\nboot();", "  renderShell();\n  mountChat();\n}\nboot();", "mount chat")
s = replace_once(s, "  await sb.auth.signOut();\n  boot();", "  await sb.auth.signOut();\n  unmountChat();\n  boot();", "unmount chat")
s = replace_once(s, """      <div class="brand">
        <div class="brand-mark">RE</div>
        <div>
          <div class="brand-name">Reach Eyeballs</div>
          <div class="brand-sub">Cockpit</div>
        </div>
      </div>""", """      <div class="brand">
        <div class="brand-mark">RE</div>
        <div>
          <div class="brand-name">Reach Eyeballs</div>
          <div class="brand-sub">Cockpit</div>
        </div>
        <button type="button" class="icon-btn nav-toggle" id="navToggle" aria-label="${navCollapsed?"Expand sidebar":"Collapse sidebar"}" title="${navCollapsed?"Expand sidebar":"Collapse sidebar"}" aria-expanded="${!navCollapsed}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button>
      </div>""", "nav toggle button")
s = replace_once(s, """            <span class="t"><b>${n.label}</b><span>${n.sub}</span></span>""", """            <span class="t"><b>${n.label}</b><span>${n.sub}</span></span>""", "nav item")
s = replace_once(s, """          <button class="navitem ${activeView===n.id?"active":""}" data-nav="${n.id}">""", """          <button class="navitem ${activeView===n.id?"active":""}" data-nav="${n.id}" title="${n.label}" aria-label="${n.label}">""", "nav title")
s = replace_once(s, "function renderShell(){\n  const app = document.getElementById(\"app\");", """let navCollapsed = false;
try{ navCollapsed = localStorage.getItem("cockpit_nav_collapsed") === "1"; }catch(e){}
function renderShell(){
  const app = document.getElementById("app");
  app.classList.toggle("nav-collapsed", navCollapsed);""", "nav state")
s = replace_once(s, '  document.getElementById("logoutBtn").addEventListener("click", logout);\n', """  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("navToggle").addEventListener("click", ()=>{
    navCollapsed = !navCollapsed;
    try{ localStorage.setItem("cockpit_nav_collapsed", navCollapsed ? "1" : "0"); }catch(e){}
    renderShell();
  });
""", "nav toggle binding")

# 9. Finances tab restored from the previous Cockpit (Supabase finance_log /
#    finance_notes + monthly sheet import); Ads Acquisition and Client
#    Management removed; Fitness syncs live from the Calorie Tracker sheet.
old = (here / "finances" / "old-cockpit.html").read_text()
old_lines = old.split("\n")
def old_block(start_marker, end_marker):
    a = old.index(start_marker); b = old.index(end_marker, a)
    return old[a:b]
fin_js = old_block("/* ============================= FINANCES =============================", "/* ============================= MODALS ============================= */")
fin_modal = old_block("function financeNoteModal(", "/* ============================= EVENTS ============================= */")
helpers = "\n".join(l for l in old_lines if l.startswith("function fmtEUR("))
csv_fn = old_block("function parseCSV(text){", "function parseSheetDateDMY(")
fin_css = "\n".join(l for l in old.split("</style>")[0].split("\n") if (".fin-" in l or "fin-hero" in l))
icon_lines = "\n".join(l for l in old_lines if any(l.startswith(f"  {n}:`") for n in ("wallet", "note", "tag", "card")))

s = replace_once(s, "function icon(name){ return ICONS[name] || \"\"; }", "Object.assign(ICONS, {\n" + icon_lines + "\n});\nfunction icon(name){ return ICONS[name] || \"\"; }", "finance icons")
s = replace_once(s, "  .app{ display:flex; min-height:100vh; }", "  .app{ display:flex; min-height:100vh; }\n" + fin_css, "finance css")
pre_events = "function exportAllJSON(){"
extra = ""
if "function fmtEUR(" not in s: extra += helpers + "\n"
if "function parseCSV(" not in s: extra += csv_fn + "\n"
s = s.replace(pre_events, extra + fin_js + "\n" + fin_modal + "\n" + pre_events, 1)

# Data: finance tables join the synced Supabase tables.
s = replace_once(s, """  ["fitnessLog", "fitness_log", F_FITNESS],
];""", """  ["fitnessLog", "fitness_log", F_FITNESS],
  ["financeLog", "finance_log", F_FINANCE],
  ["financeNotes", "finance_notes", F_FINNOTES],
];""", "finance tables")
s = replace_once(s, "const F_AAMONTHLY =", """const F_FINANCE = [["id","id"],["monthKey","month_key"],["section","section"],["category","category"],["week1","week1"],["week2","week2"],["week3","week3"],["week4","week4"],["monthTotal","month_total"],["fromSheet","from_sheet"]];
const F_FINNOTES = [["id","id"],["monthKey","month_key"],["section","section"],["week","week"],["note","note"]];
const F_AAMONTHLY =""", "finance mappings")

# Navigation: Today, Client Ads, Fitness, Finances.
nav_start = s.index('  { id:"adsacq", label:"Ads Acquisition"')
nav_end = s.index("\n", s.index('  { id:"clients", label:"Client Management"'))
s = s[:nav_start] + s[nav_end+1:]
s = replace_once(s, '  { id:"fitness", label:"Fitness", sub:"Weight, calories & food", icon:"heart", chip:"#C2679A" },',
  '  { id:"fitness", label:"Fitness", sub:"Weight, calories & food", icon:"heart", chip:"#C2679A" },\n  { id:"finances", label:"Finances", sub:"Weekly & monthly spend", icon:"wallet", chip:"#3E9E6C" },', "nav finances")
s = replace_once(s, '  else if(activeView==="fitness") host.innerHTML = viewFitness();', '  else if(activeView==="fitness") host.innerHTML = viewFitness();\n  else if(activeView==="finances") host.innerHTML = viewFinances();', "route finances")
s = replace_once(s, '  else if(activeView==="adsacq") host.innerHTML = viewAdsAcq();\n', '', "route adsacq")
s = replace_once(s, '  else if(activeView==="clients") host.innerHTML = viewClients();\n', '', "route clients")
# finTab UI state + event bindings
n_ui = len(re.findall(r"(?:let|const) uiState = \{", s))
if n_ui != 1: sys.exit(f"patch 'uiState': expected 1 match, found {n_ui}")
s = re.sub(r"((?:let|const) uiState = \{)", r"\1 finTab: todayStr().slice(0,7),", s, count=1)
s = replace_once(s, "  /* ---- Daily workflow cockpit ---- */", """  document.querySelectorAll("[data-fin-tab]").forEach(b=>b.addEventListener("click", ()=>{ uiState.finTab=b.dataset.finTab; renderView(); }));
  document.querySelectorAll("[data-fin-note]").forEach(b=>b.addEventListener("click", ()=>{
    const [mk, section, week] = b.dataset.finNote.split("|");
    financeNoteModal(mk, section, +week);
  }));

  /* ---- Daily workflow cockpit ---- */""", "finance events")

# Fitness: live sync from every month tab of the Calorie Tracker sheet (server function /api/sheet).
s = replace_once(s, 'const SHEET_SYNCED_AT = "2026-10-31";', 'let SHEET_SYNCED_AT = "2026-10-31";', "sheet synced let")
s = replace_once(s, '· log there, then ask Claude to "sync my calories" to refresh</div>', '· syncs automatically from the sheet each time you open the Cockpit</div>', "fitness banner text")
s = replace_once(s, "  await loadState();\n  mergeSheetImport();\n  renderShell();", """  await loadState();
  mergeSheetImport();
  renderShell();
  syncFitnessLive();
  syncFinancesLive();""", "boot live syncs")
s = replace_once(s, "/* ============================= INIT ============================= */", """async function syncFitnessLive(){
  try{
    const { data: { session } } = await sb.auth.getSession();
    if(!session) return;
    const res = await fetch("/api/sheet", { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${session.access_token}` }, body: JSON.stringify({ url: SHEET_SOURCE_URL }) });
    if(!res.ok) return;
    const { rows } = await res.json();
    let changed = false;
    (rows||[]).forEach(r=>{
      const row = { date:r.date, weight:r.weight, calories:r.calories, protein:r.protein, foods:r.meals||"" };
      const idx = state.fitnessLog.findIndex(e=>e.date===row.date);
      if(idx>=0){
        const ex = state.fitnessLog[idx];
        if(ex.fromSheet===false) return;
        const merged = Object.assign({}, ex, row, { id:ex.id, fromSheet:true, protein: row.protein ?? ex.protein });
        if(Object.keys(merged).some(k=>String(merged[k] ?? "")!==String(ex[k] ?? ""))){ state.fitnessLog[idx] = merged; changed = true; }
      } else { state.fitnessLog.push(Object.assign({}, row, { id:uid(), fromSheet:true })); changed = true; }
    });
    SHEET_SYNCED_AT = todayStr();
    if(changed) save();
    if(activeView==="fitness") renderView();
  }catch(e){ console.warn("fitness sheet sync failed", e); }
}
async function syncFinancesLive(){
  try{ mergeFinanceSheetImport(await fetchFinanceSheetLive()); if(activeView==="finances") renderView(); }
  catch(e){ console.warn("finance sheet sync failed", e); }
}

/* ============================= INIT ============================= */""", "live sync functions")

# 10. Finances: discover the month tabs automatically (via /api/sheet) instead of
#     a hard-coded gid list, and read each tab through the server.
s = replace_once(s, 'const FINANCE_MONTH_GIDS = { "2026-08": "244576783" };', """const FINANCE_MONTH_GIDS = { "2026-08": "244576783", "2026-09": "766123365", "2026-10": "40564415" };
const FIN_MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
/* "August", "Aug 2026", "September '26" → "2026-08". A tab without a year is
   taken as the nearest such month: up to one month ahead, or the last ten. */
function finTabMonthKey(name){
  const n = String(name||"").trim().toLowerCase();
  const mi = FIN_MONTHS.findIndex(m=>n.startsWith(m) || new RegExp("^"+m.slice(0,3)+"\\\\b").test(n));
  if(mi<0) return null;
  const y4 = n.match(/(20\\d{2})/), y2 = n.match(/'(\\d{2})\\b/);
  const now = new Date();
  let year = y4 ? +y4[1] : y2 ? 2000 + +y2[1] : now.getFullYear();
  if(!y4 && !y2){
    const diff = mi - now.getMonth();
    if(diff > 1) year -= 1; else if(diff < -10) year += 1;
  }
  return `${year}-${String(mi+1).padStart(2,"0")}`;
}
async function finApi(body){
  const { data: { session } } = await sb.auth.getSession();
  if(!session) throw new Error("not signed in");
  const res = await fetch("/api/sheet", { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${session.access_token}` }, body: JSON.stringify(Object.assign({ url:`https://docs.google.com/spreadsheets/d/${FINANCE_SHEET_ID}/edit` }, body)) });
  const j = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(j.error || ("status "+res.status));
  return j;
}
async function finDiscoverMonths(){
  try{
    const { tabs } = await finApi({ mode:"tabs" });
    (tabs||[]).forEach(t=>{ const mk = finTabMonthKey(t.name); if(mk) FINANCE_MONTH_GIDS[mk] = String(t.gid); });
  }catch(e){ console.warn("finance tab discovery failed", e); }
}""", "finance month discovery")
s = replace_once(s, """  const url = `https://docs.google.com/spreadsheets/d/${FINANCE_SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { cache:"no-store" });
  if(!res.ok) throw new Error("finance sheet fetch failed: "+res.status);
  const rows = parseCSV(await res.text());
  return parseFinanceSheetRows(rows)""", """  const { rows } = await finApi({ mode:"csv", gid });
  return parseFinanceSheetRows(rows)""", "finance month via api")
s = replace_once(s, """async function fetchFinanceSheetLive(){
  const results""", """async function fetchFinanceSheetLive(){
  await finDiscoverMonths();
  const results""", "finance discover before fetch")

# 11. Tasks tab: two-way ClickUp (This week, Quick fires, All tasks, Leads + notes).
tasks_js = (here / "tasks-tab.js").read_text()
tasks_css = (here / "tasks-tab.css").read_text()
s = replace_once(s, "  .app{ display:flex; min-height:100vh; }", "  .app{ display:flex; min-height:100vh; }\n" + tasks_css, "tasks css")
s = replace_once(s, "/* ============================= INIT ============================= */", tasks_js + "\n/* ============================= INIT ============================= */", "tasks js")
s = replace_once(s, '  { id:"ads", label:"Client Ads"', '  { id:"tasks", label:"Tasks", sub:"ClickUp, quick fires & leads", icon:"list", chip:"#7B68EE" },\n  { id:"ads", label:"Client Ads"', "nav tasks")
s = replace_once(s, '  else if(activeView==="fitness") host.innerHTML = viewFitness();', '  else if(activeView==="fitness") host.innerHTML = viewFitness();\n  else if(activeView==="tasks") host.innerHTML = viewTasks();', "route tasks")
s = replace_once(s, "  bindViewEvents();\n  cpStartClock();", "  bindViewEvents();\n  if(activeView===\"tasks\") tkBind();\n  cpStartClock();", "bind tasks")

# 12. Live Google Sheets: re-read the calorie tracker and finance sheet every
#     30 s while the Cockpit is open and visible (and on returning to it),
#     re-rendering only when something actually changed.
s = replace_once(s, """    SHEET_SYNCED_AT = todayStr();
    if(changed) save();
    if(activeView==="fitness") renderView();""", """    SHEET_SYNCED_AT = todayStr();
    if(changed){ save(); if(activeView==="fitness" && sheetsCanRerender()) renderView(); }
    return changed;""", "fitness rerender only on change")
s = replace_once(s, """      state.financeLog[idx] = Object.assign({}, e, { id, fromSheet:true });
      changed = true;
    } else {
      state.financeLog.push(Object.assign({}, e, { id, fromSheet:true }));
      changed = true;
    }
  });
  if(changed) save();
}""", """      const next = Object.assign({}, e, { id, fromSheet:true });
      if(Object.keys(next).some(k=>String(next[k])!==String(existing[k]))){ state.financeLog[idx] = next; changed = true; }
    } else {
      state.financeLog.push(Object.assign({}, e, { id, fromSheet:true }));
      changed = true;
    }
  });
  if(changed) save();
  return changed;
}""", "finance merge only on change")
s = replace_once(s, """async function syncFinancesLive(){
  try{ mergeFinanceSheetImport(await fetchFinanceSheetLive()); if(activeView==="finances") renderView(); }
  catch(e){ console.warn("finance sheet sync failed", e); }
}""", """let FIN_DISCOVERED_AT = 0;
async function syncFinancesLive(){
  try{
    const changed = mergeFinanceSheetImport(await fetchFinanceSheetLive());
    if(changed && activeView==="finances" && sheetsCanRerender()) renderView();
  }catch(e){ console.warn("finance sheet sync failed", e); }
}
/* Don't redraw under someone who is typing or has a form open. */
function sheetsCanRerender(){
  if(document.getElementById("modalOverlay")) return false;
  const a = document.activeElement;
  return !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && document.getElementById("viewhost") && document.getElementById("viewhost").contains(a));
}
const SHEETS_POLL_MS = 30000;
let sheetsBusy = false, sheetsLastAt = 0;
async function syncSheetsLive(){
  if(sheetsBusy || document.visibilityState!=="visible") return;
  sheetsBusy = true;
  try{ await Promise.all([syncFitnessLive(), syncFinancesLive()]); sheetsLastAt = Date.now(); }
  finally{ sheetsBusy = false; }
}
function startSheetsLive(){
  syncSheetsLive();
  setInterval(syncSheetsLive, SHEETS_POLL_MS);
  const back = ()=>{ if(document.visibilityState==="visible" && Date.now()-sheetsLastAt > 5000) syncSheetsLive(); };
  document.addEventListener("visibilitychange", back);
  window.addEventListener("focus", back);
}""", "live sheets loop")
s = replace_once(s, """  syncFitnessLive();
  syncFinancesLive();
  mountChat();""", """  startSheetsLive();
  mountChat();""", "boot live sheets")
# Discover new month tabs at most every 5 minutes.
s = replace_once(s, """async function fetchFinanceSheetLive(){
  await finDiscoverMonths();""", """async function fetchFinanceSheetLive(){
  if(Date.now() - FIN_DISCOVERED_AT > 300000){ await finDiscoverMonths(); FIN_DISCOVERED_AT = Date.now(); }""", "finance discover throttle")

# 13. Fitness tab redesigned as a one-page health dashboard.
health_js = (here / "health-tab.js").read_text()
health_css = (here / "health-tab.css").read_text()
s = replace_once(s, "  .app{ display:flex; min-height:100vh; }", "  .app{ display:flex; min-height:100vh; }\n" + health_css, "health css")
s = replace_once(s, "/* ============================= INIT ============================= */", health_js + "\n/* ============================= INIT ============================= */", "health js")
s = replace_once(s, '  else if(activeView==="fitness") host.innerHTML = viewFitness();', '  else if(activeView==="fitness") host.innerHTML = viewHealth();', "route health")
s = replace_once(s, "  if(activeView===\"tasks\") tkBind();", "  if(activeView===\"tasks\") tkBind();\n  if(activeView===\"fitness\") hdBind();", "bind health")

# 14. Daily Workflow tab: the "Daily Workflow" Google Doc, tickable day by day.
wf_js = (here / "workflow-tab.js").read_text()
wf_css = (here / "workflow-tab.css").read_text()
s = replace_once(s, "  .app{ display:flex; min-height:100vh; }", "  .app{ display:flex; min-height:100vh; }\n" + wf_css, "workflow css")
s = replace_once(s, "/* ============================= INIT ============================= */", wf_js + "\n/* ============================= INIT ============================= */", "workflow js")
s = replace_once(s, '  { id:"tasks", label:"Tasks"', '  { id:"workflow", label:"Daily Workflow", sub:"Your day, block by block", icon:"calendar", chip:"#1a73e8" },\n  { id:"tasks", label:"Tasks"', "nav workflow")
s = replace_once(s, '  else if(activeView==="tasks") host.innerHTML = viewTasks();', '  else if(activeView==="tasks") host.innerHTML = viewTasks();\n  else if(activeView==="workflow") host.innerHTML = viewWorkflow();', "route workflow")
s = replace_once(s, "  if(activeView===\"fitness\") hdBind();", "  if(activeView===\"fitness\") hdBind();\n  if(activeView===\"workflow\") wfBind();", "bind workflow")

# 15. Favicon, home-screen icon and web app manifest (the "RE" brand mark).
# The page arrives wrapped in a minimal <head>; icons only work from the head, so they go there.
s = replace_once(s, "</head><body>", """<title>Reach Eyeballs Cockpit</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
<link rel="alternate icon" href="/favicon.ico" sizes="any" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#6c4fe0" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="Cockpit" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="application-name" content="Cockpit" />
</head><body>""", "favicon in head")
# Register the service worker (installable app + offline screen).
s = replace_once(s, "/* ============================= INIT ============================= */", """if("serviceWorker" in navigator && location.protocol==="https:") window.addEventListener("load", ()=>navigator.serviceWorker.register("/sw.js").catch(e=>console.warn("service worker", e)));
/* ============================= INIT ============================= */""", "service worker")

out_path.write_text(s)
print("wrote", out_path, len(s), "bytes")
