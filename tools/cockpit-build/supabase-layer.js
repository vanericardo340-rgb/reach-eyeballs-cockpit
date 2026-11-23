/* ============================= SUPABASE =============================
   Data lives in Supabase behind the sign-in. Existing tables keep their
   columns; anything a table has no column for (newer client fields, Meta
   client settings) is kept in the app_state table, keyed by user. If
   app_state hasn't been created yet, those extras fall back to this browser. */
const SUPABASE_URL = "https://vcpaadscuyfxkruqjxwt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_88PY1OLTXF1oP8DlUf80HA_uEf3lrV2";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.__userEmail = "";

function toRow(obj, fields){ const o={}; fields.forEach(([c,s])=>{ o[s]= obj[c]===undefined?null:obj[c]; }); return o; }
function fromRow(row, fields){ const o={}; fields.forEach(([c,s])=>{ o[c]=row[s]; }); return o; }

const F_CLIENTS = [["id","id"],["company","company"],["contact","contact"],["status","status"],["model","model"],["runRate","run_rate"],["startDate","start_date"],["adAccountId","ad_account_id"],["notes","notes"]];
const F_ADS = [["id","id"],["clientId","client_id"],["date","date"],["bookings","bookings"],["cancellations","cancellations"],["reschedules","reschedules"],["noShows","no_shows"],["liveCalls","live_calls"],["offersMade","offers_made"],["closedDeals","closed_deals"],["cashCollected","cash_collected"],["followUps","follow_ups"],["notClosedYet","not_closed_yet"],["notes","notes"]];
const F_LEADS = [["id","id"],["clientId","client_id"],["date","date"],["leadName","lead_name"],["outcome","outcome"],["offerMade","offer_made"],["cash","cash"],["notes","notes"]];
const F_AALEADS = [["id","id"],["closerName","closer_name"],["date","date"],["leadName","lead_name"],["outcome","outcome"],["secondCallOutcome","second_call_outcome"],["offerClosedPitched","offer_closed_pitched"],["offerMade","offer_made"],["cash","cash"],["recordingLink","recording_link"]];
const F_FITNESS = [["id","id"],["date","date"],["weight","weight"],["calories","calories"],["protein","protein"],["foods","foods"],["fromSheet","from_sheet"]];
const F_AAMONTHLY = [["adSpend","ad_spend"],["lpViews","lp_views"],["paidTrials","paid_trials"],["fullPackage","full_package"],["revenue","revenue"]];

/* state key → table. Only these tables are read and written. */
const ARRAY_TABLES = [
  ["clients", "clients", F_CLIENTS],
  ["adsLog", "ads_log", F_ADS],
  ["leadsLog", "leads_log", F_LEADS],
  ["adsAcqLeads", "ads_acq_leads", F_AALEADS],
  ["fitnessLog", "fitness_log", F_FITNESS],
];

/* Tables that loaded successfully this session. A table that failed to load is
   never written back, so a network blip can't wipe its rows. */
const loadedOk = new Set();

async function loadArrayTable(table, fields){
  const { data, error } = await sb.from(table).select("*");
  if(error){ console.error("load failed:", table, error); return []; }
  loadedOk.add(table);
  return (data||[]).map(r=>fromRow(r, fields));
}
async function syncArrayTable(table, rows, fields){
  if(!loadedOk.has(table)) return;
  try{
    const { data: existing, error } = await sb.from(table).select("id");
    if(error) throw error;
    const keepIds = new Set(rows.map(r=>r.id));
    const toDelete = (existing||[]).map(r=>r.id).filter(id=>!keepIds.has(id));
    if(toDelete.length) await sb.from(table).delete().in("id", toDelete);
    if(rows.length) await sb.from(table).upsert(rows.map(r=>toRow(r, fields)), { onConflict:"id" });
  }catch(e){ console.error("sync failed:", table, e); }
}
async function loadMonthlyTable(){
  const { data, error } = await sb.from("ads_acq_monthly").select("*");
  if(error){ console.error("load failed: ads_acq_monthly", error); return {}; }
  loadedOk.add("ads_acq_monthly");
  const out = {};
  (data||[]).forEach(r=>{ out[r.month_key] = fromRow(r, F_AAMONTHLY); });
  return out;
}
async function syncMonthlyTable(dict){
  if(!loadedOk.has("ads_acq_monthly")) return;
  try{
    const keys = Object.keys(dict);
    const { data: existing, error } = await sb.from("ads_acq_monthly").select("month_key");
    if(error) throw error;
    const keep = new Set(keys);
    const toDelete = (existing||[]).map(r=>r.month_key).filter(k=>!keep.has(k));
    if(toDelete.length) await sb.from("ads_acq_monthly").delete().in("month_key", toDelete);
    if(keys.length) await sb.from("ads_acq_monthly").upsert(keys.map(k=>Object.assign({month_key:k}, toRow(dict[k], F_AAMONTHLY))), { onConflict:"month_key" });
  }catch(e){ console.error("sync failed: ads_acq_monthly", e); }
}
async function loadSettings(){
  const { data, error } = await sb.from("settings").select("*").eq("id", true).maybeSingle();
  if(error){ console.error("load failed: settings", error); return defaultState().settings; }
  loadedOk.add("settings");
  if(!data) return defaultState().settings;
  return { weightUnit:data.weight_unit, targets:{ showRate:data.target_show_rate, cancellationRate:data.target_cancellation_rate, closeRate:data.target_close_rate, offerCloseRate:data.target_offer_close_rate } };
}
async function syncSettings(settings){
  if(!loadedOk.has("settings")) return;
  try{
    await sb.from("settings").update({
      weight_unit: settings.weightUnit,
      target_show_rate: settings.targets.showRate,
      target_cancellation_rate: settings.targets.cancellationRate,
      target_close_rate: settings.targets.closeRate,
      target_offer_close_rate: settings.targets.offerCloseRate,
    }).eq("id", true);
  }catch(e){ console.error("sync failed: settings", e); }
}

/* ---- extras: fields with no table column, plus Meta client settings ---- */
const EXTRAS_KEY = "cockpit_extras";
const EXTRAS_LOCAL = "reach_eyeballs_cockpit_extras_v1";
let extrasInSupabase = false;
async function loadExtras(){
  try{
    const { data, error } = await sb.from("app_state").select("value").eq("key", EXTRAS_KEY).maybeSingle();
    if(error) throw error;
    extrasInSupabase = true;
    if(data && data.value) return data.value;
  }catch(e){ console.warn("app_state table not available yet; keeping extras in this browser", e); }
  try{ return JSON.parse(localStorage.getItem(EXTRAS_LOCAL) || "{}"); }catch(e){ return {}; }
}
function collectExtras(){
  const rowExtras = {};
  ARRAY_TABLES.forEach(([key, table, fields])=>{
    const known = new Set(fields.map(f=>f[0]));
    (state[key]||[]).forEach(r=>{
      const extra = {};
      Object.keys(r).forEach(k=>{ if(!known.has(k) && r[k]!==undefined) extra[k]=r[k]; });
      if(Object.keys(extra).length) (rowExtras[table] = rowExtras[table] || {})[r.id] = extra;
    });
  });
  return { rowExtras, metaClients: state.metaClients };
}
function applyExtras(extras){
  const rowExtras = (extras && extras.rowExtras) || {};
  ARRAY_TABLES.forEach(([key, table])=>{
    const map = rowExtras[table] || {};
    (state[key]||[]).forEach(r=>{ if(map[r.id]) Object.keys(map[r.id]).forEach(k=>{ if(r[k]===undefined || r[k]===null) r[k]=map[r.id][k]; }); });
  });
  if(extras && Array.isArray(extras.metaClients)) state.metaClients = extras.metaClients;
}
async function syncExtras(){
  const value = collectExtras();
  try{ localStorage.setItem(EXTRAS_LOCAL, JSON.stringify(value)); }catch(e){}
  if(!extrasInSupabase) return;
  try{
    const { data: { session } } = await sb.auth.getSession();
    if(!session) return;
    await sb.from("app_state").upsert({ user_id: session.user.id, key: EXTRAS_KEY, value, updated_at: new Date().toISOString() }, { onConflict:"user_id,key" });
  }catch(e){ console.error("sync failed: app_state", e); }
}

async function loadState(){
  const results = await Promise.all(ARRAY_TABLES.map(([, table, fields])=>loadArrayTable(table, fields)));
  const [adsAcqMonthly, settings, extras] = await Promise.all([loadMonthlyTable(), loadSettings(), loadExtras()]);
  const next = defaultState();
  ARRAY_TABLES.forEach(([key], i)=>{ next[key] = results[i]; });
  next.adsAcqMonthly = adsAcqMonthly;
  next.settings = settings;
  state = next;
  applyExtras(extras);
  return state;
}
let state = defaultState();
let saveTimer = null;
function syncAll(){
  ARRAY_TABLES.forEach(([key, table, fields])=>syncArrayTable(table, state[key]||[], fields));
  syncMonthlyTable(state.adsAcqMonthly);
  syncSettings(state.settings);
  syncExtras();
}
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(syncAll, 400);
}
window.addEventListener("beforeunload", ()=>{ if(saveTimer){ clearTimeout(saveTimer); syncAll(); } });
function uid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
}
