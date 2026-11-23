/* ============================= DAILY WORKFLOW =============================
   Mirrors "Tab 1" of the "Daily Workflow" Google Doc: the same blocks, bold
   items and nested lists. Each line can
   be ticked off for today; ticks reset each day and are saved to the account
   (app_state "daily_workflow"). */
const WF_DOC_URL = "https://docs.google.com/document/d/1Yq9quEaXRPoTHOmqt-C3yrCqd2V_XdWtI0u0_EOvHJo/edit";
const WF_CALORIES = "https://docs.google.com/spreadsheets/d/1iCwTZE_tvxvSH6dZ_HIpqBgHZfFtU7y31zy9u4R8Rbc/edit?gid=1261861603#gid=1261861603";
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
      { t:"Read Visionboard 4:00 - 4:30" },
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
      { t:"Read", b2:true },
      { t:"Service Delivery", b2:true },
      { t:"Fill out EOD Report", b:true, kids:[ { t:"CALORIE TRACKER", link:WF_CALORIES }, { t:"End of Day Report | Vanessa Daily Metrics", link:WF_EOD } ] },
    ]},
    { id:"dinner", h:"DINNER:", inline:true, icon:"fork", text:"Educational Content (Cole Gordon/Charlie/Ultra influence)" },
  ]},
];
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
function wfItems(items, depth){
  return `<ul class="wf-ul d${depth}">${items.map(it=>{
    const on = !it.label && wfTicked(it.id);
    const body = it.link
      ? `<a class="wf-link" href="${esc(it.link)}" target="_blank" rel="noopener">${wfText(it)} ${icon("arrow")}</a>`
      : it.b ? `<span class="wf-bold">**${wfText(it)}**</span>`
      : it.b2 ? `<b>${wfText(it)}</b>`
      : it.label ? `<span class="wf-label">${wfText(it)}</span>`
      : `<span>${wfText(it)}</span>`;
    return `<li class="${on?"done":""} ${it.label?"label":""}">
      <div class="wf-line">
        ${it.label ? `<span class="wf-bullet" aria-hidden="true"></span>` : `<button type="button" class="wf-check ${on?"on":""}" data-wf-tick="${it.id}" role="checkbox" aria-checked="${on}" aria-label="${esc(it.t)}">${on?icon("check"):""}</button>`}
        <div class="wf-txt">${body}</div>
      </div>
      ${it.kids ? wfItems(it.kids, depth+1) : ""}
    </li>`;
  }).join("")}</ul>`;
}
function viewWorkflow(){
  setTimeout(wfLoad, 0);
  const doc = WF_DOCS.find(d=>d.id===WF.doc) || WF_DOCS[0];
  const ids = wfAllIds(doc), done = ids.filter(wfTicked).length;
  const now = wfCurrentBlock(doc);
  const pct = ids.length ? Math.round(done/ids.length*100) : 0;
  return `
  <div class="topbar">
    <div><h1>Daily Workflow</h1><div class="sub">${new Date().toLocaleDateString("en-GB",{ weekday:"long", day:"numeric", month:"long" })} · ticks reset every morning</div></div>
    <div class="topbar-right">
      <div class="wf-progress" title="${done} of ${ids.length} done today"><span style="width:${pct}%"></span></div>
      <span class="wf-count">${done}/${ids.length}</span>
      <a class="btn" href="${WF_DOC_URL}" target="_blank" rel="noopener">${icon("link")} Open in Google Docs</a>
    </div>
  </div>
  <div class="content wf ${WF_DOCS.length > 1 ? "" : "single"}">
    ${WF_DOCS.length > 1 ? `<aside class="wf-tabs" aria-label="Document tabs">
      <div class="wf-tabs-h">Document tabs</div>
      ${WF_DOCS.map(d=>`<button type="button" class="wf-tab ${d.id===doc.id?"active":""}" data-wf-doc="${d.id}">${icon("list")} ${esc(d.tab)}</button>`).join("")}
    </aside>` : ""}
    <article class="wf-page">
      <div class="wf-page-title">${esc(doc.tab)}</div>
      ${doc.blocks.map(b=>{
        const isNow = b.id===now;
        const tick = b.tickId ? `<button type="button" class="wf-check ${wfTicked(b.tickId)?"on":""}" data-wf-tick="${b.tickId}" role="checkbox" aria-checked="${wfTicked(b.tickId)}" aria-label="${esc(b.h+" "+(b.text||""))}">${wfTicked(b.tickId)?icon("check"):""}</button>` : "";
        if(b.inline || (!b.items && b.text)){
          return `<section class="wf-block ${isNow?"now":""} ${b.gold?"gold":""} ${b.tickId&&wfTicked(b.tickId)?"done":""}" data-block="${b.id}">
            ${isNow?`<span class="wf-now">Now</span>`:""}
            <div class="wf-line">${tick}<p class="wf-inline">${b.inline ? `<b>${esc(b.h)}</b> ${esc(b.text)}` : `<b class="wf-h">${esc(b.h)}</b><br>${esc(b.text)}`}</p></div>
          </section>`;
        }
        return `<section class="wf-block ${isNow?"now":""} ${b.gold?"gold":""}" data-block="${b.id}">
          ${isNow?`<span class="wf-now">Now</span>`:""}
          <h2 class="wf-h">${esc(b.h)}</h2>
          ${wfItems(b.items, 0)}
        </section>`;
      }).join("")}
    </article>
  </div>`;
}
function wfBind(){
  const root = document.getElementById("viewhost");
  root.querySelectorAll("[data-wf-tick]").forEach(b=>b.onclick = ()=>wfToggle(b.dataset.wfTick));
  root.querySelectorAll("[data-wf-doc]").forEach(b=>b.onclick = ()=>{ WF.doc = b.dataset.wfDoc; try{ localStorage.setItem("cockpit_wf_doc", WF.doc); }catch(e){} renderView(); });
  const nowEl = root.querySelector(".wf-block.now");
  if(nowEl && !wfBind._scrolled){ wfBind._scrolled = true; setTimeout(()=>nowEl.scrollIntoView({ block:"center", behavior:"smooth" }), 80); }
}
/* keep the "Now" marker moving while the tab is open */
setInterval(()=>{ if(activeView==="workflow" && !document.getElementById("modalOverlay")) renderView(); }, 5*60*1000);
