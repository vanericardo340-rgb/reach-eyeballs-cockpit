// Two-way ClickUp for the Cockpit (requires the user's Supabase sign-in).
// POST { action, ... }. The ClickUp personal token is looked up from the
// user's own saved settings (app_state "clickup", or the Daily Command
// Centre settings), or can be passed as `token`.
//   today    { endOfDay }                 open tasks due by end of today
//   all      {}                           every open task + list statuses + lead fields
//   update   { taskId, changes }          status / name / due / priority
//   complete { taskId, done }             tick or untick using the list’s own statuses
//   field    { taskId, fieldId, value }   set (or clear, value null) a custom field
//   create   { listId, name, due?, tags?, priority?, description? }
//   comments { taskId }                   note history (ClickUp comments)
//   comment  { taskId, text }             add a note
//   connect  { token }                    check a token and save it to the account
//   disconnect {}
const { requireUser, send, readJson } = require("./_auth");

const API = "https://api.clickup.com/api/v2";
const SUPABASE_URL = "https://vcpaadscuyfxkruqjxwt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_88PY1OLTXF1oP8DlUf80HA_uEf3lrV2";
const TOKEN_RE = /^pk_[\w-]{10,}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

async function cu(path, token, init = {}) {
  const r = await fetch(API + path, {
    ...init,
    headers: { Authorization: token, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(json.err || `ClickUp error ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return json;
}

function rest(path, jwt, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

async function savedToken(jwt) {
  const r = await rest("app_state?select=key,value&key=in.(clickup,command_centre)", jwt);
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  const own = rows.find((x) => x.key === "clickup");
  const cc = rows.find((x) => x.key === "command_centre");
  const t = (own && own.value && own.value.token) || (cc && cc.value && cc.value.settings && cc.value.settings.clickupToken) || null;
  return t && TOKEN_RE.test(t) ? t : null;
}

const mapTask = (t, spaces) => ({
  id: t.id,
  name: t.name,
  url: t.url,
  description: (t.text_content || "").slice(0, 2000),
  due: t.due_date ? Number(t.due_date) : null,
  dueHasTime: t.due_date_time === true,
  status: t.status ? t.status.status : null,
  statusColor: t.status ? t.status.color : null,
  statusType: t.status ? t.status.type : null,
  priority: t.priority ? t.priority.priority : null,
  list: t.list ? t.list.name : null,
  listId: t.list ? t.list.id : null,
  space: (t.space && spaces[t.space.id]) || null,
  tags: (t.tags || []).map((g) => g.name),
  assignees: (t.assignees || []).map((a) => a.id),
  parent: t.parent || null,
  updatedAt: t.date_updated ? Number(t.date_updated) : null,
  createdAt: t.date_created ? Number(t.date_created) : null,
  fields: (t.custom_fields || []).map((f) => ({ id: f.id, value: f.value === undefined ? null : f.value })),
});

async function allTasks(token, query) {
  const [{ user: me }, { teams }] = await Promise.all([cu("/user", token), cu("/team", token)]);
  const tasks = [];
  const spaces = {};
  for (const team of teams || []) {
    const { spaces: sp = [] } = await cu(`/team/${team.id}/space?archived=false`, token).catch(() => ({ spaces: [] }));
    sp.forEach((s) => (spaces[s.id] = s.name));
    for (let page = 0; page < 10; page++) {
      const q = new URLSearchParams({ page: String(page), subtasks: "true", include_closed: "false", order_by: "due_date", ...query });
      const { tasks: batch = [], last_page } = await cu(`/team/${team.id}/task?${q}`, token);
      batch.forEach((t) => tasks.push(mapTask(t, spaces)));
      if (last_page !== false || batch.length < 100) break;
    }
  }
  // A solo workspace often leaves tasks unassigned: count those as yours.
  return { me, tasks: tasks.filter((t) => !t.assignees.length || t.assignees.includes(me.id)) };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { error: "Sign in to the Cockpit first." });
  const jwt = (req.headers["authorization"] || "").slice(7);
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: "Bad request." });
  }
  const action = String(body.action || "today");

  try {
    if (action === "connect") {
      const token = String(body.token || "").trim();
      if (!TOKEN_RE.test(token)) return send(res, 400, { error: "That doesn’t look like a ClickUp personal token. It starts with pk_." });
      const { user: me } = await cu("/user", token);
      const r = await rest("app_state?on_conflict=user_id,key", jwt, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: user.id, key: "clickup", value: { token, user: me.username }, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) return send(res, 500, { error: "Couldn’t save the token to your account." });
      return send(res, 200, { ok: true, user: me.username });
    }
    if (action === "disconnect") {
      await rest("app_state?key=eq.clickup", jwt, { method: "DELETE" });
      return send(res, 200, { ok: true });
    }

    const token = (body.token && TOKEN_RE.test(String(body.token).trim()) && String(body.token).trim()) || (await savedToken(jwt));
    if (!token) return send(res, 200, { connected: false, tasks: [] });

    if (action === "today") {
      const endOfDay = Number(body.endOfDay);
      if (!Number.isFinite(endOfDay)) return send(res, 400, { error: "Bad date." });
      const { me, tasks } = await allTasks(token, { due_date_lt: String(endOfDay) });
      tasks.sort((a, b) => (a.due || 0) - (b.due || 0));
      return send(res, 200, { connected: true, tasks, user: me.username, fetchedAt: new Date().toISOString() });
    }

    if (action === "all") {
      const { me, tasks } = await allTasks(token, {});
      // Statuses for every list in play, and the Leads list's custom fields.
      const listIds = [...new Set(tasks.map((t) => t.listId).filter(Boolean))];
      const { teams } = await cu("/team", token);
      const hierarchy = [];
      for (const team of teams || []) {
        const { spaces = [] } = await cu(`/team/${team.id}/space?archived=false`, token).catch(() => ({ spaces: [] }));
        for (const s of spaces) {
          const [{ lists: loose = [] }, { folders = [] }] = await Promise.all([
            cu(`/space/${s.id}/list?archived=false`, token).catch(() => ({ lists: [] })),
            cu(`/space/${s.id}/folder?archived=false`, token).catch(() => ({ folders: [] })),
          ]);
          loose.forEach((l) => hierarchy.push({ id: l.id, name: l.name, space: s.name }));
          folders.forEach((f) => (f.lists || []).forEach((l) => hierarchy.push({ id: l.id, name: l.name, space: s.name, folder: f.name })));
        }
      }
      hierarchy.forEach((l) => listIds.includes(l.id) || listIds.push(l.id));
      const lists = await Promise.all(
        listIds.slice(0, 40).map(async (id) => {
          const l = await cu(`/list/${id}`, token).catch(() => null);
          if (!l) return null;
          const h = hierarchy.find((x) => x.id === id) || {};
          return {
            id,
            name: l.name,
            space: (l.space && l.space.name) || h.space || null,
            folder: h.folder || null,
            statuses: (l.statuses || []).map((s) => ({ status: s.status, color: s.color, type: s.type })),
          };
        })
      );
      const leadsList = lists.find((l) => l && /^leads?$/i.test(l.name.trim())) || lists.find((l) => l && /lead/i.test(l.name));
      let leadFields = [];
      let leads = [];
      if (leadsList) {
        const { fields = [] } = await cu(`/list/${leadsList.id}/field`, token).catch(() => ({ fields: [] }));
        leadFields = fields.map((f) => ({ id: f.id, name: f.name, type: f.type, options: ((f.type_config && f.type_config.options) || []).map((o) => ({ id: o.id, name: o.name, color: o.color, orderindex: o.orderindex })) }));
        // Include won/lost leads (closed statuses) so the history is complete.
        const spaces = {};
        for (let page = 0; page < 5; page++) {
          const q = new URLSearchParams({ page: String(page), subtasks: "false", include_closed: "true", order_by: "updated" });
          const { tasks: batch = [], last_page } = await cu(`/list/${leadsList.id}/task?${q}`, token);
          batch.forEach((t) => leads.push(mapTask(t, spaces)));
          if (last_page !== false || batch.length < 100) break;
        }
      }
      return send(res, 200, {
        connected: true,
        user: me.username,
        tasks: tasks.filter((t) => !leadsList || t.listId !== leadsList.id),
        lists: lists.filter(Boolean),
        leadsListId: leadsList ? leadsList.id : null,
        leadFields,
        leads,
        fetchedAt: new Date().toISOString(),
      });
    }

    const taskId = String(body.taskId || "");
    if (["update", "complete", "field", "comments", "comment"].includes(action) && !ID_RE.test(taskId)) return send(res, 400, { error: "Bad task." });

    if (action === "update") {
      const c = body.changes || {};
      const payload = {};
      if (typeof c.status === "string" && c.status.length < 80) payload.status = c.status;
      if (typeof c.name === "string" && c.name.trim()) payload.name = c.name.trim().slice(0, 500);
      if (typeof c.description === "string") payload.description = c.description.slice(0, 10000);
      if (c.due === null) payload.due_date = null;
      else if (Number.isFinite(Number(c.due)) && c.due !== undefined) {
        payload.due_date = Number(c.due);
        payload.due_date_time = c.dueHasTime === true;
      }
      if (c.priority === null) payload.priority = null;
      else if ([1, 2, 3, 4].includes(Number(c.priority))) payload.priority = Number(c.priority);
      if (!Object.keys(payload).length) return send(res, 400, { error: "Nothing to change." });
      const t = await cu(`/task/${taskId}`, token, { method: "PUT", body: JSON.stringify(payload) });
      return send(res, 200, { ok: true, task: mapTask(t, {}) });
    }

    if (action === "complete") {
      // Tick / untick: use the task's own list statuses (closed or done ↔ first open).
      const t = await cu(`/task/${taskId}`, token);
      const l = await cu(`/list/${t.list.id}`, token);
      const sts = l.statuses || [];
      const target = body.done === false
        ? sts.find((s) => s.type === "open") || sts[0]
        : sts.find((s) => s.type === "closed") || sts.find((s) => s.type === "done");
      if (!target) return send(res, 400, { error: "That list has no completed status." });
      const u = await cu(`/task/${taskId}`, token, { method: "PUT", body: JSON.stringify({ status: target.status }) });
      return send(res, 200, { ok: true, task: mapTask(u, {}) });
    }

    if (action === "field") {
      const fieldId = String(body.fieldId || "");
      if (!/^[0-9a-f-]{36}$/i.test(fieldId)) return send(res, 400, { error: "Bad field." });
      if (body.value === null || body.value === "") await cu(`/task/${taskId}/field/${fieldId}`, token, { method: "DELETE" });
      else await cu(`/task/${taskId}/field/${fieldId}`, token, { method: "POST", body: JSON.stringify({ value: body.value }) });
      return send(res, 200, { ok: true });
    }

    if (action === "comments") {
      const { comments = [] } = await cu(`/task/${taskId}/comment`, token);
      return send(res, 200, {
        comments: comments.map((c) => ({ id: c.id, text: c.comment_text || "", date: Number(c.date), user: c.user ? c.user.username : null })),
      });
    }

    if (action === "comment") {
      const text = String(body.text || "").trim();
      if (!text) return send(res, 400, { error: "Write a note first." });
      const c = await cu(`/task/${taskId}/comment`, token, { method: "POST", body: JSON.stringify({ comment_text: text.slice(0, 5000), notify_all: false }) });
      return send(res, 200, { ok: true, comment: { id: c.id, text, date: Number(c.date) || Date.now(), user: null } });
    }

    if (action === "create") {
      const listId = String(body.listId || "");
      const name = String(body.name || "").trim();
      if (!ID_RE.test(listId)) return send(res, 400, { error: "Choose a list." });
      if (!name) return send(res, 400, { error: "Give the task a name." });
      const payload = { name: name.slice(0, 500) };
      if (Number.isFinite(Number(body.due)) && body.due) {
        payload.due_date = Number(body.due);
        payload.due_date_time = body.dueHasTime === true;
      }
      if (Array.isArray(body.tags)) payload.tags = body.tags.filter((x) => typeof x === "string").slice(0, 5);
      if ([1, 2, 3, 4].includes(Number(body.priority))) payload.priority = Number(body.priority);
      if (typeof body.description === "string" && body.description.trim()) payload.description = body.description.slice(0, 10000);
      if (typeof body.status === "string" && body.status) payload.status = body.status;
      const t = await cu(`/list/${listId}/task`, token, { method: "POST", body: JSON.stringify(payload) });
      if (body.fields && typeof body.fields === "object") {
        for (const [fid, value] of Object.entries(body.fields)) {
          if (/^[0-9a-f-]{36}$/i.test(fid) && value !== null && value !== "") {
            await cu(`/task/${t.id}/field/${fid}`, token, { method: "POST", body: JSON.stringify({ value }) }).catch(() => {});
          }
        }
      }
      return send(res, 200, { ok: true, task: mapTask(t, {}) });
    }

    return send(res, 400, { error: "Unknown action." });
  } catch (e) {
    if (e.status === 401) return send(res, 401, { error: "ClickUp rejected the token. Create a new one under ClickUp Settings → Apps." });
    return send(res, 502, { error: e.message || "ClickUp couldn’t be reached." });
  }
};
