// AI coaching summary of the user's EOD reports, like Google Forms' response
// summaries but focused on what to improve. POST { entries } with the user's sign-in.
// Needs ANTHROPIC_API_KEY in the Vercel project's environment variables.
const { requireUser, send, readJson } = require("./_auth");
const sdk = require("@anthropic-ai/sdk");
const Anthropic = sdk.default || sdk;
const { jsonSchemaOutputFormat } = require("@anthropic-ai/sdk/helpers/json-schema");

const theme = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short theme name, e.g. Time management" },
    summary: { type: "string", description: "One or two sentences grounded in what they wrote" },
    share: { type: "integer", description: "Approximate percentage of reports that mention this theme (0-100)" },
  },
  required: ["title", "summary", "share"],
  additionalProperties: false,
};
const SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string", description: "Two or three sentences: the overall picture across all reports" },
    couldDoBetter: { type: "array", items: theme, description: "Themes from 'What I could have done better?'" },
    reflections: { type: "array", items: theme, description: "Themes from 'Reflections & improvements'" },
    focusNext: { type: "array", items: { type: "string" }, description: "3-5 specific, practical actions for the coming week" },
    wins: { type: "array", items: { type: "string" }, description: "2-4 things going well, from their own words" },
    activity: { type: "string", description: "One or two sentences on the cold calls / sales calls numbers and trend" },
  },
  required: ["overview", "couldDoBetter", "reflections", "focusNext", "wins", "activity"],
  additionalProperties: false,
};

const SYSTEM = `You are a supportive but direct performance coach for the owner of a small lead-generation agency who also works in sales. You read their end-of-day (EOD) reports and summarise patterns, like a response summary, then say what to improve. Ground every point in what they actually wrote; don't invent events or numbers. Be specific and practical, warm but not fluffy. Recent reports matter more than old ones when advising what to do next. Keep personal topics they mention brief and respectful.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { error: "Sign in to the Cockpit first." });
  if (!process.env.ANTHROPIC_API_KEY) return send(res, 503, { error: "AI summaries aren’t set up yet: add ANTHROPIC_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy." });
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: "Bad request." }); }
  const entries = (Array.isArray(body.entries) ? body.entries : []).slice(0, 400);
  if (entries.length < 2) return send(res, 400, { error: "Submit a few EOD reports first, then come back for a summary." });
  const lines = entries.map((e) =>
    [`Date: ${e.date}`, e.coldCalls ? `Cold calls: ${e.coldCalls}` : "", e.salesCalls ? `Sales calls: ${e.salesCalls}` : "",
     e.couldDoBetter ? `Could have done better: ${e.couldDoBetter}` : "", e.reflections ? `Reflections: ${e.reflections}` : "",
     e.tomorrowPriority ? `Tomorrow's priority: ${e.tomorrowPriority}` : ""].filter(Boolean).join("\n").slice(0, 3000)
  ).join("\n\n---\n\n");

  try {
    const client = new Anthropic();
    const msg = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: jsonSchemaOutputFormat(SCHEMA) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Here are ${entries.length} EOD reports, newest first:\n\n${lines}\n\nSummarise them following the schema. Themes: 2-4 per question, most common first.` }],
    });
    if (msg.stop_reason === "refusal") return send(res, 422, { error: "The summary couldn’t be generated for these reports." });
    if (!msg.parsed_output) return send(res, 502, { error: "The summary came back incomplete. Try again." });
    return send(res, 200, { insights: msg.parsed_output, count: entries.length, generatedAt: new Date().toISOString() });
  } catch (e) {
    const status = e && e.status;
    return send(res, 502, { error: status === 401 ? "The Anthropic API key in Vercel was rejected." : status === 429 ? "Too many requests right now. Try again in a minute." : "The summary couldn’t be generated right now. Try again." });
  }
};
