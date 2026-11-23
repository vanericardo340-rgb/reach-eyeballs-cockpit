/* ============================= FITNESS · HEALTH DASHBOARD =============================
   One-page view of the calorie tracker: KPIs, weight/calorie chart, period at a
   glance, weekly summary and the daily log. Data is state.fitnessLog, which
   syncs live from the Calorie Tracker sheet (see syncSheetsLive). */
const HD = { period: "month", chart: "weight", filter: "all", search: "", showAll: false };
try{ const s = JSON.parse(localStorage.getItem("cockpit_health_ui")||"{}"); if(s.period) HD.period = s.period; if(s.chart) HD.chart = s.chart; }catch(e){}
function hdRemember(){ try{ localStorage.setItem("cockpit_health_ui", JSON.stringify({ period:HD.period, chart:HD.chart })); }catch(e){} }

const HD_DAY = 86400000;
function hdKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function hdDate(k){ const [y,m,d] = k.split("-").map(Number); return new Date(y, m-1, d); }
function hdAdd(k, n){ const d = hdDate(k); d.setDate(d.getDate()+n); return hdKey(d); }
function hdShort(k){ return hdDate(k).toLocaleDateString("en-GB",{ day:"numeric", month:"short" }); }
function hdMonday(k){ const d = hdDate(k); const dow = (d.getDay()+6)%7; d.setDate(d.getDate()-dow); return hdKey(d); }
function hdNum(v){ const n = Number(v); return v===null || v===undefined || v==="" || !isFinite(n) || n<=0 ? null : n; }
function hdFmt(n, dp){ return n===null || n===undefined ? "—" : Number(n).toLocaleString("en-GB",{ minimumFractionDigits:dp||0, maximumFractionDigits:dp||0 }); }
function hdSigned(n, dp, unit){ if(n===null || n===undefined) return "—"; const v = Number(n.toFixed(dp)); return `${v>0?"+":v<0?"−":""}${Math.abs(v).toFixed(dp)}${unit||""}`; }

function hdRows(){ return state.fitnessLog.map(r=>({ id:r.id, date:r.date, weight:hdNum(r.weight), calories:hdNum(r.calories), protein:hdNum(r.protein), foods:(r.foods||"").trim(), fromSheet:r.fromSheet })).filter(r=>r.date).sort((a,b)=>a.date<b.date?-1:1); }
function hdMonths(rows){ return [...new Set(rows.map(r=>r.date.slice(0,7)))].sort().reverse(); }
function hdRange(rows){
  const today = todayStr();
  const first = rows.length ? rows[0].date : today;
  const p = HD.period;
  if(p==="7") return { from:hdAdd(today,-6), to:today, label:"Last 7 days" };
  if(p==="30") return { from:hdAdd(today,-29), to:today, label:"Last 30 days" };
  if(p==="90") return { from:hdAdd(today,-89), to:today, label:"Last 90 days" };
  if(p==="all") return { from:first, to:today, label:"All time" };
  if(/^\d{4}-\d{2}$/.test(p)){
    const [y,m] = p.split("-").map(Number);
    const last = hdKey(new Date(y, m, 0));
    return { from:`${p}-01`, to: last < today ? last : today, label: hdDate(`${p}-01`).toLocaleDateString("en-GB",{ month:"long", year:"numeric" }) };
  }
  return { from: today.slice(0,8)+"01", to: today, label:"This month" };
}
function hdStats(rows){
  const w = rows.filter(r=>r.weight), c = rows.filter(r=>r.calories), p = rows.filter(r=>r.protein);
  const start = w.length ? w[0].weight : null, end = w.length ? w[w.length-1].weight : null;
  const total = c.reduce((a,r)=>a+r.calories,0);
  return {
    days: rows.filter(r=>r.weight || r.calories).length,
    start, end, change: start!==null && end!==null ? end-start : null,
    pct: start ? (end-start)/start*100 : null,
    total, avgCal: c.length ? total/c.length : null,
    avgProtein: p.length ? p.reduce((a,r)=>a+r.protein,0)/p.length : null,
    avgWeight: w.length ? w.reduce((a,r)=>a+r.weight,0)/w.length : null,
  };
}

/* ---------- chart ---------- */
function hdChart(rows, range){
  const W = 720, H = 250, L = 48, R = 16, T = 18, B = 34;
  const days = Math.max(1, Math.round((hdDate(range.to)-hdDate(range.from))/HD_DAY));
  const x = (k)=>L + (Math.round((hdDate(k)-hdDate(range.from))/HD_DAY)/days)*(W-L-R);
  const xTicks = [];
  const step = Math.max(1, Math.round(days/5));
  for(let i=0; i<=days; i+=step) xTicks.push(hdAdd(range.from, i));
  const xAxis = xTicks.map(k=>`<text x="${x(k).toFixed(1)}" y="${H-10}" text-anchor="middle" class="hd-ax">${hdShort(k)}</text>`).join("");
  if(HD.chart==="weight"){
    const pts = rows.filter(r=>r.weight);
    if(pts.length < 2) return `<div class="hd-chart-empty">${pts.length ? "Log another weigh-in to see the trend." : "No weigh-ins in this period."}</div>`;
    let min = Math.min(...pts.map(p=>p.weight)), max = Math.max(...pts.map(p=>p.weight));
    const pad = Math.max(0.3, (max-min)*0.15); min = Math.floor((min-pad)*2)/2; max = Math.ceil((max+pad)*2)/2;
    const y = (v)=>T + (1-(v-min)/(max-min))*(H-T-B);
    const ticks = []; const ystep = (max-min) > 4 ? 1 : 0.5;
    for(let v=min; v<=max+1e-9; v+=ystep) ticks.push(v);
    const line = pts.map((p,i)=>`${i?"L":"M"}${x(p.date).toFixed(1)} ${y(p.weight).toFixed(1)}`).join(" ");
    const area = `${line} L${x(pts[pts.length-1].date).toFixed(1)} ${H-B} L${x(pts[0].date).toFixed(1)} ${H-B} Z`;
    const data = pts.map((p,i)=>({ x:x(p.date), y:y(p.weight), label:`${hdFmt(p.weight,1)} kg`, sub: i ? hdSigned(p.weight-pts[i-1].weight,1," kg") : "First weigh-in", down: i ? p.weight-pts[i-1].weight <= 0 : null, date:p.date }));
    return `<div class="hd-chart" data-points='${esc(JSON.stringify(data))}' data-w="${W}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight from ${hdShort(pts[0].date)} to ${hdShort(pts[pts.length-1].date)}">
        <defs><linearGradient id="hdArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6c4fe0" stop-opacity=".22"/><stop offset="1" stop-color="#6c4fe0" stop-opacity="0"/></linearGradient></defs>
        ${ticks.map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="hd-grid"/><text x="${L-8}" y="${(y(v)+4).toFixed(1)}" text-anchor="end" class="hd-ax">${v.toFixed(1)}</text>`).join("")}
        ${xAxis}
        <path d="${area}" fill="url(#hdArea)"/>
        <path d="${line}" fill="none" stroke="#6c4fe0" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
        ${pts.map((p,i)=> (i===0 || i===pts.length-1 || pts.length<=12) ? `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.weight).toFixed(1)}" r="${i===pts.length-1?5:3.5}" fill="${i===pts.length-1?"#fff":"#6c4fe0"}" stroke="#6c4fe0" stroke-width="2"/>` : "").join("")}
        <line class="hd-cursor" x1="0" x2="0" y1="${T}" y2="${H-B}" style="display:none"/>
        <circle class="hd-dot" r="5.5" fill="#fff" stroke="#6c4fe0" stroke-width="2.5" style="display:none"/>
      </svg>
      <div class="hd-tip" style="display:none"></div>
    </div>`;
  }
  const pts = rows.filter(r=>r.calories);
  if(!pts.length) return `<div class="hd-chart-empty">No calories logged in this period.</div>`;
  const max = Math.ceil(Math.max(...pts.map(p=>p.calories))*1.1/250)*250;
  const y = (v)=>T + (1-v/max)*(H-T-B);
  const bw = Math.max(3, Math.min(22, (W-L-R)/(days+1)*0.62));
  const avg = pts.reduce((a,p)=>a+p.calories,0)/pts.length;
  const ticks = [0, max/4, max/2, max*3/4, max];
  const data = pts.map(p=>({ x:x(p.date), y:y(p.calories), label:`${hdFmt(p.calories)} kcal`, sub: p.foods ? p.foods.slice(0,60) : "", date:p.date }));
  return `<div class="hd-chart" data-points='${esc(JSON.stringify(data))}' data-w="${W}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories per day">
      ${ticks.map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="hd-grid"/><text x="${L-8}" y="${(y(v)+4).toFixed(1)}" text-anchor="end" class="hd-ax">${v>=1000?(v/1000).toFixed(v%1000?1:0)+"k":Math.round(v)}</text>`).join("")}
      ${xAxis}
      ${pts.map(p=>`<rect x="${(x(p.date)-bw/2).toFixed(1)}" y="${y(p.calories).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H-B-y(p.calories)).toFixed(1)}" rx="${Math.min(5,bw/2).toFixed(1)}" fill="${p.calories>2500?"#f0a35e":"#a48cf0"}"/>`).join("")}
      <line x1="${L}" x2="${W-R}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}" stroke="#6c4fe0" stroke-dasharray="5 5" stroke-width="1.5"/>
      <text x="${W-R}" y="${(y(avg)-6).toFixed(1)}" text-anchor="end" class="hd-ax" fill="#6c4fe0">avg ${hdFmt(avg)}</text>
      <line class="hd-cursor" x1="0" x2="0" y1="${T}" y2="${H-B}" style="display:none"/>
      <circle class="hd-dot" r="0" style="display:none"/>
    </svg>
    <div class="hd-tip" style="display:none"></div>
  </div>`;
}

/* ---------- sections ---------- */
function hdKpi(cls, ic, label, value, foot){
  return `<div class="hd-kpi ${cls}"><div class="hd-kpi-ic">${ic}</div><div><div class="hd-kpi-l">${label}</div><div class="hd-kpi-v">${value}</div>${foot?`<div class="hd-kpi-f">${foot}</div>`:""}</div></div>`;
}
const HD_IC = {
  scale:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8.5 9.5a5 5 0 0 1 7 0L12 12z"/></svg>`,
  layers:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></svg>`,
  dumbbell:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5 17.5 17.5M3 10l7-7M14 21l7-7M5 12l7-7M12 19l7-7"/></svg>`,
  ring:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`,
  bars:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 20V11M12 20V5M18 20v-6"/></svg>`,
  chart:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 15l3-3 3 2 4-5"/></svg>`,
  cal:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>`,
  okc:`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1a9d6c"/><path d="m7.5 12.3 3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  half:`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#c9c6bd" stroke-width="2" stroke-dasharray="3 3"/></svg>`,
};
function hdWeeks(all, range){
  const out = [];
  for(let m = hdMonday(range.from); m <= range.to; m = hdAdd(m, 7)){
    const end = hdAdd(m, 6);
    const rows = all.filter(r=>r.date>=m && r.date<=end);
    out.push(Object.assign({ from:m, to:end }, hdStats(rows)));
  }
  return out;
}
function viewHealth(){
  const all = hdRows();
  const range = hdRange(all);
  const rows = all.filter(r=>r.date>=range.from && r.date<=range.to);
  const s = hdStats(rows);
  const months = hdMonths(all);
  const periodDays = Math.round((hdDate(range.to)-hdDate(range.from))/HD_DAY)+1;
  const good = s.change!==null && s.change<=0;
  const weeks = hdWeeks(all, range);
  const q = HD.search.trim().toLowerCase();
  const log = rows.slice().reverse().filter(r=>HD.filter==="all" || (HD.filter==="food" ? r.foods : HD.filter==="weight" ? r.weight : r.calories)).filter(r=>!q || [r.foods, r.date, hdShort(r.date)].join(" ").toLowerCase().includes(q));
  const shown = HD.showAll ? log : log.slice(0, 14);
  const ringPct = Math.min(1, s.days/Math.max(1, periodDays));
  const C = 2*Math.PI*46;
  const lastSync = (typeof sheetsLastAt!=="undefined" && sheetsLastAt) ? new Date(sheetsLastAt).toLocaleTimeString("en-GB",{ hour:"2-digit", minute:"2-digit" }) : null;
  return `
  <div class="content hd">
    <div class="hd-top">
      <div>
        <h1 class="hd-h1">Your Health Dashboard <span aria-hidden="true">👋</span></h1>
        <p class="hd-sub">Track your calories, weight and progress in one place. <span class="hd-live"><i></i> Live from your <a href="${SHEET_SOURCE_URL}" target="_blank" rel="noopener">Calorie Tracker sheet</a>${lastSync?` · ${lastSync}`:""}</span></p>
      </div>
      <div class="hd-top-r">
        <label class="hd-period">${HD_IC.cal}<span>${hdShort(range.from)} – ${hdShort(range.to)}</span>
          <select id="hdPeriod" aria-label="Period">
            <option value="month" ${HD.period==="month"?"selected":""}>This month</option>
            <option value="7" ${HD.period==="7"?"selected":""}>Last 7 days</option>
            <option value="30" ${HD.period==="30"?"selected":""}>Last 30 days</option>
            <option value="90" ${HD.period==="90"?"selected":""}>Last 90 days</option>
            <option value="all" ${HD.period==="all"?"selected":""}>All time</option>
            <optgroup label="Month">${months.map(m=>`<option value="${m}" ${HD.period===m?"selected":""}>${hdDate(m+"-01").toLocaleDateString("en-GB",{ month:"long", year:"numeric" })}</option>`).join("")}</optgroup>
          </select>
          <svg class="hd-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
        </label>
        <button class="btn primary hd-add" data-open="fitEntry">${icon("plus")} Add Entry</button>
      </div>
    </div>

    <div class="hd-kpis">
      ${hdKpi("green", HD_IC.scale, "Weight Change", hdSigned(s.change,1," kg"), s.pct!==null?`<span class="hd-pill ${good?"good":"bad"}">${hdSigned(s.pct,1,"%")} ${HD.period==="month"?"this month":"this period"}</span>`:"")}
      ${hdKpi("violet", icon("flame"), "Total Calories", hdFmt(s.total||null))}
      ${hdKpi("orange", HD_IC.layers, "Avg Calories / Day", hdFmt(s.avgCal))}
      ${hdKpi("sky", HD_IC.dumbbell, "Avg Protein / Day", s.avgProtein!==null?`${hdFmt(s.avgProtein)} g`:"—")}
      ${hdKpi("blue", HD_IC.scale, "Avg Weight", s.avgWeight!==null?`${hdFmt(s.avgWeight,1)} kg`:"—")}
    </div>

    <div class="hd-row">
      <section class="hd-card hd-chart-card">
        <div class="hd-card-h"><h2><span class="hd-ic violet">${HD_IC.chart}</span> ${HD.chart==="weight"?"Weight Progress":"Calories per Day"}</h2>
          <div class="hd-seg" role="radiogroup" aria-label="Chart">
            <button role="radio" aria-checked="${HD.chart==="weight"}" class="${HD.chart==="weight"?"on":""}" data-hd-chart="weight">Weight</button>
            <button role="radio" aria-checked="${HD.chart==="calories"}" class="${HD.chart==="calories"?"on":""}" data-hd-chart="calories">Calories</button>
          </div></div>
        ${hdChart(rows, range)}
      </section>
      <section class="hd-card">
        <div class="hd-card-h"><h2><span class="hd-ic violet">${HD_IC.ring}</span> ${HD.period==="month"?"This Month":range.label} at a Glance</h2></div>
        <div class="hd-glance">
          <div class="hd-ring">
            <svg viewBox="0 0 110 110" aria-hidden="true"><circle cx="55" cy="55" r="46" fill="none" stroke="#ebe6fb" stroke-width="10"/><circle cx="55" cy="55" r="46" fill="none" stroke="#6c4fe0" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C*ringPct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 55 55)"/></svg>
            <div><b>${hdSigned(s.change,1," kg")}</b><span>Weight Change</span></div>
          </div>
          <ul class="hd-glance-l">
            <li><span>${HD_IC.scale} Start Weight</span><b>${s.start!==null?hdFmt(s.start,1)+" kg":"—"}</b></li>
            <li><span>${HD_IC.scale} End Weight</span><b>${s.end!==null?hdFmt(s.end,1)+" kg":"—"}</b></li>
            <li><span>${icon("trending")} Change</span><b class="${s.change===null?"":good?"good":"bad"}">${s.change!==null?`${hdSigned(s.change,1," kg")} (${hdSigned(s.pct,1,"%")})`:"—"}</b></li>
            <li><span>${HD_IC.cal} Days Logged</span><b>${s.days} / ${periodDays}</b></li>
          </ul>
        </div>
      </section>
    </div>

    <section class="hd-card">
      <div class="hd-card-h"><h2><span class="hd-ic violet">${HD_IC.bars}</span> Weekly Summary</h2></div>
      <div class="hd-table-wrap"><table class="hd-table">
        <thead><tr><th>Week</th><th></th><th class="c">Days Logged</th><th class="r">Total Calories</th><th class="r">Avg Cal/Day</th><th class="r">Start Weight</th><th class="r">End Weight</th><th class="r">Change</th></tr></thead>
        <tbody>${weeks.map((w,i)=>`<tr class="${w.from<=todayStr() && todayStr()<=w.to?"cur":""}"><td><b>Week ${i+1}</b></td><td class="muted">${hdShort(w.from)} – ${hdShort(w.to)}</td><td class="c">${w.days}</td><td class="r">${hdFmt(w.total||null)}</td><td class="r">${hdFmt(w.avgCal)}</td><td class="r">${w.start!==null?hdFmt(w.start,1)+" kg":"—"}</td><td class="r">${w.end!==null?hdFmt(w.end,1)+" kg":"—"}</td><td class="r">${w.change===null?"—":`<span class="hd-pill ${w.change<=0?"good":"bad"}">${hdSigned(w.change,1," kg")}</span>`}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>

    <section class="hd-card">
      <div class="hd-card-h hd-log-h"><h2><span class="hd-ic violet">${HD_IC.cal}</span> Daily Log</h2>
        <div class="hd-log-tools">
          <div class="hd-seg" role="radiogroup" aria-label="Show">
            ${[["all","All"],["food","Food"],["weight","Weight"],["calories","Calories"]].map(([k,l])=>`<button role="radio" aria-checked="${HD.filter===k}" class="${HD.filter===k?"on":""}" data-hd-filter="${k}">${l}</button>`).join("")}
          </div>
          <label class="hd-search">${icon("search")}<input id="hdSearch" placeholder="Search entries…" value="${esc(HD.search)}" aria-label="Search entries"/></label>
        </div></div>
      <div class="hd-table-wrap"><table class="hd-table hd-log">
        <thead><tr><th>Date</th><th class="r">Weight (kg)</th><th class="r">Calories</th><th class="r">Protein</th><th>Food / Notes</th><th class="r">Actions</th></tr></thead>
        <tbody>${shown.map(r=>`<tr>
          <td class="nowrap"><span class="hd-date">${r.weight&&r.calories?HD_IC.okc:HD_IC.half}${hdDate(r.date).toLocaleDateString("en-GB",{ weekday:"short", day:"numeric", month:"short" })}</span></td>
          <td class="r">${r.weight?hdFmt(r.weight,1):"—"}</td>
          <td class="r">${r.calories?hdFmt(r.calories):"—"}</td>
          <td class="r">${r.protein?hdFmt(r.protein)+" g":"—"}</td>
          <td class="hd-food">${r.foods?esc(r.foods):'<span class="muted">—</span>'}${r.fromSheet?'<span class="hd-src" title="Synced from your Calorie Tracker sheet">sheet</span>':""}</td>
          <td class="r nowrap"><span class="hd-acts"><button class="icon-btn" data-edit-fit="${r.id}" aria-label="Edit ${hdShort(r.date)}" title="Edit">${icon("edit")}</button><button class="icon-btn" data-hd-del="${r.id}" aria-label="Delete ${hdShort(r.date)}" title="Delete">${icon("trash")}</button></span></td>
        </tr>`).join("") || `<tr><td colspan="6" class="hd-empty">${q?"No entries match your search.":"Nothing logged in this period."}</td></tr>`}</tbody>
      </table></div>
      ${log.length>shown.length?`<button class="btn ghost sm hd-more" data-hd-more>Show all ${log.length} entries</button>`:""}
    </section>
  </div>`;
}
function hdBind(){
  const root = document.getElementById("viewhost");
  const sel = document.getElementById("hdPeriod");
  if(sel) sel.onchange = ()=>{ HD.period = sel.value; HD.showAll = false; hdRemember(); renderView(); };
  root.querySelectorAll("[data-hd-chart]").forEach(b=>b.onclick = ()=>{ HD.chart = b.dataset.hdChart; hdRemember(); renderView(); });
  root.querySelectorAll("[data-hd-filter]").forEach(b=>b.onclick = ()=>{ HD.filter = b.dataset.hdFilter; renderView(); });
  root.querySelectorAll("[data-hd-more]").forEach(b=>b.onclick = ()=>{ HD.showAll = true; renderView(); });
  root.querySelectorAll("[data-hd-del]").forEach(b=>b.onclick = ()=>{
    const r = state.fitnessLog.find(x=>x.id===b.dataset.hdDel); if(!r) return;
    if(r.fromSheet){ toast("This day comes from your Calorie Tracker sheet. Delete it there and it disappears here."); return; }
    if(!confirm(`Delete the entry for ${hdShort(r.date)}?`)) return;
    state.fitnessLog = state.fitnessLog.filter(x=>x.id!==r.id); save(); renderView(); toast("Entry deleted");
  });
  const search = document.getElementById("hdSearch");
  if(search) search.oninput = ()=>{ HD.search = search.value; clearTimeout(hdBind._t); hdBind._t = setTimeout(()=>{ const pos = search.selectionStart; renderView(); const s2 = document.getElementById("hdSearch"); if(s2){ s2.focus(); s2.setSelectionRange(pos,pos); } }, 200); };
  // Chart hover read-out
  root.querySelectorAll(".hd-chart[data-points]").forEach(wrap=>{
    const pts = JSON.parse(wrap.dataset.points); const W = +wrap.dataset.w;
    const svg = wrap.querySelector("svg"), tip = wrap.querySelector(".hd-tip"), cur = wrap.querySelector(".hd-cursor"), dot = wrap.querySelector(".hd-dot");
    const showAt = (p)=>{
      const r = svg.getBoundingClientRect(); const k = r.width / W;
      cur.setAttribute("x1", p.x); cur.setAttribute("x2", p.x); cur.style.display = "";
      if(dot.getAttribute("r")!=="0"){ dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); dot.style.display = ""; }
      tip.innerHTML = `<b>${esc(p.label)}</b>${p.sub?`<span class="${p.down===true?"good":p.down===false?"bad":""}">${p.down===true?"↓ ":p.down===false?"↑ ":""}${esc(p.sub)}</span>`:""}<em>${hdDate(p.date).toLocaleDateString("en-GB",{ weekday:"short", day:"numeric", month:"short" })}</em>`;
      tip.style.display = "";
      const left = Math.min(Math.max(p.x*k, tip.offsetWidth/2+4), r.width - tip.offsetWidth/2 - 4);
      tip.style.left = left + "px"; tip.style.top = Math.max(0, p.y*k - tip.offsetHeight - 14) + "px";
    };
    const hide = ()=>{ tip.style.display = "none"; cur.style.display = "none"; dot.style.display = "none"; };
    svg.addEventListener("mousemove", (e)=>{
      const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * W / r.width;
      let best = pts[0], d = Infinity; pts.forEach(p=>{ const dd = Math.abs(p.x-px); if(dd<d){ d = dd; best = p; } }); showAt(best);
    });
    svg.addEventListener("mouseleave", hide);
    if(HD.chart==="weight" && pts.length) showAt(pts[pts.length-1]);
  });
}
