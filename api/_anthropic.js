// Finds the Anthropic API key for a signed-in user: the Vercel environment
// variable if one is set, otherwise the key the user saved in the Cockpit
// (app_state "anthropic", readable only by them under row-level security).
const SUPABASE_URL = "https://vcpaadscuyfxkruqjxwt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_88PY1OLTXF1oP8DlUf80HA_uEf3lrV2";

function jwtOf(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

async function anthropicKey(req) {
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: "vercel" };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/app_state?select=value&key=eq.anthropic`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwtOf(req)}` },
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const rows = await r.json().catch(() => []);
  const key = rows[0] && rows[0].value && rows[0].value.key;
  return key ? { key, source: "account" } : null;
}

module.exports = { anthropicKey, jwtOf, SUPABASE_URL, SUPABASE_ANON_KEY };
