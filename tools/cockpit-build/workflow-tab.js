/* ============================= DAILY WORKFLOW =============================
   Starts from "Tab 1" of the "Daily Workflow" Google Doc (same blocks, bold
   items, nested lists and links) and is fully editable: blocks, lines,
   sub-lines, Must-do flags, link buttons and the "Required to Maximise
   Results" box. Each line can be ticked off for today; ticks reset daily.
   The layout and ticks are saved to the account (app_state "daily_workflow"). */
const WF_DOC_URL = "https://docs.google.com/document/d/1Yq9quEaXRPoTHOmqt-C3yrCqd2V_XdWtI0u0_EOvHJo/edit";
const WF_CALORIES = "https://docs.google.com/spreadsheets/d/1iCwTZE_tvxvSH6dZ_HIpqBgHZfFtU7y31zy9u4R8Rbc/edit?gid=1261861603#gid=1261861603";
const WF_VISIONBOARD = "https://miro.com/app/board/uXjVHzqUhL0=/";
const WF_HABITS = "https://docs.google.com/spreadsheets/d/1oy87k-M8WIfdGSo_UH5mzimzVyzHS5m6yCWMC61GBGw/edit?gid=745588771#gid=745588771";
const WF_EOD = "https://drive.google.com/open?id=1labEfX3TmJlsJVSXsSJ71_whiHctKBPkRx6v-qJNgQQ";
const WF_SALES_WORKFLOW = "https://docs.google.com/document/d/1jidXaXPwR0JIHwqkVK0u6Xb1PYarW9-bCexDAmG_16I/edit?tab=t.0";
const WF_SALES_SHEET = "https://docs.google.com/spreadsheets/d/1OSjuZtQnsIAdIyXR7_JebWZa6d2ZFQmNJqZqg2883OU/edit?pli=1&gid=826704425#gid=826704425";
const WF_COLORS = ["violet","amber","teal","gold","indigo","rose"];
const WF_ICONS = ["sun","bolt","fork","target","moon","list","heart","calendar","phone","headset","book","users","briefcase","dumbbell","coins"];

/* The starting layout (Tab 1 of the doc). b = Must do; b2 = bold; label = a
   heading line without a tick-box; link = the whole line opens a link;
   btns = link buttons after the text; kids = sub-lines. */
function wfDefaultModel(){
  const P = [ { t:"Call/Message Old Leads" }, { t:"Call/Message leads that didn’t show" }, { t:"Call/Message leads that didn’t close" }, { t:"Leads that never booked" } ];
  const m = { blocks:[
    { id:"dawn", title:"Dawn", sub:"DAWN - 4 am", from:"04:00", to:"07:00", color:"violet", icon:"sun", items:[
      { t:"Read Visionboard 4:00 - 4:30", btns:[ { label:"Open Visionboard", href:WF_VISIONBOARD } ] },
      { t:"Read Book - 4:30 - 5:30" },
      { t:"Apply to Sales Calls 5:30 - 7:00", btns:[ { label:"Workflow", href:WF_SALES_WORKFLOW }, { label:"Sales job sheet", href:WF_SALES_SHEET } ] },
    ]},
    { id:"morning", title:"Morning", sub:"MORNING", from:"07:00", to:"12:00", color:"amber", icon:"bolt", items:[
      { t:"Correr: 7:00 - 8:30", b:true },
      { t:"Outreach Block - 8:30-10:30", b:true, kids:[ { t:"Clients Leads" }, { t:"Cold Calling (90min) - 30 - 40 conversations" } ] },
    ]},
    { id:"lunch", title:"Lunch", sub:"LUNCH", from:"12:00", to:"14:00", color:"teal", icon:"fork", items:[
      { t:"Educational Content (Cole Gordon/Charlie/Ultra influence) / Watch Salescall/Coaching Call (Cole Gordon, Louis, Scott)" },
    ]},
    { id:"golden", title:"Golden Hours", sub:"2pm - 8pm - GOLDEN HOURS", from:"14:00", to:"20:00", color:"gold", icon:"target", items:[
      { t:"Sales Calls or Prospecting", kids:[ { t:"Prospecting checklist:", label:true, kids:P } ] },
    ]},
    { id:"evening", title:"Afternoon / Evening", sub:"AFTERNOON/EVENING", from:"20:00", to:"23:59", timeLabel:"After 20:00", color:"indigo", icon:"moon", items:[
      { t:"Confirm leads of the next day" },
      { t:"Read", b2:true },
      { t:"Service Delivery", b2:true },
      { t:"Fill out EOD Report", b:true, kids:[ { t:"CALORIE TRACKER", link:WF_CALORIES }, { t:"End of Day Report | Vanessa Daily Metrics", link:WF_EOD }, { t:"HABIT TRACKER", link:WF_HABITS } ] },
    ]},
    { id:"dinner", title:"Dinner", sub:"DINNER", from:"", to:"", timeLabel:"Dinner", color:"rose", icon:"fork", items:[
      { t:"Educational Content (Cole Gordon/Charlie/Ultra influence)" },
    ]},
  ], required:{ h:"Required to Maximise Results", groups:[
    { h:"Cold Calling", items:[ "Cold Call to only online meeting (+run mini discovery on cold call)", "Send portfolio after cold calling", "Confirm the next day/ the day of the meeting", "Setting up automatic reminders" ] },
    { h:"Sales Call", items:[ "Preparing for sales call beforehand by practicing script", "Having a slide deck with price deck on it and selling on right away on call", "Following the full sales process (outcome based)" ] },
  ]}};
  // Same ids as before editing existed (t1.<block>.<path>), so today's ticks carry over.
  const walk = (items, prefix)=>items.forEach((it,i)=>{ it.id = `${prefix}.${i}`; if(it.kids) walk(it.kids, it.id); });
  m.blocks.forEach(b=>{ if(b.id==="lunch" || b.id==="dinner") b.items[0].id = `t1.${b.id}`; else walk(b.items, `t1.${b.id}`); });
  return m;
}

const WF = { ticks:{}, model:null, custom:false, loaded:false, editing:false, draft:null };
function wfModel(){ return WF.model || (WF.model = wfDefaultModel()); }
function wfToday(){ return todayStr(); }
function wfTicked(id){ return (WF.ticks[wfToday()]||[]).includes(id); }
function wfUid(){ return "u" + Math.random().toString(36).slice(2, 10); }
function wfSafeUrl(u){ u = String(u||"").trim(); return /^https?:\/\//i.test(u) ? u : ""; }

async function wfLoad(){
  if(WF.loaded) return;
  WF.loaded = true;
  try{
    const { data } = await sb.from("app_state").select("value").eq("key","daily_workflow").maybeSingle();
    const v = data && data.value;
    if(v && v.ticks) WF.ticks = v.ticks;
    if(v && v.model && Array.isArray(v.model.blocks)){ WF.model = v.model; WF.custom = true; }
  }catch(e){
    try{ WF.ticks = JSON.parse(localStorage.getItem("cockpit_wf_ticks")||"{}"); }catch(_){}
    try{ const m = JSON.parse(localStorage.getItem("cockpit_wf_model")||"null"); if(m && m.blocks){ WF.model = m; WF.custom = true; } }catch(_){}
  }
  if(activeView==="workflow" && !WF.editing) renderView();
}
let wfSaveT = null;
function wfSave(){
  const t = wfToday();
  Object.keys(WF.ticks).forEach(k=>{ if(k < addDays(t,-30)) delete WF.ticks[k]; }); // keep a month of history
  try{ localStorage.setItem("cockpit_wf_ticks", JSON.stringify(WF.ticks)); localStorage.setItem("cockpit_wf_model", JSON.stringify(WF.custom ? WF.model : null)); }catch(e){}
  clearTimeout(wfSaveT);
  wfSaveT = setTimeout(async ()=>{
    try{
      const { data: { session } } = await sb.auth.getSession(); if(!session) return;
      await sb.from("app_state").upsert({ user_id: session.user.id, key:"daily_workflow", value:{ ticks:WF.ticks, model: WF.custom ? WF.model : null }, updated_at:new Date().toISOString() }, { onConflict:"user_id,key" });
    }catch(e){ console.warn("daily workflow save failed", e); toast("Couldn’t save the workflow. Check your connection."); }
  }, 500);
}
function wfToggle(id){
  const t = wfToday(); const list = new Set(WF.ticks[t]||[]);
  list.has(id) ? list.delete(id) : list.add(id);
  WF.ticks[t] = [...list]; wfSave(); renderView();
}
function wfNowMin(){ const d = new Date(); return d.getHours()*60 + d.getMinutes(); }
function wfMin(hm){ const [h,m] = String(hm||"").split(":").map(Number); return (h||0)*60+(m||0); }
function wfCurrentBlock(m){ const n = wfNowMin(); const b = m.blocks.find(b=>b.from && b.to && n>=wfMin(b.from) && n<wfMin(b.to)); return b ? b.id : null; }
function wfTimeLabel(b){ return b.timeLabel || (b.from && b.to ? `${b.from} – ${b.to}` : ""); }
function wfWalk(items, fn){ (items||[]).forEach(it=>{ fn(it); if(it.kids) wfWalk(it.kids, fn); }); }
function wfAllIds(m){ const out = []; m.blocks.forEach(b=>wfWalk(b.items, it=>{ if(!it.label) out.push(it.id); })); return out; }
function wfCount(items){ let n = 0, d = 0; wfWalk(items, it=>{ if(!it.label){ n++; if(wfTicked(it.id)) d++; } }); return { n, d }; }

/* ---------- view ---------- */
function wfItems(items, depth){
  return `<ul class="wf-ul d${Math.min(depth,2)}">${items.map(it=>{
    const on = !it.label && wfTicked(it.id);
    const href = wfSafeUrl(it.link);
    const btns = (it.btns||[]).filter(x=>wfSafeUrl(x.href)).map(x=>`<a class="wf-btn" href="${esc(wfSafeUrl(x.href))}" target="_blank" rel="noopener">${esc(x.label||"Open")} ${icon("arrow")}</a>`).join("");
    const body = href
      ? `<a class="wf-link" href="${esc(href)}" target="_blank" rel="noopener">${icon("link")} ${esc(it.t)}</a>${btns}`
      : `<span class="${it.b?"wf-must":it.b2?"wf-strong":it.label?"wf-label":""}">${esc(it.t)}</span>${it.b?`<span class="wf-must-tag">Must do</span>`:""}${btns}`;
    return `<li class="${on?"done":""} ${it.label?"label":""} ${it.b?"must":""}">
      <div class="wf-line">
        ${it.label ? `<span class="wf-dot" aria-hidden="true"></span>` : `<button type="button" class="wf-check ${on?"on":""}" data-wf-tick="${esc(it.id)}" role="checkbox" aria-checked="${on}" aria-label="${esc(it.t)}">${icon("check")}</button>`}
        <div class="wf-txt">${body}</div>
      </div>
      ${it.kids && it.kids.length ? wfItems(it.kids, depth+1) : ""}
    </li>`;
  }).join("")}</ul>`;
}
function wfBlockCard(b, isNow){
  const color = WF_COLORS.includes(b.color) ? b.color : "violet";
  const c = wfCount(b.items);
  const complete = c.n && c.d===c.n;
  const sub = String(b.sub||"").replace(/:$/,"");
  const same = sub.replace(/[^a-z]/gi,"").toLowerCase()===String(b.title||"").replace(/[^a-z]/gi,"").toLowerCase();
  return `<section class="wf-card c-${color} ${isNow?"now":""} ${complete?"complete":""}" data-block="${esc(b.id)}">
    <header class="wf-card-h">
      <span class="wf-ic ${color}">${icon(WF_ICONS.includes(b.icon)?b.icon:"list")}</span>
      <div class="wf-card-t"><h2>${esc(b.title||"Untitled")}</h2>${sub && !same ? `<span class="wf-card-sub">${esc(sub)}</span>` : ""}</div>
      <div class="wf-card-r">
        ${isNow?`<span class="wf-now"><i></i>Now</span>`:""}
        ${wfTimeLabel(b)?`<span class="wf-time">${esc(wfTimeLabel(b))}</span>`:""}
        <span class="wf-mini ${complete?"full":""}" title="${c.d} of ${c.n} done">${complete?icon("check"):`${c.d}/${c.n}`}</span>
      </div>
    </header>
    <div class="wf-card-b">${b.items && b.items.length ? wfItems(b.items, 0) : `<p class="tk-faint">Nothing in this block yet. Use Edit to add lines.</p>`}</div>
  </section>`;
}
function wfRequired(r){
  if(!r || !(r.groups||[]).length) return "";
  return `<section class="wf-required" aria-label="${esc(r.h)}">
    <div class="wf-req-h"><span class="wf-req-ic">${icon("bolt")}</span><div><h2>${esc(String(r.h||"").replace(/:$/,""))}</h2><p>Keep these in mind on every call.</p></div></div>
    <div class="wf-req-grid">${r.groups.map(g=>`<div class="wf-req-g">
      <h3>${icon(/sales/i.test(g.h)?"headset":/call/i.test(g.h)?"phone":"bolt")} ${esc(g.h)}</h3>
      <ul>${(g.items||[]).filter(x=>String(x).trim()).map(x=>`<li>${icon("check")}<span>${esc(x)}</span></li>`).join("")}</ul>
    </div>`).join("")}</div>
  </section>`;
}
function viewWorkflow(){
  setTimeout(wfLoad, 0);
  if(WF.editing) return viewWorkflowEditor();
  const m = wfModel();
  const ids = wfAllIds(m), done = ids.filter(wfTicked).length;
  const now = wfCurrentBlock(m);
  const pct = ids.length ? Math.round(done/ids.length*100) : 0;
  const R = 22, C = 2*Math.PI*R;
  const nowBlock = m.blocks.find(b=>b.id===now);
  return `
  <div class="topbar">
    <div><h1>Daily Workflow</h1><div class="sub">${new Date().toLocaleDateString("en-GB",{ weekday:"long", day:"numeric", month:"long" })} · ticks reset every morning</div></div>
    <div class="topbar-right">
      <a class="btn ghost" href="${WF_DOC_URL}" target="_blank" rel="noopener">${icon("link")} Google Doc</a>
      <button class="btn primary" data-wf-edit>${icon("edit")} Edit workflow</button>
    </div>
  </div>
  <div class="content wf">
    <div class="wf-hero">
      <div class="wf-ring" title="${done} of ${ids.length} done today">
        <svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="${R}" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="5"/><circle cx="28" cy="28" r="${R}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(C*pct/100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 28 28)"/></svg>
        <b>${pct}%</b>
      </div>
      <div class="wf-hero-t">
        <span class="wf-hero-k">Today’s workflow</span>
        <h2>${done===ids.length && ids.length ? "Everything done. Great day." : nowBlock ? `Right now: ${esc(nowBlock.title)}` : "Plan the day, block by block"}</h2>
        <p>${done} of ${ids.length} done${nowBlock ? ` · ${wfCount(nowBlock.items).n - wfCount(nowBlock.items).d} left in this block` : ""}</p>
      </div>
      <div class="wf-hero-blocks">${m.blocks.map(b=>{ const c = wfCount(b.items); return `<button type="button" class="wf-pip ${b.id===now?"now":""} ${c.n&&c.d===c.n?"full":""}" data-wf-jump="${esc(b.id)}" title="${esc(b.title)} · ${c.d}/${c.n}"><span style="--p:${c.n?Math.round(c.d/c.n*100):0}%"></span>${esc(String(b.title||"Block").split(/[ /]/)[0])}</button>`; }).join("")}</div>
    </div>
    <div class="wf-timeline">${m.blocks.map(b=>wfBlockCard(b, b.id===now)).join("")}</div>
    ${wfRequired(m.required)}
  </div>`;
}

/* ---------- editor ---------- */
/* While editing, each block's lines are a flat list with a depth, which makes
   indent / outdent / move simple; they're turned back into a tree on save. */
function wfFlatten(items, depth, out){ (items||[]).forEach(it=>{ out.push({ id:it.id, depth, t:it.t||"", b:!!it.b, b2:!!it.b2, label:!!it.label, link:it.link||"", btns:(it.btns||[]).map(x=>({ label:x.label||"", href:x.href||"" })) }); wfFlatten(it.kids, depth+1, out); }); return out; }
function wfTree(rows){
  const root = [], stack = [];
  rows.forEach(r=>{
    const it = { id:r.id, t:r.t.trim() };
    if(r.b) it.b = true; if(r.b2 && !r.b) it.b2 = true; if(r.label) it.label = true;
    if(wfSafeUrl(r.link)) it.link = wfSafeUrl(r.link);
    const btns = r.btns.filter(x=>wfSafeUrl(x.href)).map(x=>({ label:x.label.trim()||"Open", href:wfSafeUrl(x.href) }));
    if(btns.length) it.btns = btns;
    while(stack.length && stack[stack.length-1].depth >= r.depth) stack.pop();
    if(stack.length){ const p = stack[stack.length-1].it; (p.kids = p.kids || []).push(it); } else root.push(it);
    stack.push({ depth:r.depth, it });
  });
  return root;
}
function wfStartEdit(){
  const m = JSON.parse(JSON.stringify(wfModel()));
  WF.draft = {
    blocks: m.blocks.map(b=>({ id:b.id, title:b.title||"", sub:b.sub||"", from:b.from||"", to:b.to||"", timeLabel:b.timeLabel||"", color:b.color||"violet", icon:b.icon||"list", rows:wfFlatten(b.items, 0, []) })),
    required: { h:(m.required&&m.required.h)||"Required to Maximise Results", groups:((m.required&&m.required.groups)||[]).map(g=>({ h:g.h||"", text:(g.items||[]).join("\n") })) },
  };
  WF.editing = true; renderView(); window.scrollTo(0,0);
}
function wfSaveEdit(){
  const d = WF.draft;
  WF.model = {
    blocks: d.blocks.map(b=>({ id:b.id, title:b.title.trim()||"Untitled", sub:b.sub.trim(), from:b.from, to:b.to, timeLabel:b.timeLabel.trim()||undefined, color:b.color, icon:b.icon, items:wfTree(b.rows.filter(r=>r.t.trim())) })),
    required: { h:d.required.h.trim()||"Required to Maximise Results", groups:d.required.groups.filter(g=>g.h.trim()||g.text.trim()).map(g=>({ h:g.h.trim(), items:g.text.split("\n").map(x=>x.trim()).filter(Boolean) })) },
  };
  WF.custom = true; WF.editing = false; WF.draft = null;
  wfSave(); renderView(); toast("Workflow saved");
}
function wfEditBlock(b, bi, n){
  const sel = (name, val, opts)=>`<select data-wf-f="${bi}.${name}">${opts.map(o=>`<option value="${o}" ${o===val?"selected":""}>${o.charAt(0).toUpperCase()+o.slice(1)}</option>`).join("")}</select>`;
  return `<section class="wf-card wf-ed c-${b.color}" data-block="${esc(b.id)}">
    <div class="wf-ed-h">
      <span class="wf-ic ${b.color}">${icon(b.icon)}</span>
      <div class="wf-ed-fields">
        <label class="wf-ed-f wide">Block name<input data-wf-f="${bi}.title" value="${esc(b.title)}" placeholder="e.g. Morning" /></label>
        <label class="wf-ed-f wide">Subheading<input data-wf-f="${bi}.sub" value="${esc(b.sub)}" placeholder="e.g. MORNING" /></label>
        <label class="wf-ed-f">From<input type="time" data-wf-f="${bi}.from" value="${esc(b.from)}" /></label>
        <label class="wf-ed-f">To<input type="time" data-wf-f="${bi}.to" value="${esc(b.to)}" /></label>
        <label class="wf-ed-f">Time label<input data-wf-f="${bi}.timeLabel" value="${esc(b.timeLabel)}" placeholder="Auto" /></label>
        <label class="wf-ed-f">Colour${sel("color", b.color, WF_COLORS)}</label>
        <label class="wf-ed-f">Icon${sel("icon", b.icon, WF_ICONS)}</label>
      </div>
      <div class="wf-ed-tools">
        <button type="button" class="icon-btn" data-wf-act="bup" data-b="${bi}" ${bi===0?"disabled":""} title="Move block up" aria-label="Move block up">↑</button>
        <button type="button" class="icon-btn" data-wf-act="bdown" data-b="${bi}" ${bi===n-1?"disabled":""} title="Move block down" aria-label="Move block down">↓</button>
        <button type="button" class="icon-btn danger" data-wf-act="bdel" data-b="${bi}" title="Delete block" aria-label="Delete block">${icon("trash")}</button>
      </div>
    </div>
    <ol class="wf-ed-rows">
      ${b.rows.map((r,ri)=>`<li class="wf-ed-row" style="--d:${r.depth}">
        <div class="wf-ed-line">
          <div class="wf-ed-move">
            <button type="button" data-wf-act="up" data-b="${bi}" data-r="${ri}" ${ri===0?"disabled":""} title="Move up" aria-label="Move up">↑</button>
            <button type="button" data-wf-act="down" data-b="${bi}" data-r="${ri}" ${ri===b.rows.length-1?"disabled":""} title="Move down" aria-label="Move down">↓</button>
            <button type="button" data-wf-act="out" data-b="${bi}" data-r="${ri}" ${r.depth===0?"disabled":""} title="Outdent" aria-label="Outdent">⇤</button>
            <button type="button" data-wf-act="in" data-b="${bi}" data-r="${ri}" ${ri===0 || r.depth>b.rows[ri-1].depth || r.depth>=3?"disabled":""} title="Make it a sub-item" aria-label="Indent">⇥</button>
          </div>
          <input class="wf-ed-text" data-wf-f="${bi}.r${ri}.t" value="${esc(r.t)}" placeholder="What to do" aria-label="Line text" />
          <label class="wf-ed-chip ${r.b?"on":""}" title="Bold, with a Must do tag"><input type="checkbox" data-wf-f="${bi}.r${ri}.b" ${r.b?"checked":""} /> Must do</label>
          <label class="wf-ed-chip ${r.label?"on":""}" title="A heading line without a tick-box"><input type="checkbox" data-wf-f="${bi}.r${ri}.label" ${r.label?"checked":""} /> Heading</label>
          <button type="button" class="wf-ed-add-btn" data-wf-act="addbtn" data-b="${bi}" data-r="${ri}">${icon("plus")} Button</button>
          <button type="button" class="icon-btn danger" data-wf-act="del" data-b="${bi}" data-r="${ri}" title="Delete line" aria-label="Delete line">${icon("x")}</button>
        </div>
        ${r.link ? `<div class="wf-ed-sub"><span>Whole line links to</span><input data-wf-f="${bi}.r${ri}.link" value="${esc(r.link)}" placeholder="https://…" /><button type="button" class="icon-btn" data-wf-act="unlink" data-b="${bi}" data-r="${ri}" aria-label="Remove line link">${icon("x")}</button></div>` : ""}
        ${r.btns.map((x,xi)=>`<div class="wf-ed-sub"><span>Button</span><input class="lbl" data-wf-f="${bi}.r${ri}.btn${xi}.label" value="${esc(x.label)}" placeholder="Label, e.g. Workflow" /><input data-wf-f="${bi}.r${ri}.btn${xi}.href" value="${esc(x.href)}" placeholder="https://…" /><button type="button" class="icon-btn" data-wf-act="delbtn" data-b="${bi}" data-r="${ri}" data-x="${xi}" aria-label="Remove button">${icon("x")}</button></div>`).join("")}
      </li>`).join("")}
    </ol>
    <button type="button" class="btn ghost sm wf-ed-addrow" data-wf-act="add" data-b="${bi}">${icon("plus")} Add line</button>
  </section>`;
}
function viewWorkflowEditor(){
  const d = WF.draft;
  return `
  <div class="topbar">
    <div><h1>Edit Daily Workflow</h1><div class="sub">Changes are saved to your account when you press Save.</div></div>
    <div class="topbar-right">
      <button class="btn ghost" data-wf-reset title="Go back to the layout from the Google Doc">Reset to Doc version</button>
      <button class="btn" data-wf-cancel>Cancel</button>
      <button class="btn primary" data-wf-save>${icon("check")} Save workflow</button>
    </div>
  </div>
  <div class="content wf wf-editing">
    <p class="wf-ed-help">Tip: use ⇥ to turn a line into a sub-item of the one above, “Must do” for the bold must-dos, and “+ Button” to add a link button (like Workflow or Sales job sheet) after the text.</p>
    <div class="wf-timeline">${d.blocks.map((b,bi)=>wfEditBlock(b, bi, d.blocks.length)).join("")}</div>
    <button type="button" class="btn wf-ed-addblock" data-wf-act="addblock">${icon("plus")} Add block</button>
    <section class="wf-required wf-ed-req">
      <div class="wf-req-h"><span class="wf-req-ic">${icon("bolt")}</span><div style="flex:1"><label class="wf-ed-f wide">Box title<input data-wf-f="req.h" value="${esc(d.required.h)}" /></label></div></div>
      <div class="wf-req-grid">${d.required.groups.map((g,gi)=>`<div class="wf-req-g">
        <div class="wf-ed-gh"><input data-wf-f="req.g${gi}.h" value="${esc(g.h)}" placeholder="Group, e.g. Cold Calling" /><button type="button" class="icon-btn danger" data-wf-act="delgroup" data-g="${gi}" aria-label="Delete group">${icon("trash")}</button></div>
        <textarea data-wf-f="req.g${gi}.text" rows="5" placeholder="One point per line">${esc(g.text)}</textarea>
      </div>`).join("")}</div>
      <button type="button" class="btn ghost sm" data-wf-act="addgroup" style="margin-top:10px">${icon("plus")} Add group</button>
    </section>
    <div class="wf-ed-foot"><button class="btn" data-wf-cancel>Cancel</button><button class="btn primary" data-wf-save>${icon("check")} Save workflow</button></div>
  </div>`;
}
function wfEditInput(el){
  const d = WF.draft; const k = el.dataset.wfF.split(".");
  const val = el.type==="checkbox" ? el.checked : el.value;
  if(k[0]==="req"){
    if(k[1]==="h") d.required.h = val;
    else { const g = d.required.groups[+k[1].slice(1)]; if(g) g[k[2]] = val; }
    return;
  }
  const b = d.blocks[+k[0]]; if(!b) return;
  if(k.length===2){ b[k[1]] = val; if(k[1]==="color" || k[1]==="icon") renderView(); return; }
  const r = b.rows[+k[1].slice(1)]; if(!r) return;
  if(k[2].startsWith("btn")){ const x = r.btns[+k[2].slice(3)]; if(x) x[k[3]] = val; return; }
  r[k[2]] = val;
  if(el.type==="checkbox"){ if(k[2]==="b" && val) r.b2 = false; el.closest(".wf-ed-chip").classList.toggle("on", !!val); }
}
function wfEditAction(btn){
  const d = WF.draft, act = btn.dataset.wfAct, bi = +btn.dataset.b, ri = +btn.dataset.r;
  const b = d.blocks[bi]; const rows = b && b.rows;
  const swap = (arr, i, j)=>{ if(j<0 || j>=arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
  if(act==="add") rows.push({ id:wfUid(), depth:0, t:"", b:false, b2:false, label:false, link:"", btns:[] });
  else if(act==="del"){ const dep = rows[ri].depth; rows.splice(ri,1); while(rows[ri] && rows[ri].depth>dep){ rows[ri].depth--; ri++; } }
  else if(act==="up") swap(rows, ri, ri-1);
  else if(act==="down") swap(rows, ri, ri+1);
  else if(act==="in"){ if(ri>0 && rows[ri].depth<=rows[ri-1].depth) rows[ri].depth++; }
  else if(act==="out"){ if(rows[ri].depth>0) rows[ri].depth--; }
  else if(act==="addbtn") rows[ri].btns.push({ label:"", href:"" });
  else if(act==="delbtn") rows[ri].btns.splice(+btn.dataset.x, 1);
  else if(act==="unlink") rows[ri].link = "";
  else if(act==="bup") swap(d.blocks, bi, bi-1);
  else if(act==="bdown") swap(d.blocks, bi, bi+1);
  else if(act==="bdel"){ if(!confirm(`Delete the “${b.title||"untitled"}” block and its lines?`)) return; d.blocks.splice(bi,1); }
  else if(act==="addblock") d.blocks.push({ id:wfUid(), title:"New block", sub:"", from:"", to:"", timeLabel:"", color:WF_COLORS[d.blocks.length % WF_COLORS.length], icon:"list", rows:[{ id:wfUid(), depth:0, t:"", b:false, b2:false, label:false, link:"", btns:[] }] });
  else if(act==="addgroup") d.required.groups.push({ h:"", text:"" });
  else if(act==="delgroup") d.required.groups.splice(+btn.dataset.g, 1);
  // keep depths valid after moves (a line can be at most one level deeper than the one above)
  if(rows) rows.forEach((r,i)=>{ const max = i===0 ? 0 : rows[i-1].depth+1; if(r.depth>max) r.depth = max; });
  renderView();
  if(act==="add" || act==="addbtn" || act==="addblock"){
    setTimeout(()=>{ const all = document.querySelectorAll(act==="addbtn" ? `[data-wf-f^="${bi}.r${ri}.btn"]` : act==="addblock" ? ".wf-ed:last-child [data-wf-f$='.title']" : `[data-wf-f^="${bi}.r"][data-wf-f$=".t"]`); const el = all[act==="addbtn" ? all.length-2 : all.length-1]; if(el){ el.focus(); el.scrollIntoView({ block:"center", behavior:"smooth" }); } }, 30);
  }
}
function wfBind(){
  const root = document.getElementById("viewhost");
  if(WF.editing){
    root.querySelectorAll("[data-wf-f]").forEach(el=>{ el.oninput = ()=>wfEditInput(el); el.onchange = ()=>wfEditInput(el); });
    root.querySelectorAll("[data-wf-act]").forEach(b=>b.onclick = ()=>wfEditAction(b));
    root.querySelectorAll("[data-wf-save]").forEach(b=>b.onclick = wfSaveEdit);
    root.querySelectorAll("[data-wf-cancel]").forEach(b=>b.onclick = ()=>{ WF.editing = false; WF.draft = null; renderView(); });
    root.querySelectorAll("[data-wf-reset]").forEach(b=>b.onclick = ()=>{
      if(!confirm("Go back to the layout from the Google Doc? Your edits to the workflow will be replaced.")) return;
      WF.model = wfDefaultModel(); WF.custom = false; WF.editing = false; WF.draft = null; wfSave(); renderView(); toast("Back to the Google Doc version");
    });
    return;
  }
  root.querySelectorAll("[data-wf-edit]").forEach(b=>b.onclick = wfStartEdit);
  root.querySelectorAll("[data-wf-tick]").forEach(b=>b.onclick = ()=>wfToggle(b.dataset.wfTick));
  root.querySelectorAll("[data-wf-jump]").forEach(b=>b.onclick = ()=>{ const el = root.querySelector(`.wf-card[data-block="${CSS.escape(b.dataset.wfJump)}"]`); if(el) el.scrollIntoView({ block:"start", behavior:"smooth" }); });
  const nowEl = root.querySelector(".wf-card.now");
  if(nowEl && !wfBind._scrolled){ wfBind._scrolled = true; setTimeout(()=>nowEl.scrollIntoView({ block:"center", behavior:"smooth" }), 80); }
}
/* keep the "Now" marker moving while the tab is open (not while editing) */
setInterval(()=>{ if(activeView==="workflow" && !WF.editing && !document.getElementById("modalOverlay")) renderView(); }, 5*60*1000);
