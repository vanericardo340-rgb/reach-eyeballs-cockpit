// Receives Apple Reminders from an iOS/macOS Shortcut.
// POST with header "Authorization: Bearer <Shortcut key>" and either
//   - form/text body: one reminder per line, "Title | due date | list", or
//   - JSON: { reminders: [{ title, due, list, notes, priority }] }.
// The key is hashed and handed to the push_reminders() database function, which
// files the reminders under the key's owner. No sign-in needed (Shortcuts can't).
const crypto = require("crypto");
const { send } = require("./_auth");

const SUPABASE_URL = "https://vcpaadscuyfxkruqjxwt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_88PY1OLTXF1oP8DlUf80HA_uEf3lrV2";

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function parseDue(s) {
  const v = String(s || "").trim();
  if (!v) return null;
  const t = Date.parse(v.replace(" at ", " "));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function normalise(body) {
  let items = [];
  if (typeof body === "string") {
    const t = body.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try { return normalise(JSON.parse(t)); } catch { /* fall through to lines */ }
    }
    const params = new URLSearchParams(t);
    const text = params.has("text") ? params.get("text") : t;
    items = text.split(/\r?\n/).map((line) => {
      const [title, due, list] = line.split("|").map((x) => (x || "").trim());
      return { title, due, list };
    });
  } else if (Array.isArray(body)) {
    items = body;
  } else if (body && typeof body === "object") {
    if (Array.isArray(body.reminders)) items = body.reminders;
    else if (typeof body.text === "string") return normalise(body.text);
  }
  return items
    .map((r) => ({
      title: String(r.title || r.name || "").trim().slice(0, 300),
      due: parseDue(r.due || r.dueDate),
      dueText: String(r.due || r.dueDate || "").trim().slice(0, 80) || null,
      list: String(r.list || "").trim().slice(0, 100) || null,
      notes: r.notes ? String(r.notes).slice(0, 1000) : null,
      priority: r.priority ? String(r.priority).slice(0, 20) : null,
    }))
    .filter((r) => r.title)
    .slice(0, 500);
}

module.exports = async (req, res) => {
  if (req.method === "GET") return send(res, 200, { ok: true, message: "Send reminders with POST from your Shortcut." });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const header = req.headers["authorization"] || "";
  const key = header.replace(/^Bearer\s+/i, "").trim();
  if (!/^ccr_[A-Za-z0-9]{24,}$/.test(key)) return send(res, 401, { error: "Missing or invalid Shortcut key. Copy it from the dashboard: Settings → Integrations → Apple Reminders." });
  let items;
  try {
    items = normalise(await readBody(req));
  } catch {
    return send(res, 400, { error: "Couldn’t read the reminders." });
  }
  const keyHash = crypto.createHash("sha256").update(key).digest("hex");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/push_reminders`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_key_hash: keyHash, p_items: items }),
  });
  const ok = r.ok && (await r.json().catch(() => false)) === true;
  if (!ok) return send(res, 401, { error: "That Shortcut key isn’t recognised. Create a new one in the dashboard and update the Shortcut." });
  return send(res, 200, { ok: true, received: items.length });
};
