/* ============================= DAILY WORKFLOW =============================
   Mirrors "Tab 1" of the "Daily Workflow" Google Doc: the same blocks, bold
   items and nested lists. Each line can
   be ticked off for today; ticks reset each day and are saved to the account
   (app_state "daily_workflow"). */
const WF_DOC_URL = "https://docs.google.com/document/d/1Yq9quEaXRPoTHOmqt-C3yrCqd2V_XdWtI0u0_EOvHJo/edit";
const WF_CALORIES = "https://docs.google.com/spreadsheets/d/1iCwTZE_tvxvSH6dZ_HIpqBgHZfFtU7y31zy9u4R8Rbc/edit?gid=1261861603#gid=1261861603";
const WF_VISIONBOARD = "https://miro.com/app/board/uXjVHzqUhL0=/";
const WF_EOD = "https://drive.google.com/open?id=1labEfX3TmJlsJVSXsSJ71_whiHctKBPkRx6v-qJNgQQ";
const WF_PROSPECTING = [
  { t:"Call/Message Old Leads" },
  { t:"Call/Message leads that didn’t show" },
  { t:"Call/Message leads that didn’t close" },
  { t:"Leads that never booked" },
];
/* b = bold (the doc's ** must-do items); kids = nested bullets; link = opens a sheet/report;
   from/to = when the block runs, used to highlight the current one. */
const WF_DOCS = [
  { id:"t1", tab:"Tab 1", blocks:[
    { id:"dawn", h:"DAWN - 4 am", from:"04:00", to:"07:00", icon:"sun", items:[
      { t:"Read Visionboard 4:00 - 4:30", btn:{ href:WF_VISIONBOARD, label:"Open Visionboard" } },
      { t:"Read Book - 4:30 - 5:30" },
      { t:"Apply to Sales Calls 5:30 - 7:00" },
    ]},
    { id:"morning", h:"MORNING", from:"07:00", to:"12:00", icon:"bolt", items:[
      { t:"Correr: 7:00 - 8:30", b:true },
      { t:"Outreach Block - 8:30-10:30", b:true, kids:[ { t:"Clients Leads" }, { t:"Cold Calling (90min) - 30 - 40 conversations" } ] },
    ]},
    { id:"lunch", h:"LUNCH:", inline:true, from:"12:00", to:"14:00", icon:"fork", text:"Educational Content (Cole Gordon/Charlie/Ultra influence) / Watch Salescall/Coaching Call (Cole Gordon, Louis, Scott)" },
    { id:"golden", h:"2pm - 8pm - GOLDEN HOURS:", from:"14:00", to:"20:00", icon:"target", gold:true, items:[
      { t:"Sales Calls or Prospecting", kids:[ { t:"Prospecting checklist:", label:true, kids:WF_PROSPECTING } ] },
    ]},
    { id:"evening", h:"AFTERNOON/EVENING", from:"20:00", to:"23:59", icon:"moon", items:[
      { t:"Confirm leads of the next day" },
      { t:"Read", b2:true },
      { t:"Service Delivery", b2:true },
      { t:"Fill out EOD Report", b:true, kids:[ { t:"CALORIE TRACKER", link:WF_CALORIES }, { t:"End of Day Report | Vanessa Daily Metrics", link:WF_EOD } ] },
    ]},
    { id:"dinner", h:"DINNER:", inline:true, icon:"fork", text:"Educational Content (Cole Gordon/Charlie/Ultra influence)" },
  ], required:{ h:"Required to Maximise Results:", groups:[
    { h:"Cold Calling", items:[
      "Cold Call to only online meeting (+run mini discovery on cold call)",
      "Send portfolio after cold calling",
      "Confirm the next day/ the day of the meeting",
      "Setting up automatic reminders",
    ]},
    { h:"Sales Call", items:[
      "Preparing for sales call beforehand by practicing script",
      "Having a slide deck with price deck on it and selling on right away on call",
      "Following the full sales process (outcome based)",
    ]},
  ]}},
];
const WF_LOOK = {
  dawn:    { c:"violet", ic:"sun",    time:(b)=>b.from+" – "+b.to },
  morning: { c:"amber",  ic:"bolt",   time:(b)=>b.from+" – "+b.to },
  lunch:   { c:"teal",   ic:"fork",   time:(b)=>b.from+" – "+b.to },
  golden:  { c:"gold",   ic:"target", time:(b)=>"14:00 – 20:00" },
  evening: { c:"indigo", ic:"moon",   time:(b)=>"After 20:00" },
  dinner:  { c:"rose",   ic:"fork",   time:()=>"Dinner" },
};
const WF_TITLE = { dawn:"Dawn", morning:"Morning", lunch:"Lunch", golden:"Golden Hours", evening:"Afternoon / Evening", dinner:"Dinner" };
/* stable ids: doc/block/path, so ticks survive small wording edits elsewhere */
(function assignIds(){
  const walk = (items, prefix)=>items.forEach((it,i)=>{ it.id = `${prefix}.${i}`; if(it.kids) walk(it.kids, it.id); });
  WF_DOCS.forEach(d=>d.blocks.forEach(b=>{ b.key = `${d.id}.${b.id}`; if(b.items) walk(b.items, b.key); else b.tickId = b.key; }));
})();

const WF = { doc:"t1", ticks:{}, loaded:false };
try{ const v = localStorage.getItem("cockpit_wf_doc"); if(v && WF_DOCS.some(d=>d.id===v)) WF.doc = v; }catch(e){}
function wfToday(){ return todayStr(); }
function wfTicked(id){ return (WF.ticks[wfToday()]||[]).includes(id); }
async function wfLoad(){
  if(WF.loaded) return;
  WF.loaded = true;
  try{
    const { data } = await sb.from("app_state").select("value").eq("key","daily_workflow").maybeSingle();
    if(data && data.value && data.value.ticks) WF.ticks = data.value.ticks;
  }catch(e){ try{ WF.ticks = JSON.parse(localStorage.getItem("cockpit_wf_ticks")||"{}"); }catch(_){} }
  if(activeView==="workflow") renderView();
}
let wfSaveT = null;
function wfSave(){
  const t = wfToday();
  Object.keys(WF.ticks).forEach(k=>{ if(k < addDays(t,-30)) delete WF.ticks[k]; }); // keep a month of history
  try{ localStorage.setItem("cockpit_wf_ticks", JSON.stringify(WF.ticks)); }catch(e){}
  clearTimeout(wfSaveT);
  wfSaveT = setTimeout(async ()=>{
    try{
      const { data: { session } } = await sb.auth.getSession(); if(!session) return;
      await sb.from("app_state").upsert({ user_id: session.user.id, key:"daily_workflow", value:{ ticks:WF.ticks }, updated_at:new Date().toISOString() }, { onConflict:"user_id,key" });
    }catch(e){ console.warn("daily workflow save failed", e); }
  }, 600);
}
function wfToggle(id){
  const t = wfToday(); const list = new Set(WF.ticks[t]||[]);
  list.has(id) ? list.delete(id) : list.add(id);
  WF.ticks[t] = [...list]; wfSave(); renderView();
}
function wfNowMin(){ const d = new Date(); return d.getHours()*60 + d.getMinutes(); }
function wfMin(hm){ const [h,m] = hm.split(":").map(Number); return h*60+m; }
function wfCurrentBlock(doc){ const n = wfNowMin(); const b = doc.blocks.find(b=>b.from && n>=wfMin(b.from) && n<wfMin(b.to)); return b ? b.id : null; }
/* every tickable line of a doc (labels like "Prospecting checklist:" aren't tickable) */
function wfAllIds(doc){
  const out = [];
  const walk = (items)=>items.forEach(it=>{ if(!it.label) out.push(it.id); if(it.kids) walk(it.kids); });
  doc.blocks.forEach(b=>{ if(b.items) walk(b.items); else out.push(b.tickId); });
  return out;
}
function wfText(it){
  let t = esc(it.t);
  if(it.strong) t = t.replace(esc(it.strong), `<b>${esc(it.strong)}</b>`);
  return t;
}
function wfCount(items){ let n = 0, d = 0; const walk = (xs)=>xs.forEach(it=>{ if(!it.label){ n++; if(wfTicked(it.id)) d++; } if(it.kids) walk(it.kids); }); walk(items); return { n, d }; }
function wfItems(items, depth){
  return `<ul class="wf-ul d${depth}">${items.map(it=>{
    const on = !it.label && wfTicked(it.id);
    const body = it.link
      ? `<a class="wf-link" href="${esc(it.link)}" target="_blank" rel="noopener">${icon("link")} ${wfText(it)}</a>`
      : `<span class="${it.b?"wf-must":it.b2?"wf-strong":it.label?"wf-label":""}">${wfText(it)}</span>${it.b?`<span class="wf-must-tag">Must do</span>`:""}${it.btn?`<a class="wf-btn" href="${esc(it.btn.href)}" target="_blank" rel="noopener">${icon("arrow")} ${esc(it.btn.label)}</a>`:""}`;
    return `<li class="${on?"done":""} ${it.label?"label":""} ${it.b?"must":""}">
      <div class="wf-line">
        ${it.label ? `<span class="wf-dot" aria-hidden="true"></span>` : `<button type="button" class="wf-check ${on?"on":""}" data-wf-tick="${it.id}" role="checkbox" aria-checked="${on}" aria-label="${esc(it.t)}">${icon("check")}</button>`}
        <div class="wf-txt">${body}</div>
      </div>
      ${it.kids ? wfItems(it.kids, depth+1) : ""}
    </li>`;
  }).join("")}</ul>`;
}
function wfBlockCard(b, isNow){
  const look = WF_LOOK[b.id] || { c:"violet", ic:"list", time:()=>"" };
  const title = WF_TITLE[b.id] || b.h;
  const sub = b.h.replace(/:$/,"");
  const c = b.items ? wfCount(b.items) : { n:1, d: wfTicked(b.tickId) ? 1 : 0 };
  const complete = c.n && c.d===c.n;
  const head = `<header class="wf-card-h">
      <span class="wf-ic ${look.c}">${icon(look.ic)}</span>
      <div class="wf-card-t"><h2>${esc(title)}</h2>${sub.replace(/[^a-z]/gi,"").toLowerCase()===title.replace(/[^a-z]/gi,"").toLowerCase() ? "" : `<span class="wf-card-sub">${esc(sub)}</span>`}</div>
      <div class="wf-card-r">
        ${isNow?`<span class="wf-now"><i></i>Now</span>`:""}
        ${look.time(b)?`<span class="wf-time">${esc(look.time(b))}</span>`:""}
        <span class="wf-mini ${complete?"full":""}" title="${c.d} of ${c.n} done">${complete?icon("check"):`${c.d}/${c.n}`}</span>
      </div>
    </header>`;
  const body = b.items ? wfItems(b.items, 0)
    : `<div class="wf-line wf-single ${wfTicked(b.tickId)?"done":""}"><button type="button" class="wf-check ${wfTicked(b.tickId)?"on":""}" data-wf-tick="${b.tickId}" role="checkbox" aria-checked="${wfTicked(b.tickId)}" aria-label="${esc(title+": "+b.text)}">${icon("check")}</button><div class="wf-txt">${esc(b.text)}</div></div>`;
  return `<section class="wf-card c-${look.c} ${isNow?"now":""} ${complete?"complete":""}" data-block="${b.id}">${head}<div class="wf-card-b">${body}</div></section>`;
}
function wfRequired(r){
  if(!r) return "";
  return `<section class="wf-required" aria-label="${esc(r.h)}">
    <div class="wf-req-h"><span class="wf-req-ic">${icon("bolt")}</span><div><h2>${esc(r.h.replace(/:$/,""))}</h2><p>Keep these in mind on every call.</p></div></div>
    <div class="wf-req-grid">${r.groups.map(g=>`<div class="wf-req-g">
      <h3>${icon(g.h==="Sales Call"?"headset":"phone")} ${esc(g.h)}</h3>
      <ul>${g.items.map(x=>`<li>${icon("check")}<span>${esc(x)}</span></li>`).join("")}</ul>
    </div>`).join("")}</div>
  </section>`;
}
function viewWorkflow(){
  setTimeout(wfLoad, 0);
  const doc = WF_DOCS.find(d=>d.id===WF.doc) || WF_DOCS[0];
  const ids = wfAllIds(doc), done = ids.filter(wfTicked).length;
  const now = wfCurrentBlock(doc);
  const pct = ids.length ? Math.round(done/ids.length*100) : 0;
  const R = 22, C = 2*Math.PI*R;
  const nowBlock = doc.blocks.find(b=>b.id===now);
  return `
  <div class="topbar">
    <div><h1>Daily Workflow</h1><div class="sub">${new Date().toLocaleDateString("en-GB",{ weekday:"long", day:"numeric", month:"long" })} · ticks reset every morning</div></div>
    <div class="topbar-right">
      <a class="btn" href="${WF_DOC_URL}" target="_blank" rel="noopener">${icon("link")} Open in Google Docs</a>
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
        <h2>${done===ids.length && ids.length ? "Everything done. Great day." : nowBlock ? `Right now: ${esc(WF_TITLE[nowBlock.id]||nowBlock.h)}` : "Plan the day, block by block"}</h2>
        <p>${done} of ${ids.length} done${nowBlock && nowBlock.items ? ` · ${wfCount(nowBlock.items).n - wfCount(nowBlock.items).d} left in this block` : ""}</p>
      </div>
      <div class="wf-hero-blocks">${doc.blocks.map(b=>{ const look = WF_LOOK[b.id]||{c:"violet"}; const c = b.items ? wfCount(b.items) : { n:1, d: wfTicked(b.tickId)?1:0 }; return `<button type="button" class="wf-pip ${look.c} ${b.id===now?"now":""} ${c.n&&c.d===c.n?"full":""}" data-wf-jump="${b.id}" title="${esc(WF_TITLE[b.id]||b.h)} · ${c.d}/${c.n}"><span style="--p:${c.n?Math.round(c.d/c.n*100):0}%"></span>${esc((WF_TITLE[b.id]||b.h).split(" ")[0])}</button>`; }).join("")}</div>
    </div>
    <div class="wf-timeline">
      ${doc.blocks.map(b=>wfBlockCard(b, b.id===now)).join("")}
    </div>
    ${wfRequired(doc.required)}
  </div>`;
}
function wfBind(){
  const root = document.getElementById("viewhost");
  root.querySelectorAll("[data-wf-tick]").forEach(b=>b.onclick = ()=>wfToggle(b.dataset.wfTick));
  root.querySelectorAll("[data-wf-jump]").forEach(b=>b.onclick = ()=>{ const el = root.querySelector(`.wf-card[data-block="${b.dataset.wfJump}"]`); if(el) el.scrollIntoView({ block:"start", behavior:"smooth" }); });
  root.querySelectorAll("[data-wf-doc]").forEach(b=>b.onclick = ()=>{ WF.doc = b.dataset.wfDoc; try{ localStorage.setItem("cockpit_wf_doc", WF.doc); }catch(e){} renderView(); });
  const nowEl = root.querySelector(".wf-card.now");
  if(nowEl && !wfBind._scrolled){ wfBind._scrolled = true; setTimeout(()=>nowEl.scrollIntoView({ block:"center", behavior:"smooth" }), 80); }
}
/* keep the "Now" marker moving while the tab is open */
setInterval(()=>{ if(activeView==="workflow" && !document.getElementById("modalOverlay")) renderView(); }, 5*60*1000);
