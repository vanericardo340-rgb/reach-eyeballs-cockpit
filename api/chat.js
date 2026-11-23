// Cockpit assistant: streams Claude's reply as plain text.
// POST { messages: [{role, content}], context } with the user's Supabase sign-in.
// Needs ANTHROPIC_API_KEY set in the Vercel project's environment variables.
const { requireUser, send, readJson } = require("./_auth");
const sdk = require("@anthropic-ai/sdk");
const Anthropic = sdk.default || sdk;

const MODEL = "claude-opus-5-5";

const SYSTEM = `You are the assistant built into the Reach Eyeballs Cockpit, a personal dashboard for the owner of a lead-generation marketing agency. It holds their daily plan (Morning / Afternoon / Evening routines, top priorities, quick tasks), today's meetings, lead follow-ups, an end-of-day checklist and report, client accounts, paid-ads acquisition numbers, and fitness tracking.

Help them run their day: what to focus on next, how to word a follow-up message, how to prepare for a call, summaries of where things stand, and quick answers. Be concise and practical; short paragraphs or short lists. Use the dashboard snapshot provided with each request as the source of truth for their data, say so when something isn't in it, and never invent figures, leads or meetings.

You can read the snapshot but cannot change anything in the dashboard. When they ask you to add, tick or edit something, tell them where to do it in one line.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { error: "Sign in to the Cockpit first." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return send(res, 503, { error: "The assistant isn’t set up yet: add ANTHROPIC_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy." });
  }
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: "Bad request." });
  }
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-30)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!history.length || history[history.length - 1].role !== "user") return send(res, 400, { error: "Send a message first." });
  const context = typeof body.context === "string" ? body.context.slice(0, 40000) : "";

  const client = new Anthropic();
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: `Dashboard snapshot (read-only):\n${context || "(no snapshot available)"}` },
      ],
      messages: history,
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") res.write(event.delta.text);
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") res.write("\n\n(I can’t help with that one.)");
    else if (final.stop_reason === "max_tokens") res.write("\n\n(Reply cut short. Ask me to continue.)");
    res.end();
  } catch (e) {
    const status = e && e.status;
    const msg =
      status === 401 ? "The Anthropic API key in Vercel was rejected. Check ANTHROPIC_API_KEY." :
      status === 429 ? "Too many requests right now. Try again in a moment." :
      status >= 500 ? "Claude is having trouble right now. Try again in a moment." :
      "Something went wrong talking to Claude.";
    if (!res.headersSent) return send(res, 502, { error: msg });
    res.write(`\n\n(${msg})`);
    res.end();
  }
};
