// Submits an EOD report to the user's Google Form, exactly like filling it in.
// POST { formUrl, answers: { date, coldCalls, salesCalls, couldDoBetter, reflections, tomorrowPriority, bank, weight } }
// Answers are matched to the form's questions by their wording; questions the form
// doesn't have are skipped (and reported back).
const { requireUser, send, readJson } = require("./_auth");

const MATCHERS = {
  date: /^\s*date\b/i,
  coldCalls: /cold\s*calls?/i,
  salesCalls: /sales\s*calls?/i,
  couldDoBetter: /(could|should).*(done|do).*better|improve(?!ments)/i,
  reflections: /reflection/i,
  tomorrowPriority: /tomorrow/i,
  bank: /bank|money|balance|savings/i,
  weight: /weigh/i,
};

function formId(url) {
  const m = String(url || "").match(/^https:\/\/docs\.google\.com\/forms\/d\/(e\/)?([A-Za-z0-9_-]+)/);
  return m ? { published: !!m[1], id: m[2] } : null;
}

/** Questions from the form page: [{ title, entry, type, required }]. */
function parseQuestions(html) {
  const m = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
  if (!m) return null;
  const data = JSON.parse(m[1]);
  const items = (data[1] && data[1][1]) || [];
  const out = [];
  let pages = 0;
  for (const it of items) {
    const type = it[3];
    if (type === 8) pages++;
    const fields = it[4];
    if (!Array.isArray(fields) || !fields.length) continue;
    out.push({ title: String(it[1] || ""), entry: fields[0][0], type, required: !!fields[0][2] });
  }
  return { questions: out, pages, actionId: data[14] };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { error: "Sign in to the Cockpit first." });
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: "Bad request." }); }
  const f = formId(body.formUrl);
  if (!f) return send(res, 400, { error: "Use the Google Form link (https://docs.google.com/forms/…)." });
  const base = `https://docs.google.com/forms/d/${f.published ? "e/" : ""}${f.id}`;

  let html;
  try {
    const r = await fetch(`${base}/viewform`, { redirect: "follow" });
    if (!r.ok) return send(res, 502, { error: `The form couldn’t be opened (status ${r.status}). Make sure it accepts responses without sign-in.` });
    html = await r.text();
  } catch {
    return send(res, 502, { error: "Google Forms couldn’t be reached. Try again in a moment." });
  }
  if (/accounts\.google\.com\/(v3\/)?signin|ServiceLogin/i.test(html) && !/FB_PUBLIC_LOAD_DATA_/.test(html)) {
    return send(res, 502, { error: "The form requires a Google sign-in. In the form’s Settings → Responses, turn off “Restrict to users in…” and “Limit to 1 response”." });
  }
  let parsed;
  try { parsed = parseQuestions(html); } catch { parsed = null; }
  if (!parsed) return send(res, 502, { error: "That page didn’t look like a Google Form." });
  // The submit URL uses the published form id, which the page links to.
  const pub = html.match(/\/forms\/d\/e\/([A-Za-z0-9_-]+)\/formResponse/);
  const submitUrl = pub ? `https://docs.google.com/forms/d/e/${pub[1]}/formResponse` : `${base}/formResponse`;

  const answers = body.answers || {};
  const params = new URLSearchParams();
  const used = [], missing = [];
  for (const [key, re] of Object.entries(MATCHERS)) {
    const value = answers[key];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const q = parsed.questions.find((x) => re.test(x.title) && !used.includes(x.entry));
    if (!q) { missing.push(key); continue; }
    used.push(q.entry);
    if (q.type === 9) {
      const [y, m, d] = String(value).split("-");
      params.append(`entry.${q.entry}_year`, y);
      params.append(`entry.${q.entry}_month`, String(Number(m)));
      params.append(`entry.${q.entry}_day`, String(Number(d)));
    } else {
      params.append(`entry.${q.entry}`, String(value));
    }
  }
  const unanswered = parsed.questions.filter((q) => q.required && !used.includes(q.entry)).map((q) => q.title);
  if (unanswered.length) return send(res, 422, { error: `The form has required questions the dashboard can’t fill: ${unanswered.join(", ")}.` });
  params.append("fvv", "1");
  params.append("pageHistory", Array.from({ length: parsed.pages + 1 }, (_, i) => i).join(","));

  try {
    const r = await fetch(submitUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(), redirect: "follow" });
    if (!r.ok) return send(res, 502, { error: `Google Forms didn’t accept the response (status ${r.status}).` });
    return send(res, 200, { ok: true, skipped: missing });
  } catch {
    return send(res, 502, { error: "Google Forms couldn’t be reached. Try again in a moment." });
  }
};

module.exports.parseQuestions = parseQuestions;
