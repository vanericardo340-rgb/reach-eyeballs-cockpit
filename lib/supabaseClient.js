// Not wired into index.html yet — this is the connection point for step 2.
// Once you've created the Supabase project and shared the URL + anon key,
// this file gets imported from index.html and the state.load()/save()
// functions get swapped from localStorage to calls against these tables.
//
// The anon key is safe to ship in client-side code by design — it can only
// do what the Row Level Security policies in supabase/schema.sql allow
// (nothing, until you're logged in via Supabase Auth).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "REPLACE_ME";
const SUPABASE_ANON_KEY = "REPLACE_ME";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
