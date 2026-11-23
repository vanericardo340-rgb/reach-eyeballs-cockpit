// Reads the calorie tracker Google Sheet (shared "anyone with the link can view")
// as CSV and returns { date, weight, calories, protein, meals } rows.
// POST { url } with the user's Supabase sign-in.
const { requireUser, send, readJson } = require("./_auth");

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// The sheet uses day/month/year dates.
function parseDate(s) {
  const m = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}
function parseNum(s) {
  const v = String(s || "").replace(/,/g, "").trim();
  return v === "" || isNaN(Number(v)) ? null : Number(v);
}

const MONTHS = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)(\s+\d{4})?$/i;

/** Tabs of the spreadsheet as [{ name, gid }], read from its public HTML view. */
async function listTabs(id) {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`, { redirect: "follow" });
  if (!r.ok) return [];
  const html = await r.text();
  const tabs = [];
  const re = /\{name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(\d+)"/g;
  let m;
  while ((m = re.exec(html))) tabs.push({ name: m[1].replace(/\\(.)/g, "$1"), gid: m[2] });
  return tabs;
}

async function tabRows(id, gid) {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=0&gid=${gid}`, { redirect: "follow" });
  if (!r.ok) {
    const err = new Error(String(r.status));
    err.status = r.status;
    throw err;
  }
  const text = await r.text();
  if (/^\s*<!doctype html|<html/i.test(text)) {
    const err = new Error("not shared");
    err.status = 403;
    throw err;
  }
  return parseCSV(text);
}

/**
 * Each daily row has a dd/mm/yyyy date followed by calories, weight and meals
 * (the tracker's layout). A header row naming DATE / CALORIES / WEIGHT, when
 * present, takes precedence.
 */
function extract(rows) {
  let idx = null;
  for (const row of rows) {
    const norm = row.map((c) => c.trim().toUpperCase());
    if (["DATE", "CALORIES", "WEIGHT"].every((w) => norm.includes(w))) {
      idx = { DATE: norm.indexOf("DATE"), CALORIES: norm.indexOf("CALORIES"), WEIGHT: norm.indexOf("WEIGHT"), MEALS: norm.indexOf("MEALS"), PROTEIN: norm.indexOf("PROTEIN") };
      break;
    }
  }
  const out = [];
  for (const row of rows) {
    let di = idx ? idx.DATE : row.findIndex((c) => parseDate(c));
    if (di < 0) continue;
    const date = parseDate(row[di]);
    if (!date) continue;
    const ci = idx ? idx.CALORIES : di + 1;
    const wi = idx ? idx.WEIGHT : di + 2;
    const mi = idx ? idx.MEALS : di + 3;
    let calories = parseNum(row[ci]);
    let weight = parseNum(row[wi]);
    if (calories !== null && (calories < 0 || calories > 20000)) calories = null;
    if (weight !== null && (weight < 25 || weight > 300)) weight = null;
    const e = { date, weight, calories, protein: idx && idx.PROTEIN >= 0 ? parseNum(row[idx.PROTEIN]) : null, meals: mi >= 0 ? String(row[mi] || "").trim() : "" };
    if (e.weight === null && e.calories === null && !e.meals) continue;
    out.push(e);
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { error: "Sign in to the Cockpit first." });
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: "Bad request." }); }
  const url = String(body.url || "");
  const id = url.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!id) return send(res, 400, { error: "Use a Google Sheets link (https://docs.google.com/spreadsheets/…)." });
  const linkGid = (url.match(/[#&?]gid=(\d+)/) || [])[1];

  try {
    // Read every month tab (the tracker keeps one per month), plus the linked tab.
    const tabs = await listTabs(id[1]).catch(() => []);
    const gids = new Set(tabs.filter((t) => MONTHS.test(t.name.trim())).map((t) => t.gid));
    if (linkGid) gids.add(linkGid);
    if (!gids.size) gids.add("0");
    const results = await Promise.all([...gids].map((g) => tabRows(id[1], g).then(extract)));
    const byDate = new Map();
    for (const list of results) for (const e of list) {
      const prev = byDate.get(e.date);
      byDate.set(e.date, prev ? { ...prev, ...Object.fromEntries(Object.entries(e).filter(([, v]) => v !== null && v !== "")) } : e);
    }
    const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    return send(res, 200, { rows, tabs: gids.size, fetchedAt: new Date().toISOString() });
  } catch (e) {
    if (e.status === 401 || e.status === 403 || e.status === 404) return send(res, 502, { error: "The sheet isn’t shared. In Google Sheets: Share → General access → Anyone with the link → Viewer." });
    return send(res, 502, { error: "Google Sheets couldn’t be read. Try again in a moment." });
  }
};
