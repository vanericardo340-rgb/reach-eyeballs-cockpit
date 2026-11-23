// ClickUp tasks assigned to you that are due by the end of today (overdue included).
// POST { token, endOfDay } with the user's Supabase sign-in.
const { requireUser, send, readJson } = require("./_auth");

const API = "https://api.clickup.com/api/v2";

async function cu(path, token) {
  const r = await fetch(API + path, { headers: { Authorization: token } });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(json.err || `ClickUp error ${r.status}`);
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
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: "Bad request." });
  }
  const token = String(body.token || "").trim();
  if (!/^pk_[\w-]+$/.test(token)) return send(res, 400, { error: "That doesn’t look like a ClickUp personal token. It starts with pk_." });
  const endOfDay = Number(body.endOfDay);
  if (!Number.isFinite(endOfDay)) return send(res, 400, { error: "Bad date." });

  try {
    const [{ user: me }, { teams }] = await Promise.all([cu("/user", token), cu("/team", token)]);
    const tasks = [];
    for (const team of teams || []) {
      for (let page = 0; page < 5; page++) {
        const q = new URLSearchParams({ page: String(page), subtasks: "true", include_closed: "false", due_date_lt: String(endOfDay), order_by: "due_date" });
        q.append("assignees[]", String(me.id));
        const { tasks: batch = [], last_page } = await cu(`/team/${team.id}/task?${q}`, token);
        for (const t of batch) {
          tasks.push({
            id: t.id,
            name: t.name,
            url: t.url,
            due: t.due_date ? Number(t.due_date) : null,
            dueHasTime: t.due_date_time === true,
            status: t.status ? t.status.status : null,
            statusColor: t.status ? t.status.color : null,
            priority: t.priority ? t.priority.priority : null,
            list: t.list ? t.list.name : null,
            space: team.name,
          });
        }
        if (last_page !== false || batch.length < 100) break;
      }
    }
    tasks.sort((a, b) => (a.due || 0) - (b.due || 0));
    return send(res, 200, { tasks, user: me.username, fetchedAt: new Date().toISOString() });
  } catch (e) {
    if (e.status === 401) return send(res, 401, { error: "ClickUp rejected the token. Create a new one under ClickUp Settings → Apps." });
    return send(res, 502, { error: e.message || "ClickUp couldn’t be reached." });
  }
};
