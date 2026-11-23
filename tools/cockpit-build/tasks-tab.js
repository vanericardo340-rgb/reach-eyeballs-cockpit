/* ============================= TASKS (ClickUp, two-way) =============================
   Everything here reads from and writes to ClickUp through /api/clickup, so a
   change made in the Cockpit shows up in ClickUp (and the other way round on
   the next refresh). Leads are the ClickUp "Leads" list; notes are ClickUp
   comments, which keep their own timestamps. */
const TK_QUICK_TAG = "quick fire";
const TK = { data:null, loading:false, error:null, at:0, tab:"week", search:"", leadStatus:"all", collapsed:{}, comments:{}, busy:{}, quickList:null };
try{ const s = JSON.parse(localStorage.getItem("cockpit_tasks_ui")||"{}"); if(s.tab) TK.tab = s.tab; if(s.quickList) TK.quickList = s.quickList; if(s.collapsed) TK.collapsed = s.collapsed; }catch(e){}
function tkRemember(){ try{ localStorage.setItem("cockpit_tasks_ui", JSON.stringify({ tab:TK.tab, quickList:TK.quickList, collapsed:TK.collapsed })); }catch(e){} }

async function tkApi(body){
  const { data: { session } } = await sb.auth.getSession();
  if(!session) throw new Error("Sign in to the Cockpit first.");
  const res = await fetch("/api/clickup", { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${session.access_token}` }, body: JSON.stringify(body) });
  const j = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(j.error || `ClickUp request failed (status ${res.status}).`);
  return j;
}
function tkRerender(){ if(activeView==="tasks") renderView(); }
async function tkLoad(force){
  if(TK.loading) return;
  if(!force && TK.data && Date.now()-TK.at < 120000) return;
  TK.loading = true; TK.error = null; tkRerender();
  try{ TK.data = await tkApi({ action:"all" }); }
  catch(e){ TK.error = e.message; }
  TK.at = Date.now(); TK.loading = false; tkRerender();
}

/* ---------- dates ---------- */
const TK_DAY = 86400000;
function tkStartOfDay(d){ const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); }
function tkDayKey(ms){ const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function tkFromKey(key){ const [y,m,d] = key.split("-").map(Number); return new Date(y, m-1, d).getTime(); }
function tkEndOfWeek(){ const now = new Date(); const dow = (now.getDay()+6)%7; return tkStartOfDay(now) + (7-dow)*TK_DAY; }
function tkDueLabel(t){
  if(!t.due) return "";
  const today = tkStartOfDay(Date.now());
  const d = new Date(t.due);
  if(t.due < today) return `<span class="tk-due over">${icon("calendar")} ${d.toLocaleDateString("en-GB",{ day:"numeric", month:"short" })}</span>`;
  if(t.due < today+TK_DAY) return `<span class="tk-due today">${icon("calendar")} ${t.dueHasTime ? d.toLocaleTimeString("en-GB",{ hour:"2-digit", minute:"2-digit" }) : "Today"}</span>`;
  if(t.due < today+2*TK_DAY) return `<span class="tk-due">${icon("calendar")} Tomorrow</span>`;
  return `<span class="tk-due">${icon("calendar")} ${d.toLocaleDateString("en-GB",{ weekday:"short", day:"numeric", month:"short" })}</span>`;
}
function tkStamp(ms){
  const d = new Date(ms); const diff = Date.now()-ms;
  const abs = d.toLocaleString("en-GB",{ weekday:"short", day:"numeric", month:"short", year: d.getFullYear()===new Date().getFullYear()?undefined:"numeric", hour:"2-digit", minute:"2-digit" });
  let rel = "";
  if(diff < 60000) rel = "just now";
  else if(diff < 3600000) rel = `${Math.round(diff/60000)} min ago`;
  else if(diff < TK_DAY) rel = `${Math.round(diff/3600000)} h ago`;
  else if(diff < 30*TK_DAY) rel = `${Math.round(diff/TK_DAY)} d ago`;
  return rel ? `${abs} · ${rel}` : abs;
}

/* ---------- lists & statuses ---------- */
function tkList(id){ return TK.data && (TK.data.lists||[]).find(l=>l.id===id); }
function tkDoneStatus(listId){ const l = tkList(listId); if(!l) return "complete"; const s = l.statuses.find(x=>x.type==="closed") || l.statuses.find(x=>x.type==="done"); return s ? s.status : "complete"; }
function tkOpenStatus(listId){ const l = tkList(listId); const s = l && (l.statuses.find(x=>x.type==="open") || l.statuses[0]); return s ? s.status : "to do"; }
function tkIsDone(t){ return t.statusType==="closed" || t.statusType==="done"; }
function tkFind(id){ if(!TK.data) return null; return TK.data.tasks.find(t=>t.id===id) || TK.data.leads.find(t=>t.id===id); }
function tkIsQuick(t){ return (t.tags||[]).some(g=>/^quick[ -]?fires?$/i.test(g)); }
function tkWorkLists(){ return (TK.data.lists||[]).filter(l=>l.id!==TK.data.leadsListId); }
const TK_PRIO = { urgent:{ n:1, c:"#d8433a", l:"Urgent" }, high:{ n:2, c:"#c97a1f", l:"High" }, normal:{ n:3, c:"#2563EB", l:"Normal" }, low:{ n:4, c:"#8f8d94", l:"Low" } };
const TK_FLAG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 21V4h10l1 2h4v10h-7l-1-2H7v7z"/></svg>`;

/* ---------- updates (optimistic, then ClickUp) ---------- */
function tkApplyLocal(id, changes){ const t = tkFind(id); if(t) Object.assign(t, changes); return t; }
async function tkUpdate(id, changes, local, okMsg){
  const t = tkFind(id); if(!t) return;
  const before = Object.assign({}, t);
  tkApplyLocal(id, local || {}); TK.busy[id] = true; tkRerender(); tkLeadModalRefresh(id);
  try{
    const r = await tkApi({ action:"update", taskId:id, changes });
    if(r.task){ const keep = { fields:t.fields }; Object.assign(t, r.task, r.task.fields && r.task.fields.length ? {} : keep); }
    if(okMsg) toast(okMsg);
  }catch(e){ Object.assign(t, before); toast(e.message); }
  delete TK.busy[id]; tkRerender(); tkLeadModalRefresh(id);
}
function tkToggle(id){
  const t = tkFind(id); if(!t) return;
  const done = tkIsDone(t);
  const status = done ? tkOpenStatus(t.listId) : tkDoneStatus(t.listId);
  const l = tkList(t.listId); const s = l && l.statuses.find(x=>x.status===status);
  tkUpdate(id, { status }, { status, statusType: s ? s.type : (done ? "open" : "closed"), statusColor: s ? s.color : t.statusColor }, done ? "Reopened in ClickUp" : "Completed in ClickUp");
}
function tkSetStatus(id, status){
  const t = tkFind(id); if(!t || t.status===status) return;
  const l = tkList(t.listId); const s = l && l.statuses.find(x=>x.status===status);
  tkUpdate(id, { status }, { status, statusType: s ? s.type : t.statusType, statusColor: s ? s.color : t.statusColor }, `Moved to “${status}”`);
}
async function tkSetField(id, fieldId, value, display){
  const t = tkFind(id); if(!t) return;
  const before = JSON.stringify(t.fields||[]);
  const f = (t.fields||[]).find(x=>x.id===fieldId);
  if(f) f.value = display; else (t.fields = t.fields||[]).push({ id:fieldId, value:display });
  try{ await tkApi({ action:"field", taskId:id, fieldId, value }); toast("Saved to ClickUp"); }
  catch(e){ t.fields = JSON.parse(before); toast(e.message); }
  tkRerender(); tkLeadModalRefresh(id);
}
async function tkCreate(payload, local){
  try{
    const r = await tkApi(Object.assign({ action:"create" }, payload));
    const t = Object.assign({}, r.task, local||{});
    if(payload.listId===TK.data.leadsListId) TK.data.leads.unshift(t); else TK.data.tasks.unshift(t);
    toast("Added to ClickUp"); tkRerender(); return t;
  }catch(e){ toast(e.message); return null; }
}

/* ---------- rows ---------- */
function tkRow(t, opts){
  opts = opts || {};
  const p = t.priority && TK_PRIO[t.priority];
  const done = tkIsDone(t);
  const tags = (t.tags||[]).filter(g=>!opts.hideQuick || !/^quick[ -]?fires?$/i.test(g));
  return `<li class="tk-row ${done?"done":""} ${TK.busy[t.id]?"busy":""}">
    <button class="tk-check ${done?"on":""}" data-tk-toggle="${t.id}" aria-label="${done?"Reopen":"Complete"} ${esc(t.name)}" title="${done?"Reopen":"Mark complete"} in ClickUp">${done?icon("check"):""}</button>
    <button class="tk-main" data-tk-edit="${t.id}">
      <span class="tk-name">${esc(t.name)}</span>
      <span class="tk-meta">
        ${opts.hideList?"":`<span class="tk-list">${esc(t.list||"")}</span>`}
        <span class="tk-status" style="--sc:${t.statusColor||"#8f8d94"}">${esc(t.status||"")}</span>
        ${tags.map(g=>`<span class="tk-tag">#${esc(g)}</span>`).join("")}
      </span>
    </button>
    ${p?`<span class="tk-prio" style="color:${p.c}" title="${p.l} priority">${TK_FLAG}</span>`:""}
    ${tkDueLabel(t)}
    <a class="tk-open" href="${esc(t.url)}" target="_blank" rel="noopener" title="Open in ClickUp" aria-label="Open ${esc(t.name)} in ClickUp">${icon("arrow")}</a>
  </li>`;
}
function tkEmpty(text){ return `<div class="tk-empty">${text}</div>`; }
function tkMatch(t){ const q = TK.search.trim().toLowerCase(); if(!q) return true; return [t.name, t.list, t.status, (t.tags||[]).join(" ")].join(" ").toLowerCase().includes(q); }

/* ---------- sections ---------- */
function tkWeek(){
  const today = tkStartOfDay(Date.now()), end = tkEndOfWeek();
  const tasks = TK.data.tasks.filter(t=>t.due && t.due < end && !tkIsDone(t) && tkMatch(t)).sort((a,b)=>a.due-b.due);
  const over = tasks.filter(t=>t.due < today);
  const byDay = {};
  tasks.filter(t=>t.due >= today).forEach(t=>{ const k = tkDayKey(t.due); (byDay[k] = byDay[k]||[]).push(t); });
  const noDate = TK.data.tasks.filter(t=>!t.due && !tkIsDone(t) && tkMatch(t)).length;
  const groups = [];
  if(over.length) groups.push(`<div class="tk-group"><div class="tk-group-h bad">Overdue <span>${over.length}</span></div><ul class="tk-ul">${over.map(t=>tkRow(t)).join("")}</ul></div>`);
  Object.keys(byDay).sort().forEach(k=>{
    const ms = tkFromKey(k);
    const label = ms===today ? "Today" : ms===today+TK_DAY ? "Tomorrow" : new Date(ms).toLocaleDateString("en-GB",{ weekday:"long", day:"numeric", month:"short" });
    groups.push(`<div class="tk-group"><div class="tk-group-h ${ms===today?"accent":""}">${label} <span>${byDay[k].length}</span></div><ul class="tk-ul">${byDay[k].map(t=>tkRow(t)).join("")}</ul></div>`);
  });
  return `<div class="panel">
    <div class="panel-head"><div><h3>This week</h3><div class="sub">Due by Sunday${over.length?`, plus ${over.length} overdue`:""}. ${noDate?`${noDate} open task${noDate===1?" has":"s have"} no due date (see All tasks).`:""}</div></div>
      <button class="btn sm" data-tk-new="week">${icon("plus")} Add task this week</button></div>
    ${groups.length ? groups.join("") : tkEmpty("Nothing due this week. Give tasks a due date in ClickUp, or add one here.")}
  </div>`;
}
function tkQuickListId(){
  const lists = tkWorkLists();
  if(TK.quickList && lists.some(l=>l.id===TK.quickList)) return TK.quickList;
  const pick = lists.find(l=>/operations/i.test(l.name)) || lists.find(l=>/personal/i.test(l.name)) || lists[0];
  return pick ? pick.id : null;
}
function tkQuick(){
  const all = TK.data.tasks.filter(t=>tkIsQuick(t) && tkMatch(t));
  const open = all.filter(t=>!tkIsDone(t)).sort((a,b)=>(a.due||Infinity)-(b.due||Infinity));
  const qid = tkQuickListId();
  return `<div class="panel">
    <div class="panel-head"><div><h3>Quick fires</h3><div class="sub">Small jobs you can knock out in minutes. Saved in ClickUp with the <b>#${TK_QUICK_TAG}</b> tag.</div></div></div>
    <form class="tk-quick-add" id="tkQuickForm">
      <input id="tkQuickInput" placeholder="Add a quick fire and press Enter…" autocomplete="off" aria-label="New quick fire" />
      <select id="tkQuickList" aria-label="ClickUp list">${tkWorkLists().map(l=>`<option value="${l.id}" ${l.id===qid?"selected":""}>${esc(l.name)}</option>`).join("")}</select>
      <button class="btn primary" type="submit">${icon("bolt")} Add</button>
    </form>
    ${open.length ? `<ul class="tk-ul">${open.map(t=>tkRow(t,{ hideQuick:true })).join("")}</ul>` : tkEmpty("No quick fires. Add one above, or tag any ClickUp task “quick fire”.")}
  </div>`;
}
function tkAll(){
  const lists = tkWorkLists();
  const spaces = [...new Set(lists.map(l=>l.space||"Other"))];
  const open = TK.data.tasks.filter(t=>!tkIsDone(t) && tkMatch(t));
  const orphans = open.filter(t=>!lists.some(l=>l.id===t.listId));
  const sortT = (a,b)=>(a.due||Infinity)-(b.due||Infinity) || (TK_PRIO[a.priority]?.n||5)-(TK_PRIO[b.priority]?.n||5);
  const block = (id, name, items, sub)=>{
    const col = TK.collapsed[id];
    return `<div class="tk-cat">
      <div class="tk-cat-h">
        <button class="tk-cat-toggle" data-tk-collapse="${id}" aria-expanded="${!col}"><span class="tk-chev ${col?"":"open"}">›</span> <b>${esc(name)}</b> <span class="tk-count">${items.length}</span>${sub?`<span class="tk-cat-sub">${esc(sub)}</span>`:""}</button>
        ${id!=="_other"?`<button class="btn ghost sm" data-tk-new="${id}">${icon("plus")} Add</button>`:""}
      </div>
      ${col ? "" : items.length ? `<ul class="tk-ul">${items.sort(sortT).map(t=>tkRow(t,{ hideList:true })).join("")}</ul>` : tkEmpty("No open tasks.")}
    </div>`;
  };
  return spaces.map(sp=>`<div class="panel tk-space">
      <div class="panel-head"><div><h3>${esc(sp)}</h3><div class="sub">${open.filter(t=>lists.some(l=>l.id===t.listId && (l.space||"Other")===sp)).length} open tasks</div></div></div>
      ${lists.filter(l=>(l.space||"Other")===sp).map(l=>block(l.id, l.name, open.filter(t=>t.listId===l.id), l.folder)).join("")}
    </div>`).join("") + (orphans.length ? `<div class="panel tk-space">${block("_other","Other lists",orphans)}</div>` : "");
}

/* ---------- leads ---------- */
function tkLeadField(re, type){ return (TK.data.leadFields||[]).find(f=>(!type || f.type===type) && re.test(f.name)); }
function tkFieldVal(t, f){ if(!f) return null; const x = (t.fields||[]).find(v=>v.id===f.id); return x ? x.value : null; }
function tkOption(f, v){ if(v===null || v===undefined || v==="") return null; return (f.options||[]).find(o=>o.id===v || String(o.orderindex)===String(v)) || null; }
function tkFieldText(t, f){
  const v = tkFieldVal(t, f);
  if(v===null || v===undefined || v==="") return "";
  if(f.type==="drop_down"){ const o = tkOption(f, v); return o ? o.name : ""; }
  if(f.type==="date") return new Date(Number(v)).toLocaleDateString("en-GB",{ day:"numeric", month:"short" });
  if(f.type==="currency") return "£" + Number(v).toLocaleString("en-GB");
  if(f.type==="checkbox") return v===true || v==="true" ? "Yes" : "";
  return String(v);
}
function tkLeads(){
  const L = TK.data.leads || [];
  if(!TK.data.leadsListId) return `<div class="panel">${tkEmpty("No list called “Leads” found in your ClickUp. Create one and refresh.")}</div>`;
  const list = tkList(TK.data.leadsListId);
  const statuses = list ? list.statuses : [];
  const fPhone = tkLeadField(/phone/i, "phone"), fEmail = tkLeadField(/mail/i, "email"), fSource = tkLeadField(/source/i), fValue = tkLeadField(/value|amount/i), fFollow = tkLeadField(/follow/i, "date"), fHot = tkLeadField(/hot/i, "checkbox");
  const matches = L.filter(t=>(TK.leadStatus==="all" ? !tkIsDone(t) : TK.leadStatus==="closed" ? tkIsDone(t) : t.status===TK.leadStatus) && tkMatch(t));
  const today = tkStartOfDay(Date.now());
  const followDue = (t)=>{ const v = tkFieldVal(t, fFollow); return v ? Number(v) : null; };
  matches.sort((a,b)=>{
    const ha = fHot && (tkFieldVal(a,fHot)===true || tkFieldVal(a,fHot)==="true"), hb = fHot && (tkFieldVal(b,fHot)===true || tkFieldVal(b,fHot)==="true");
    if(ha!==hb) return ha ? -1 : 1;
    return (followDue(a)||Infinity)-(followDue(b)||Infinity) || (b.updatedAt||0)-(a.updatedAt||0);
  });
  const chips = [{ k:"all", l:"Open", n:L.filter(t=>!tkIsDone(t)).length }].concat(statuses.filter(s=>s.type!=="closed" && s.type!=="done").map(s=>({ k:s.status, l:s.status, n:L.filter(t=>t.status===s.status).length, c:s.color })), [{ k:"closed", l:"Won / lost / done", n:L.filter(tkIsDone).length }]);
  return `<div class="panel">
    <div class="panel-head"><div><h3>Leads</h3><div class="sub">Your ClickUp Leads list. Status, fields and notes save straight to ClickUp.</div></div>
      <button class="btn primary sm" data-tk-new-lead>${icon("plus")} New lead</button></div>
    <div class="tk-chips">${chips.map(c=>`<button class="tk-chip ${TK.leadStatus===c.k?"active":""}" data-tk-lead-status="${esc(c.k)}">${c.c?`<i style="background:${c.c}"></i>`:""}${esc(c.l)} <span>${c.n}</span></button>`).join("")}</div>
    ${matches.length ? `<ul class="tk-leads">${matches.map(t=>{
      const fu = followDue(t); const hot = fHot && (tkFieldVal(t,fHot)===true || tkFieldVal(t,fHot)==="true");
      const phone = tkFieldText(t, fPhone), email = tkFieldText(t, fEmail);
      return `<li class="tk-lead ${TK.busy[t.id]?"busy":""}">
        <button class="tk-lead-main" data-tk-lead="${t.id}">
          <span class="tk-name">${hot?`<span class="tk-hot" title="Hot lead">${icon("flame")}</span>`:""}${esc(t.name)}</span>
          <span class="tk-meta">
            ${fSource && tkFieldText(t,fSource)?`<span class="tk-tag">${esc(tkFieldText(t,fSource))}</span>`:""}
            ${fValue && tkFieldText(t,fValue)?`<span class="tk-tag">${esc(tkFieldText(t,fValue))}</span>`:""}
            ${fu?`<span class="tk-due ${fu<today?"over":fu<today+TK_DAY?"today":""}">${icon("calendar")} Follow up ${fu<today+TK_DAY && fu>=today?"today":new Date(fu).toLocaleDateString("en-GB",{ day:"numeric", month:"short" })}</span>`:""}
            ${t.updatedAt?`<span class="tk-faint">Updated ${new Date(t.updatedAt).toLocaleDateString("en-GB",{ day:"numeric", month:"short" })}</span>`:""}
          </span>
        </button>
        <div class="tk-lead-actions">
          ${phone?`<a class="icon-btn" href="tel:${esc(phone.replace(/\s/g,""))}" title="Call ${esc(phone)}" aria-label="Call">${icon("phone")}</a>`:""}
          ${email?`<a class="icon-btn" href="mailto:${esc(email)}" title="Email ${esc(email)}" aria-label="Email">${icon("mail")}</a>`:""}
          <select class="tk-status-select" data-tk-status="${t.id}" style="--sc:${t.statusColor||"#8f8d94"}" aria-label="Status for ${esc(t.name)}">${statuses.map(s=>`<option value="${esc(s.status)}" ${s.status===t.status?"selected":""}>${esc(s.status)}</option>`).join("")}</select>
          <button class="btn sm" data-tk-lead="${t.id}">${icon("edit")} Notes</button>
        </div>
      </li>`; }).join("")}</ul>` : tkEmpty(TK.search ? "No leads match your search." : "No leads in this stage.")}
  </div>`;
}

/* ---------- lead drawer: fields + note history ---------- */
let TK_OPEN_LEAD = null;
function tkFieldInput(t, f){
  const v = tkFieldVal(t, f);
  const id = `tkf_${f.id}`;
  if(f.type==="drop_down"){ const o = tkOption(f, v); return `<select id="${id}" data-tk-field="${f.id}" data-type="drop_down"><option value="">—</option>${f.options.map(x=>`<option value="${x.id}" ${o&&o.id===x.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select>`; }
  if(f.type==="date") return `<input type="date" id="${id}" data-tk-field="${f.id}" data-type="date" value="${v?tkDayKey(Number(v)):""}" />`;
  if(f.type==="checkbox") return `<label class="tk-checkbox"><input type="checkbox" id="${id}" data-tk-field="${f.id}" data-type="checkbox" ${v===true||v==="true"?"checked":""} /> Yes</label>`;
  if(f.type==="currency" || f.type==="number") return `<input type="number" step="any" id="${id}" data-tk-field="${f.id}" data-type="number" value="${v!==null&&v!==undefined?esc(v):""}" />`;
  if(["email","phone","short_text","text","url"].includes(f.type)) return `<input type="${f.type==="email"?"email":f.type==="phone"?"tel":"text"}" id="${id}" data-tk-field="${f.id}" data-type="${f.type}" value="${v?esc(v):""}" ${f.type==="phone"?'placeholder="+44…"':""} />`;
  return `<div class="tk-faint">${esc(tkFieldText(t,f)) || "—"}</div>`;
}
function tkLeadModalHtml(t){
  const list = tkList(t.listId);
  const cm = TK.comments[t.id];
  return `
    <div class="modal-head"><div><h3>${esc(t.name)}</h3><div class="tk-faint">Lead · ${esc(t.status||"")}${t.createdAt?` · added ${new Date(t.createdAt).toLocaleDateString("en-GB",{ day:"numeric", month:"short", year:"numeric" })}`:""}</div></div><button class="icon-btn" id="modalClose" aria-label="Close">${icon("x")}</button></div>
    <div class="modal-body tk-lead-body">
      <div class="tk-lead-grid">
        <div class="field field-span2"><label for="tkLeadName">Name</label><input id="tkLeadName" value="${esc(t.name)}" /></div>
        <div class="field"><label for="tkLeadStatus">Status</label><select id="tkLeadStatus">${(list?list.statuses:[]).map(s=>`<option value="${esc(s.status)}" ${s.status===t.status?"selected":""}>${esc(s.status)}</option>`).join("")}</select></div>
        ${(TK.data.leadFields||[]).map(f=>`<div class="field"><label for="tkf_${f.id}">${esc(f.name)}</label>${tkFieldInput(t,f)}</div>`).join("")}
      </div>
      <div class="tk-notes">
        <div class="tk-notes-h"><b>Notes</b><span class="tk-faint">Saved as ClickUp comments, with the time they were added</span></div>
        <div class="tk-note-new">
          <textarea id="tkNoteText" placeholder="What happened? Next step?" rows="3"></textarea>
          <button class="btn primary" id="tkNoteAdd">${icon("plus")} Add note</button>
        </div>
        ${!cm ? `<div class="tk-faint" style="padding:10px 2px">Loading note history…</div>` : cm.error ? `<div class="tk-err">${esc(cm.error)}</div>` : cm.items.length ? `<ol class="tk-history">${cm.items.slice().sort((a,b)=>b.date-a.date).map(c=>`<li><div class="tk-when">${esc(tkStamp(c.date))}${c.user?` · ${esc(c.user)}`:""}</div><div class="tk-note-text">${esc(c.text).replace(/\n/g,"<br>")}</div></li>`).join("")}</ol>` : `<div class="tk-faint" style="padding:10px 2px">No notes yet. Your first note starts the history.</div>`}
      </div>
    </div>
    <div class="modal-foot">
      <a class="btn ghost" href="${esc(t.url)}" target="_blank" rel="noopener">${icon("arrow")} Open in ClickUp</a>
      <button class="btn primary" id="modalCancel">Done</button>
    </div>`;
}
function tkBindLeadModal(t){
  const m = document.querySelector("#modalOverlay .modal"); if(!m) return;
  document.getElementById("modalClose").onclick = ()=>{ TK_OPEN_LEAD = null; closeModal(); };
  document.getElementById("modalCancel").onclick = ()=>{ TK_OPEN_LEAD = null; closeModal(); };
  const name = document.getElementById("tkLeadName");
  name.onchange = ()=>{ const v = name.value.trim(); if(v && v!==t.name) tkUpdate(t.id, { name:v }, { name:v }, "Renamed in ClickUp"); };
  document.getElementById("tkLeadStatus").onchange = (e)=>tkSetStatus(t.id, e.target.value);
  m.querySelectorAll("[data-tk-field]").forEach(el=>{
    el.onchange = ()=>{
      const f = TK.data.leadFields.find(x=>x.id===el.dataset.tkField); const type = el.dataset.type;
      let value, display;
      if(type==="checkbox"){ value = el.checked; display = el.checked; }
      else if(type==="date"){ value = el.value ? tkFromKey(el.value) : null; display = value; }
      else if(type==="number"){ value = el.value==="" ? null : Number(el.value); display = value; }
      else if(type==="drop_down"){ value = el.value || null; const o = f.options.find(x=>x.id===el.value); display = o ? o.orderindex : null; }
      else { value = el.value.trim() || null; display = value; }
      tkSetField(t.id, f.id, value, display);
    };
  });
  const add = document.getElementById("tkNoteAdd"), txt = document.getElementById("tkNoteText");
  const submit = async ()=>{
    const text = txt.value.trim(); if(!text){ txt.focus(); return; }
    add.disabled = true;
    try{
      const r = await tkApi({ action:"comment", taskId:t.id, text });
      const cm = TK.comments[t.id] || (TK.comments[t.id] = { items:[] });
      cm.items = (cm.items||[]).concat([r.comment]); delete cm.error;
      t.updatedAt = Date.now();
      toast("Note saved to ClickUp"); tkLeadModalRefresh(t.id, true); tkRerender();
    }catch(e){ toast(e.message); add.disabled = false; }
  };
  add.onclick = submit;
  txt.onkeydown = (e)=>{ if(e.key==="Enter" && (e.metaKey||e.ctrlKey)){ e.preventDefault(); submit(); } };
}
function tkLeadModalRefresh(id, clearDraft){
  if(TK_OPEN_LEAD!==id) return;
  const m = document.querySelector("#modalOverlay .modal"); const t = tkFind(id); if(!m || !t) return;
  const draft = !clearDraft && document.getElementById("tkNoteText") ? document.getElementById("tkNoteText").value : "";
  const scroll = m.querySelector(".modal-body") ? m.querySelector(".modal-body").scrollTop : 0;
  m.innerHTML = tkLeadModalHtml(t);
  const n = document.getElementById("tkNoteText"); if(n) n.value = draft;
  if(m.querySelector(".modal-body")) m.querySelector(".modal-body").scrollTop = scroll;
  tkBindLeadModal(t);
}
async function tkOpenLead(id){
  const t = tkFind(id); if(!t) return;
  TK_OPEN_LEAD = id;
  openModal(tkLeadModalHtml(t));
  document.querySelector("#modalOverlay .modal").classList.add("tk-modal");
  tkBindLeadModal(t);
  try{ const r = await tkApi({ action:"comments", taskId:id }); TK.comments[id] = { items:r.comments }; }
  catch(e){ TK.comments[id] = { items:[], error:e.message }; }
  tkLeadModalRefresh(id);
}
function tkNewLeadModal(){
  const fPhone = tkLeadField(/phone/i, "phone"), fEmail = tkLeadField(/mail/i, "email"), fSource = tkLeadField(/source/i, "drop_down");
  const list = tkList(TK.data.leadsListId);
  openModal(`
    <div class="modal-head"><h3>New lead</h3><button class="icon-btn" id="modalClose" aria-label="Close">${icon("x")}</button></div>
    <div class="modal-body"><div class="form-grid">
      <div class="field field-span2"><label for="tkNL_name">Name</label><input id="tkNL_name" placeholder="e.g. José Cordeiro" /></div>
      ${fPhone?`<div class="field"><label for="tkNL_phone">Phone</label><input id="tkNL_phone" type="tel" placeholder="+44…" /></div>`:""}
      ${fEmail?`<div class="field"><label for="tkNL_email">Email</label><input id="tkNL_email" type="email" /></div>`:""}
      ${fSource?`<div class="field"><label for="tkNL_source">${esc(fSource.name)}</label><select id="tkNL_source"><option value="">—</option>${fSource.options.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></div>`:""}
      <div class="field"><label for="tkNL_status">Status</label><select id="tkNL_status">${(list?list.statuses:[]).filter(s=>s.type!=="closed").map(s=>`<option value="${esc(s.status)}">${esc(s.status)}</option>`).join("")}</select></div>
      <div class="field field-span2"><label for="tkNL_note">First note (optional)</label><textarea id="tkNL_note"></textarea></div>
    </div></div>
    <div class="modal-foot"><button class="btn ghost" id="modalCancel">Cancel</button><button class="btn primary" id="modalSave">Add lead to ClickUp</button></div>`);
  document.getElementById("modalClose").onclick = closeModal;
  document.getElementById("modalCancel").onclick = closeModal;
  document.getElementById("modalSave").onclick = async ()=>{
    const name = document.getElementById("tkNL_name").value.trim();
    if(!name){ toast("Give the lead a name"); return; }
    const fields = {}; const local = [];
    const put = (f, el, disp)=>{ if(f && el && el.value.trim()){ fields[f.id] = el.value.trim(); local.push({ id:f.id, value: disp!==undefined?disp:el.value.trim() }); } };
    put(fPhone, document.getElementById("tkNL_phone")); put(fEmail, document.getElementById("tkNL_email"));
    if(fSource){ const el = document.getElementById("tkNL_source"); const o = fSource.options.find(x=>x.id===el.value); if(o){ fields[fSource.id] = o.id; local.push({ id:fSource.id, value:o.orderindex }); } }
    const status = document.getElementById("tkNL_status").value;
    const note = document.getElementById("tkNL_note").value.trim();
    document.getElementById("modalSave").disabled = true;
    const t = await tkCreate({ listId:TK.data.leadsListId, name, status, fields }, { fields:local });
    if(t && note){ try{ const r = await tkApi({ action:"comment", taskId:t.id, text:note }); TK.comments[t.id] = { items:[r.comment] }; }catch(e){ toast(e.message); } }
    closeModal(); TK.leadStatus = "all"; tkRerender();
  };
  setTimeout(()=>document.getElementById("tkNL_name").focus(), 0);
}

/* ---------- task editor ---------- */
function tkTaskModal(id, presetListId, presetDue){
  const t = id ? tkFind(id) : null;
  const lists = tkWorkLists();
  const listId = t ? t.listId : (presetListId || tkQuickListId());
  const list = tkList(listId);
  openModal(`
    <div class="modal-head"><h3>${t?"Edit task":"New task"}</h3><button class="icon-btn" id="modalClose" aria-label="Close">${icon("x")}</button></div>
    <div class="modal-body"><div class="form-grid">
      <div class="field field-span2"><label for="tkT_name">Task</label><input id="tkT_name" value="${t?esc(t.name):""}" /></div>
      <div class="field"><label for="tkT_list">List</label><select id="tkT_list" ${t?"disabled":""}>${lists.map(l=>`<option value="${l.id}" ${l.id===listId?"selected":""}>${esc(l.name)}</option>`).join("")}</select></div>
      ${t?`<div class="field"><label for="tkT_status">Status</label><select id="tkT_status">${(list?list.statuses:[]).map(s=>`<option value="${esc(s.status)}" ${s.status===t.status?"selected":""}>${esc(s.status)}</option>`).join("")}</select></div>`:`<div class="field"><label class="tk-checkbox" style="margin-top:22px"><input type="checkbox" id="tkT_quick" /> Quick fire</label></div>`}
      <div class="field"><label for="tkT_due">Due date</label><input type="date" id="tkT_due" value="${t&&t.due?tkDayKey(t.due):presetDue||""}" /></div>
      <div class="field"><label for="tkT_prio">Priority</label><select id="tkT_prio"><option value="">None</option>${Object.entries(TK_PRIO).map(([k,p])=>`<option value="${p.n}" ${t&&t.priority===k?"selected":""}>${p.l}</option>`).join("")}</select></div>
      ${t&&t.description?`<div class="field field-span2"><label>Description</label><div class="tk-desc">${esc(t.description).replace(/\n/g,"<br>")}</div></div>`:""}
      ${!t?`<div class="field field-span2"><label for="tkT_desc">Description (optional)</label><textarea id="tkT_desc"></textarea></div>`:""}
    </div></div>
    <div class="modal-foot">
      ${t?`<a class="btn ghost" href="${esc(t.url)}" target="_blank" rel="noopener">${icon("arrow")} Open in ClickUp</a>`:""}
      <button class="btn ghost" id="modalCancel">Cancel</button>
      <button class="btn primary" id="modalSave">${t?"Save to ClickUp":"Add to ClickUp"}</button>
    </div>`);
  document.getElementById("modalClose").onclick = closeModal;
  document.getElementById("modalCancel").onclick = closeModal;
  document.getElementById("modalSave").onclick = async ()=>{
    const name = document.getElementById("tkT_name").value.trim();
    if(!name){ toast("Give the task a name"); return; }
    const dueKey = document.getElementById("tkT_due").value;
    const due = dueKey ? tkFromKey(dueKey) : null;
    const prio = document.getElementById("tkT_prio").value;
    const prioKey = Object.keys(TK_PRIO).find(k=>String(TK_PRIO[k].n)===prio) || null;
    if(t){
      const changes = {}, local = {};
      if(name!==t.name){ changes.name = name; local.name = name; }
      const st = document.getElementById("tkT_status").value;
      if(st!==t.status){ changes.status = st; const s = list && list.statuses.find(x=>x.status===st); Object.assign(local, { status:st, statusType: s?s.type:t.statusType, statusColor: s?s.color:t.statusColor }); }
      if((t.due?tkDayKey(t.due):"")!==dueKey){ changes.due = due; local.due = due; local.dueHasTime = false; }
      if((t.priority||null)!==prioKey){ changes.priority = prio ? Number(prio) : null; local.priority = prioKey; }
      closeModal();
      if(Object.keys(changes).length) tkUpdate(t.id, changes, local, "Saved to ClickUp");
    } else {
      const quick = document.getElementById("tkT_quick").checked;
      const payload = { listId: document.getElementById("tkT_list").value, name, due, priority: prio ? Number(prio) : undefined, tags: quick ? [TK_QUICK_TAG] : [], description: document.getElementById("tkT_desc").value };
      document.getElementById("modalSave").disabled = true;
      const l = tkList(payload.listId);
      await tkCreate(payload, { list: l ? l.name : null, listId: payload.listId, tags: payload.tags, due, priority: prioKey });
      closeModal();
    }
  };
  setTimeout(()=>document.getElementById("tkT_name").focus(), 0);
}

/* ---------- connect ---------- */
function tkConnectPanel(){
  return `<div class="panel tk-connect">
    <div class="panel-head"><div><h3>Connect ClickUp</h3><div class="sub">One-time setup. Your token is saved to your Cockpit account only, and used from the server.</div></div></div>
    <ol class="tk-steps">
      <li>In ClickUp, click your avatar (bottom left) → <b>Settings</b> → <b>Apps</b>.</li>
      <li>Under <b>API Token</b>, click <b>Generate</b> (or Copy). It starts with <code>pk_</code>.</li>
      <li>Paste it here and click Connect.</li>
    </ol>
    <form class="tk-quick-add" id="tkConnectForm">
      <input id="tkToken" type="password" placeholder="pk_…" autocomplete="off" aria-label="ClickUp personal API token" />
      <button class="btn primary" type="submit">Connect</button>
    </form>
  </div>`;
}

/* ---------- view ---------- */
function viewTasks(){
  if(!TK.loading && (TK.data ? Date.now()-TK.at > 120000 : !TK.error)) setTimeout(()=>tkLoad(false), 0);
  const d = TK.data;
  const connected = d && d.connected !== false;
  const counts = connected ? {
    week: d.tasks.filter(t=>t.due && t.due < tkEndOfWeek() && !tkIsDone(t)).length,
    quick: d.tasks.filter(t=>tkIsQuick(t) && !tkIsDone(t)).length,
    all: d.tasks.filter(t=>!tkIsDone(t)).length,
    leads: (d.leads||[]).filter(t=>!tkIsDone(t)).length,
  } : {};
  const tabs = [["week","This week","calendar"],["quick","Quick fires","bolt"],["all","All tasks","list"],["leads","Leads","users"]];
  let body;
  if(!d && TK.loading) body = `<div class="panel">${tkEmpty("Loading your ClickUp tasks…")}</div>`;
  else if(TK.error && !d) body = `<div class="panel"><div class="tk-err">${esc(TK.error)}</div><button class="btn sm" data-tk-refresh>Try again</button></div>`;
  else if(d && d.connected === false) body = tkConnectPanel();
  else if(d) body = (TK.error?`<div class="tk-err" style="margin-bottom:12px">${esc(TK.error)}</div>`:"") + (TK.tab==="week" ? tkWeek() : TK.tab==="quick" ? tkQuick() : TK.tab==="all" ? tkAll() : tkLeads());
  else body = "";
  return `
    <div class="topbar">
      <div><h1>Tasks</h1><div class="sub">${connected ? `Synced with ClickUp${d.user?` as ${esc(d.user)}`:""} · updated ${new Date(TK.at||Date.now()).toLocaleTimeString("en-GB",{ hour:"2-digit", minute:"2-digit" })}` : "Two-way sync with ClickUp"}</div></div>
      <div class="topbar-right">
        ${connected?`<div class="tk-search">${icon("search")}<input id="tkSearch" placeholder="Search tasks & leads" value="${esc(TK.search)}" aria-label="Search tasks and leads" /></div>
        <button class="btn" data-tk-refresh ${TK.loading?"disabled":""}>${TK.loading?"Syncing…":"Refresh"}</button>
        <button class="btn primary" data-tk-new="">${icon("plus")} New task</button>`:""}
      </div>
    </div>
    <div class="content tk-content">
      ${connected?`<div class="b2b-tabbar tk-tabs" role="tablist">${tabs.map(([k,l,ic])=>`<button class="b2b-tab ${TK.tab===k?"active":""}" role="tab" aria-selected="${TK.tab===k}" data-tk-tab="${k}">${icon(ic)} ${l} <span class="tk-count">${counts[k]}</span></button>`).join("")}</div>`:""}
      ${body}
      ${connected?`<p class="tk-foot">Ticking, editing or adding here updates ClickUp straight away. Changes made in ClickUp appear when you refresh (or every couple of minutes). <button class="tk-link" data-tk-disconnect>Disconnect ClickUp</button></p>`:""}
    </div>`;
}
function tkBind(){
  const root = document.getElementById("viewhost");
  root.querySelectorAll("[data-tk-tab]").forEach(el=>el.onclick = ()=>{ TK.tab = el.dataset.tkTab; tkRemember(); renderView(); });
  root.querySelectorAll("[data-tk-refresh]").forEach(el=>el.onclick = ()=>tkLoad(true));
  root.querySelectorAll("[data-tk-toggle]").forEach(el=>el.onclick = ()=>tkToggle(el.dataset.tkToggle));
  root.querySelectorAll("[data-tk-edit]").forEach(el=>el.onclick = ()=>tkTaskModal(el.dataset.tkEdit));
  root.querySelectorAll("[data-tk-new]").forEach(el=>el.onclick = ()=>{
    const v = el.dataset.tkNew;
    if(v==="week") tkTaskModal(null, null, tkDayKey(Date.now()));
    else tkTaskModal(null, v || null);
  });
  root.querySelectorAll("[data-tk-collapse]").forEach(el=>el.onclick = ()=>{ const k = el.dataset.tkCollapse; TK.collapsed[k] = !TK.collapsed[k]; tkRemember(); renderView(); });
  root.querySelectorAll("[data-tk-lead]").forEach(el=>el.onclick = ()=>tkOpenLead(el.dataset.tkLead));
  root.querySelectorAll("[data-tk-lead-status]").forEach(el=>el.onclick = ()=>{ TK.leadStatus = el.dataset.tkLeadStatus; renderView(); });
  root.querySelectorAll("[data-tk-status]").forEach(el=>el.onchange = ()=>tkSetStatus(el.dataset.tkStatus, el.value));
  root.querySelectorAll("[data-tk-new-lead]").forEach(el=>el.onclick = tkNewLeadModal);
  root.querySelectorAll("[data-tk-disconnect]").forEach(el=>el.onclick = async ()=>{
    if(!confirm("Disconnect ClickUp from the Cockpit? Your ClickUp data isn’t touched.")) return;
    try{ await tkApi({ action:"disconnect" }); TK.data = null; TK.at = 0; tkLoad(true); }catch(e){ toast(e.message); }
  });
  const search = document.getElementById("tkSearch");
  if(search){
    search.oninput = ()=>{ TK.search = search.value; clearTimeout(tkBind._t); tkBind._t = setTimeout(()=>{ const pos = search.selectionStart; renderView(); const s2 = document.getElementById("tkSearch"); if(s2){ s2.focus(); s2.setSelectionRange(pos,pos); } }, 200); };
  }
  const qf = document.getElementById("tkQuickForm");
  if(qf){
    const sel = document.getElementById("tkQuickList");
    sel.onchange = ()=>{ TK.quickList = sel.value; tkRemember(); };
    qf.onsubmit = async (e)=>{
      e.preventDefault();
      const input = document.getElementById("tkQuickInput"); const name = input.value.trim();
      if(!name) return;
      input.value = ""; input.disabled = true;
      const l = tkList(sel.value);
      await tkCreate({ listId: sel.value, name, tags:[TK_QUICK_TAG], due: tkStartOfDay(Date.now()) }, { list: l?l.name:null, listId: sel.value, tags:[TK_QUICK_TAG] });
      const again = document.getElementById("tkQuickInput"); if(again) again.focus();
    };
  }
  const cf = document.getElementById("tkConnectForm");
  if(cf){
    cf.onsubmit = async (e)=>{
      e.preventDefault();
      const token = document.getElementById("tkToken").value.trim();
      if(!/^pk_[\w-]{10,}$/.test(token)){ toast("That doesn’t look like a ClickUp token. It starts with pk_."); return; }
      try{ const r = await tkApi({ action:"connect", token }); toast(`Connected as ${r.user}`); TK.data = null; TK.at = 0; tkLoad(true); }
      catch(err){ toast(err.message); }
    };
  }
}
setInterval(()=>{ if(activeView==="tasks" && !document.getElementById("modalOverlay") && document.visibilityState==="visible") tkLoad(true); }, 180000);
