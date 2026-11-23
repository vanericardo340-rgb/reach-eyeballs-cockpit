// GoHighLevel: open opportunities with their contact, stage and pipeline.
// POST { token, locationId } with the user's Supabase sign-in.
// token = a Private Integration token (Settings → Private Integrations) with the
// opportunities.readonly and contacts.readonly scopes.
const { requireUser, send, readJson } = require("./_auth");

const API = "https://services.leadconnectorhq.com";

async function ghl(path, token) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" } });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(json.message ? (Array.isArray(json.message) ? json.message.join(", ") : json.message) : `GoHighLevel error ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return json;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { error: "Sign in to the Cockpit first." });
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: "Bad request." }); }
  const token = String(body.token || "").trim();
  const locationId = String(body.locationId || "").trim();
  if (!token || token.length < 20) return send(res, 400, { error: "Add your GoHighLevel Private Integration token." });
  if (!/^[A-Za-z0-9]{10,40}$/.test(locationId)) return send(res, 400, { error: "Add your GoHighLevel Location ID (Settings → Business Profile)." });

  try {
    const { pipelines = [] } = await ghl(`/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, token);
    const stageName = {}, pipelineName = {};
    for (const p of pipelines) {
      pipelineName[p.id] = p.name;
      for (const st of p.stages || []) stageName[st.id] = st.name;
    }
    const opps = [];
    let query = `/opportunities/search?location_id=${encodeURIComponent(locationId)}&status=open&limit=100`;
    for (let page = 0; page < 5 && query; page++) {
      const data = await ghl(query, token);
      for (const o of data.opportunities || []) {
        const c = o.contact || {};
        opps.push({
          id: o.id,
          name: o.name || c.name || "Opportunity",
          contactId: o.contactId || c.id || null,
          contactName: c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
          company: c.companyName || null,
          email: c.email || null,
          phone: c.phone || null,
          value: typeof o.monetaryValue === "number" ? o.monetaryValue : null,
          pipeline: pipelineName[o.pipelineId] || null,
          stage: stageName[o.pipelineStageId] || null,
          source: o.source || null,
          updatedAt: o.updatedAt || o.lastStatusChangeAt || o.createdAt || null,
          url: o.contactId || c.id ? `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${o.contactId || c.id}` : null,
        });
      }
      const meta = data.meta || {};
      query = meta.startAfterId && (data.opportunities || []).length === 100
        ? `/opportunities/search?location_id=${encodeURIComponent(locationId)}&status=open&limit=100&startAfterId=${encodeURIComponent(meta.startAfterId)}&startAfter=${encodeURIComponent(meta.startAfter || "")}`
        : null;
    }
    opps.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return send(res, 200, { opportunities: opps, pipelines: pipelines.map((p) => p.name), fetchedAt: new Date().toISOString() });
  } catch (e) {
    if (e.status === 401 || e.status === 403) return send(res, 401, { error: "GoHighLevel rejected the token. Check it has the opportunities.readonly and contacts.readonly scopes, and that the Location ID matches." });
    return send(res, 502, { error: e.message || "GoHighLevel couldn’t be reached." });
  }
};
