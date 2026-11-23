// Saves the user's Anthropic API key so the assistant and AI summaries work.
// POST { action: "connect", key } | { action: "status" } | { action: "disconnect" }
// The key is checked with Anthropic first, stored on the user's own row, and
// only ever used server-side. The status reply never includes the key.
const { requireUser, send, readJson } = require("./_auth");
const { anthropicKey, jwtOf, SUPABASE_URL, SUPABASE_ANON_KEY } = require("./_anthropic");
const sdk = require("@anthropic-ai/sdk");
const Anthropic = sdk.default || sdk;

function rest(path, jwt, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { error: "Sign in to the Cockpit first." });
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: "Bad request." }); }
  const jwt = jwtOf(req);

  if (body.action === "status") {
    const k = await anthropicKey(req);
    return send(res, 200, { connected: !!k, source: k ? k.source : null, last4: k ? k.key.slice(-4) : null });
  }
  if (body.action === "disconnect") {
    await rest("app_state?key=eq.anthropic", jwt, { method: "DELETE" });
    return send(res, 200, { ok: true });
  }
  if (body.action === "connect") {
    const key = String(body.key || "").trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return send(res, 400, { error: "That doesn’t look like an Anthropic API key. It starts with sk-ant-." });
    try {
      const client = new Anthropic({ apiKey: key });
      await client.models.list({ limit: 1 });
    } catch (e) {
      const s = e && e.status;
      if (s === 401 || s === 403) return send(res, 400, { error: "Anthropic didn’t accept that key. Check it’s copied in full and not revoked." });
      return send(res, 502, { error: "Couldn’t reach Anthropic to check the key. Try again in a moment." });
    }
    const r = await rest("app_state?on_conflict=user_id,key", jwt, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: user.id, key: "anthropic", value: { key, savedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) return send(res, 500, { error: "Couldn’t save the key to your account." });
    return send(res, 200, { ok: true, last4: key.slice(-4) });
  }
  return send(res, 400, { error: "Unknown request." });
};
