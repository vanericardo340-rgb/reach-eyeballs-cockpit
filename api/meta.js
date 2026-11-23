// Meta Ads for the Cockpit's Client Ads tab, straight from the Marketing API.
// Requires the user's Supabase sign-in. The Meta access token is saved to the
// user's own account (app_state "meta") and only ever used here, server-side.
//
// POST { action: "connect", token }  → checks the token with Meta and saves it
// POST { action: "status" }          → { connected, user }
// POST { action: "disconnect" }
// POST { tool, args }                → same request/response shape the tab used
//                                       with the claude.ai Meta Ads connector:
//   tool "ads_get_ad_accounts"  → { payload: { ad_accounts: [...] } }
//   tool "ads_get_ad_entities"  → { payload: { ad_entities: [...] } }
const { requireUser, send, readJson } = require("./_auth");

const GRAPH = "https://graph.facebook.com/v23.0";
const SUPABASE_URL = "https://vcpaadscuyfxkruqjxwt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_88PY1OLTXF1oP8DlUf80HA_uEf3lrV2";
const ACCOUNT_STATUS = { 1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_RISK_REVIEW", 8: "PENDING_SETTLEMENT", 9: "IN_GRACE_PERIOD", 100: "PENDING_CLOSURE", 101: "CLOSED", 201: "ANY_ACTIVE", 202: "ANY_CLOSED" };
const LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "leadgen_grouped", "onsite_conversion.lead"];

class MetaError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.code = code;
    this.retryable = !!retryable;
  }
}

function rest(path, jwt, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
async function savedToken(jwt) {
  const r = await rest("app_state?select=value&key=eq.meta", jwt);
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return (rows[0] && rows[0].value && rows[0].value.token) || null;
}

async function graph(path, token, params = {}) {
  const u = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  u.searchParams.set("access_token", token);
  const r = await fetch(u, { headers: { Accept: "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    if (e.code === 190 || e.type === "OAuthException" && /expired|session|validat/i.test(e.message || "")) throw new MetaError("needs_reauth", "Your Meta access token has expired or was revoked.");
    if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613 || e.code === 80004) throw new MetaError("rate_limited", "Meta is rate-limiting requests. Try again in a minute.", true);
    if (e.code === 10 || e.code === 200 || e.code === 100 && /permission/i.test(e.message || "")) throw new MetaError("tool_error", `No permission: ${e.message || "Meta refused access"}. The token needs ads_read access to this ad account.`);
    throw new MetaError("tool_error", e.error_user_msg || e.message || `Meta error ${r.status}`);
  }
  return j;
}
/** Follows Graph paging up to `max` rows. */
async function graphAll(path, token, params, max = 2000) {
  let out = [];
  let page = await graph(path, token, { limit: 500, ...params });
  out = out.concat(page.data || []);
  while (page.paging && page.paging.next && out.length < max) {
    const r = await fetch(page.paging.next);
    page = await r.json().catch(() => ({}));
    if (page.error) throw new MetaError("tool_error", page.error.message || "Meta paging error");
    out = out.concat(page.data || []);
  }
  return out;
}

const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
function actionSum(list, types) {
  if (!Array.isArray(list)) return 0;
  let best = 0;
  // Meta reports the same lead under several action types; use the largest single one.
  for (const t of types) {
    const a = list.find((x) => x.action_type === t);
    if (a) best = Math.max(best, Number(a.value) || 0);
  }
  return best;
}
function insightRow(x) {
  const spend = num(x.spend) || 0;
  const leads = actionSum(x.actions, LEAD_TYPES);
  const link = num(x.inline_link_clicks) ?? actionSum(x.actions, ["link_click"]);
  return {
    date_start: x.date_start,
    date_stop: x.date_stop,
    amount_spent: spend,
    impressions: num(x.impressions) || 0,
    reach: num(x.reach) || 0,
    clicks: num(x.clicks) || 0,
    link_click: link || 0,
    ctr: num(x.ctr),
    cpc: num(x.cpc),
    cpm: num(x.cpm),
    frequency: num(x.frequency),
    lead: leads,
    cost_per_lead: leads ? spend / leads : null,
  };
}
const INSIGHT_FIELDS = "spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc,cpm,frequency,actions";
const acctPath = (id) => `/act_${String(id).replace(/^act_/, "")}`;

async function adAccounts(token) {
  const rows = await graphAll("/me/adaccounts", token, { fields: "account_id,name,account_status,currency,timezone_name,disable_reason,funding_source_details,business{name}" }, 1000);
  return rows.map((a) => ({
    ad_account_id: String(a.account_id),
    name: a.name,
    currency: a.currency,
    timezone_name: a.timezone_name,
    account_status: ACCOUNT_STATUS[a.account_status] || String(a.account_status || ""),
    is_queryable: true,
    has_payment_method: a.funding_source_details ? true : a.account_status === 1 ? undefined : false,
    business_name: a.business && a.business.name,
  }));
}

function resultsFor(objective, row) {
  const o = String(objective || "");
  if (/LEAD/i.test(o) || (row.lead && !/TRAFFIC|LINK_CLICK|AWARENESS|REACH|ENGAGEMENT|VIDEO/i.test(o))) {
    return { results: { indicator: "actions:lead", values: [{ value: row.lead }] }, cost: row.lead ? row.amount_spent / row.lead : null };
  }
  if (/TRAFFIC|LINK_CLICK/i.test(o)) return { results: { indicator: "actions:link_click", values: [{ value: row.link_click }] }, cost: row.link_click ? row.amount_spent / row.link_click : null };
  if (/AWARENESS|REACH/i.test(o)) return { results: { indicator: "reach", values: [{ value: row.reach }] }, cost: row.reach ? (row.amount_spent / row.reach) * 1000 : null };
  if (row.lead) return { results: { indicator: "actions:lead", values: [{ value: row.lead }] }, cost: row.amount_spent / row.lead };
  return { results: { indicator: "actions:link_click", values: [{ value: row.link_click }] }, cost: row.link_click ? row.amount_spent / row.link_click : null };
}

async function adEntities(token, a) {
  const acct = a.ad_account_id;
  if (!/^\d{5,25}$/.test(String(acct || ""))) throw new MetaError("tool_error", "Missing ad account.");
  const level = a.level || "ad_account";
  const timeRange = a.time_range ? (typeof a.time_range === "string" ? JSON.parse(a.time_range) : a.time_range) : null;
  const filters = Array.isArray(a.filtering) ? a.filtering : [];
  const campaignFilter = filters.find((f) => f.field === "campaign_id");
  const statusFilter = filters.find((f) => f.field === "effective_status");

  if (level === "ad_account") {
    const params = { fields: INSIGHT_FIELDS, time_range: timeRange || undefined, level: "account" };
    if (a.time_increment) params.time_increment = String(a.time_increment);
    const [rows, info] = await Promise.all([
      graphAll(`${acctPath(acct)}/insights`, token, params, 400),
      Array.isArray(a.fields) && a.fields.includes("timezone_name") ? graph(acctPath(acct), token, { fields: "timezone_name" }).catch(() => ({})) : Promise.resolve({}),
    ]);
    const out = rows.map(insightRow);
    if (!out.length && !a.time_increment) out.push(insightRow({}));
    if (info.timezone_name) out.forEach((r) => (r.timezone_name = info.timezone_name));
    return out;
  }

  // Campaign / ad set / ad level: entity details merged with their insights.
  const edge = level === "campaign" ? "campaigns" : level === "adset" ? "adsets" : "ads";
  const entityFields = ["id", "name", "effective_status", level === "campaign" ? "objective" : "campaign_id", level !== "ad" ? "daily_budget" : null, level !== "ad" ? "lifetime_budget" : null, level === "ad" ? "adset_id" : null, level !== "campaign" ? "campaign{objective}" : null].filter(Boolean).join(",");
  const entityParams = { fields: entityFields };
  if (statusFilter) entityParams.effective_status = statusFilter.value;
  if (campaignFilter) entityParams.filtering = [{ field: "campaign.id", operator: "IN", value: campaignFilter.value }];
  const onlyEntities = statusFilter && !timeRange; // delivery check: just which ads are switched on
  const [entities, insights] = await Promise.all([
    graphAll(`${acctPath(acct)}/${edge}`, token, entityParams, a.limit && onlyEntities ? a.limit : 2000),
    onlyEntities
      ? Promise.resolve([])
      : graphAll(`${acctPath(acct)}/insights`, token, {
          level,
          fields: `${INSIGHT_FIELDS},campaign_id,adset_id,ad_id`,
          time_range: timeRange || undefined,
          filtering: campaignFilter ? [{ field: "campaign.id", operator: "IN", value: campaignFilter.value }] : undefined,
        }),
  ]);
  const idKey = level === "campaign" ? "campaign_id" : level === "adset" ? "adset_id" : "ad_id";
  const byId = new Map(insights.map((x) => [String(x[idKey]), insightRow(x)]));
  let rows = entities.map((e) => {
    const ins = byId.get(String(e.id)) || insightRow({});
    const objective = e.objective || (e.campaign && e.campaign.objective) || "";
    const { results, cost } = resultsFor(objective, ins);
    return {
      id: e.id,
      name: e.name,
      effective_status: e.effective_status,
      objective: e.objective,
      campaign_id: e.campaign_id,
      adset_id: e.adset_id,
      // Budgets come back in the currency's minor unit (pence / cents).
      daily_budget: e.daily_budget ? Number(e.daily_budget) / 100 : undefined,
      lifetime_budget: e.lifetime_budget ? Number(e.lifetime_budget) / 100 : undefined,
      ...ins,
      results,
      cost_per_result: cost,
    };
  });
  // Keep what spent in the period, plus anything switched on.
  if (!onlyEntities) rows = rows.filter((r) => r.amount_spent > 0 || r.impressions > 0 || r.effective_status === "ACTIVE");
  rows.sort((x, y) => y.amount_spent - x.amount_spent);
  return rows;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { error: "Sign in to the Cockpit first.", code: "not_signed_in" });
  const jwt = (req.headers["authorization"] || "").slice(7);
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: "Bad request." });
  }

  try {
    if (body.action === "connect") {
      const token = String(body.token || "").trim();
      if (!/^[A-Za-z0-9_-]{60,}$/.test(token)) return send(res, 400, { error: "That doesn’t look like a Meta access token (it’s a long string starting with EAA)." });
      const me = await graph("/me", token, { fields: "id,name" });
      const accounts = await adAccounts(token);
      const r = await rest("app_state?on_conflict=user_id,key", jwt, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: user.id, key: "meta", value: { token, user: me.name, connectedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) return send(res, 500, { error: "Couldn’t save the token to your account." });
      return send(res, 200, { ok: true, user: me.name, accounts: accounts.length });
    }
    if (body.action === "disconnect") {
      await rest("app_state?key=eq.meta", jwt, { method: "DELETE" });
      return send(res, 200, { ok: true });
    }
    const token = await savedToken(jwt);
    if (body.action === "status") {
      if (!token) return send(res, 200, { connected: false });
      const me = await graph("/me", token, { fields: "id,name" });
      return send(res, 200, { connected: true, user: me.name });
    }
    if (!token) return send(res, 409, { code: "not_connected", error: "Connect Meta to load live data." });

    const args = body.args || {};
    if (body.tool === "ads_get_ad_accounts") return send(res, 200, { payload: { ad_accounts: await adAccounts(token) } });
    if (body.tool === "ads_get_ad_entities") return send(res, 200, { payload: { ad_entities: await adEntities(token, args) } });
    return send(res, 400, { error: "Unknown request." });
  } catch (e) {
    if (e instanceof MetaError) return send(res, e.code === "needs_reauth" ? 401 : e.code === "rate_limited" ? 429 : 502, { code: e.code, error: e.message, retryable: e.retryable });
    return send(res, 502, { code: "server_unavailable", error: "Meta couldn’t be reached. Try again in a moment." });
  }
};
