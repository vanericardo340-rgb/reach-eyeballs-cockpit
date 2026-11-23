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

# 7. Meta Ads: outside Claude there is no connector. The loaders would fail
#    instantly, re-render, and retry forever (freezing the tab), so skip live
#    lookups and let the tab show the built-in Meta snapshot instead.
for fn in ["function metaLoadOverview(force){", "function metaLoadClient(acct, force){", "function metaLoadChildren(acct, campaignId){"]:
    s = replace_once(s, fn, fn + "\n  if(!(window.claude && window.claude.mcp)) return;", fn)

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
        if(JSON.stringify(merged)!==JSON.stringify(ex)){ state.fitnessLog[idx] = merged; changed = true; }
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

out_path.write_text(s)
print("wrote", out_path, len(s), "bytes")
