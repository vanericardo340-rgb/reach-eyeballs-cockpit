# Reach Eyeballs Cockpit — hosted version

This is the same dashboard that's been running as a Claude Artifact, moved out
of the sandbox so it can be a real website with real automatic syncing. It's
still a single static `index.html` (no build step, no npm install) — just
loaded from a real server instead of the Artifact iframe.

## Where things stand

- `index.html` — the full app, copied straight from the working Artifact.
  Right now it still saves to the browser's `localStorage`, exactly like
  before. Nothing about how it works has changed yet.
- `supabase/schema.sql` — the database schema, designed to mirror the app's
  current data shape. Not applied anywhere yet.
- `lib/supabaseClient.js` — a stub for the database connection. Not wired
  into `index.html` yet.

## Setup (your side)

1. **Create a Supabase project** — [supabase.com](https://supabase.com), free
   tier. Note the **Project URL** and **anon public key** (Project Settings →
   API) — these are safe to share with me, they're not secret keys.
2. **Run the schema** — Supabase dashboard → SQL Editor → New query → paste
   the contents of `supabase/schema.sql` → Run.
3. **Turn on email login** — Authentication → Providers → make sure Email is
   enabled, then Authentication → Users → Add user, using your own email —
   this is how you'll log into the live site (nobody else will be able to,
   since the data policies only allow logged-in requests).
4. **Create a GitHub repo** (e.g. `reach-eyeballs-cockpit`, private) and give
   me the URL, or tell me to create one for you if you connect GitHub access.
5. **Create a Vercel account** at [vercel.com](https://vercel.com) (free tier,
   sign in with GitHub is easiest) and connect it to the new repo — Vercel
   auto-detects a static `index.html` with zero config.

Once you hand me the Supabase URL + anon key, I'll wire `lib/supabaseClient.js`
into `index.html`, swap `load()`/`save()` over to the database, add a login
screen, and push it — Vercel redeploys automatically on every push after
that.

## What this gets you vs. the Artifact

- A permanent URL you (and only you, once logged in) can open from any
  device — data is no longer stuck in one browser.
- A real database instead of localStorage, so nothing is lost if you clear
  your browser data.

## What this does *not* automatically get you

Claude still can't run on a schedule by itself. Automatic daily sync from the
Google Sheet (calories, LinkedIn outreach) needs a scheduled job — a Supabase
Edge Function or Vercel Cron route with its own Google service-account
credentials — which is a separate setup on top of this. Until that's built,
syncing stays the same "ask Claude to sync" flow as today, just writing to
the database instead of baking a snapshot into the file.
