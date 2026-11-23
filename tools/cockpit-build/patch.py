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

out_path.write_text(s)
print("wrote", out_path, len(s), "bytes")
