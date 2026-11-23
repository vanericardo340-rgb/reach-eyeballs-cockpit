// GET today's calendar events from a private iCal (ICS) feed.
// POST { url, from, to } with the user's Supabase sign-in.
const { requireUser, send, readJson } = require("./_auth");
const { expand } = require("./_ics");

const ALLOWED_HOSTS = [/^calendar\.google\.com$/, /^p\d+-caldav\.icloud\.com$/, /^outlook\.(office365|live)\.com$/, /^outlook\.office\.com$/];

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { error: "Sign in to the Cockpit first." });
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: "Bad request." });
  }
  let feed;
  try {
    feed = new URL(String(body.url || "").trim().replace(/^webcal:/i, "https:"));
  } catch {
    return send(res, 400, { error: "That calendar link isn’t a valid address." });
  }
  if (feed.protocol !== "https:" || !ALLOWED_HOSTS.some((r) => r.test(feed.hostname))) {
    return send(res, 400, { error: "Use your Google Calendar “Secret address in iCal format” (it starts with https://calendar.google.com/)." });
  }
  const from = Date.parse(body.from);
  const to = Date.parse(body.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 40 * 86400000) return send(res, 400, { error: "Bad date range." });

  let text;
  try {
    const r = await fetch(feed.toString(), { headers: { "User-Agent": "ReachEyeballsCockpit/1.0" }, redirect: "follow" });
    if (r.status === 404 || r.status === 403) return send(res, 502, { error: "Google didn’t accept that link. It may have been reset: copy the secret iCal address again." });
    if (!r.ok) return send(res, 502, { error: `The calendar couldn’t be fetched (status ${r.status}).` });
    text = await r.text();
  } catch {
    return send(res, 502, { error: "The calendar couldn’t be reached. Try again in a moment." });
  }
  if (!/BEGIN:VCALENDAR/.test(text)) return send(res, 502, { error: "That link didn’t return a calendar. Make sure it’s the iCal address, not the public web page." });

  try {
    const events = expand(text, from, to);
    return send(res, 200, { events, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return send(res, 500, { error: "The calendar was fetched but couldn’t be read." });
  }
};
