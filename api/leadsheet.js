// Relay to the lead tracker's Apps Script web app (two-way sheet sync).
// POST { action: "pull", url, key }          → { ok, sheet, headers, rows }
// POST { action: "push", url, key, items }   → { ok, results }
// Requires the user's Supabase sign-in. The script only answers requests that
// carry the secret key it was set up with, so the sheet itself stays private.
const { requireUser, send, readJson } = require("./_auth");

const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec\/?$/;

async function call(url, init) {
  let r;
  try {
    r = await fetch(url, { ...init, redirect: "follow" });
  } catch {
    throw Object.assign(new Error("Google couldn’t be reached. Try again in a moment."), { status: 502 });
  }
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    if (/accounts\.google\.com|sign in/i.test(text)) throw Object.assign(new Error("Google asked for a sign-in. Redeploy the script with “Who has access: Anyone”."), { status: 502 });
    throw Object.assign(new Error("The sheet script replied with something unexpected. Check it was pasted in full and deployed as a web app."), { status: 502 });
  }
  if (!j.ok) throw Object.assign(new Error(j.error === "Wrong key" ? "The script’s key doesn’t match. Copy the script from the Cockpit again and redeploy it." : j.error || "The sheet script returned an error."), { status: 502 });
  return j;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { error: "Sign in to the Cockpit first." });
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: "Bad request." }); }
  const url = String(body.url || "").trim();
  const key = String(body.key || "");
  if (!URL_RE.test(url)) return send(res, 400, { error: "Use the web app link from Deploy → Manage deployments (it ends in /exec)." });
  if (key.length < 20) return send(res, 400, { error: "Missing sync key." });
  try {
    if (body.action === "pull") return send(res, 200, await call(`${url}?key=${encodeURIComponent(key)}`, { method: "GET" }));
    if (body.action === "push") {
      const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
      if (!items.length) return send(res, 200, { ok: true, results: [] });
      return send(res, 200, await call(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ key, items }) }));
    }
    return send(res, 400, { error: "Unknown request." });
  } catch (e) {
    return send(res, e.status || 502, { error: e.message });
  }
};
