// All EOD reports from the Google Form's responses sheet.
// POST { url } (the responses sheet link) with the user's Supabase sign-in.
const { requireUser, send, readJson } = require("./_auth");

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const dmy = (s) => {
  const m = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};
const COLS = {
  coldCalls: /cold\s*calls?/i,
  salesCalls: /sales\s*calls?/i,
  couldDoBetter: /(could|should).*better/i,
  reflections: /reflection/i,
  tomorrowPriority: /tomorrow/i,
  bank: /bank|money|balance/i,
  weight: /weigh/i,
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { error: "Sign in to the Cockpit first." });
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: "Bad request." }); }
  const url = String(body.url || "");
  const id = url.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!id) return send(res, 400, { error: "Use the responses sheet link." });
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1];
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id[1]}/gviz/tq?tqx=out:csv&headers=1${gid ? `&gid=${gid}` : ""}`, { redirect: "follow" });
    const text = await r.text();
    if (!r.ok || /^\s*<!doctype html|<html/i.test(text)) return send(res, 502, { error: "The EOD responses sheet isn’t shared. Share → Anyone with the link → Viewer." });
    const rows = parseCSV(text);
    const headers = (rows[0] || []).map((h) => h.trim());
    const col = {};
    for (const [k, re] of Object.entries(COLS)) col[k] = headers.findIndex((h) => re.test(h));
    const dateCol = headers.findIndex((h) => /^date$/i.test(h));
    const tsCol = headers.findIndex((h) => /timestamp/i.test(h));
    const entries = rows.slice(1).map((row) => {
      const e = { date: dmy(row[dateCol]) || dmy(row[tsCol]), submittedAt: row[tsCol] || null, source: "form" };
      for (const k of Object.keys(COLS)) e[k] = col[k] >= 0 ? String(row[col[k]] || "").trim() : "";
      return e;
    }).filter((e) => e.date && (e.couldDoBetter || e.reflections || e.coldCalls || e.salesCalls));
    entries.sort((a, b) => b.date.localeCompare(a.date));
    return send(res, 200, { entries, headers, fetchedAt: new Date().toISOString() });
  } catch {
    return send(res, 502, { error: "Google Sheets couldn’t be reached. Try again in a moment." });
  }
};
