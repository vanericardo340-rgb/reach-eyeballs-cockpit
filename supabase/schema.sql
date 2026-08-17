-- Reach Eyeballs Cockpit — Supabase schema
-- Mirrors the shape of the current localStorage `state` object in index.html.
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).

create extension if not exists "pgcrypto";

-- ============================= CLIENTS =============================
create table clients (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  contact text,
  status text not null default 'active' check (status in ('active','paused','churned')),
  model text check (model in ('Pay per appointment','Retainer','Hybrid','Other')),
  run_rate numeric,
  start_date date,
  ad_account_id text,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================= LINKEDIN ACQUISITION (b2bLog) =============================
create table b2b_log (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  opener_ms integer default 0,
  proposal_ms integer default 0,
  fups_today integer default 0,
  doc_accepts integer default 0,
  connections_sent integer default 0,
  calls_proposed integer default 0,
  calendar_links_sent integer default 0,
  calls_booked integer default 0,
  sales integer default 0,
  cash_collected numeric default 0,
  notes text,
  from_sheet boolean default false,
  created_at timestamptz not null default now()
);

-- ============================= CLIENT ADS (adsLog) — daily per-client snapshot =============================
create table ads_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  date date not null,
  bookings integer default 0,
  cancellations integer default 0,
  reschedules integer default 0,
  no_shows integer default 0,
  live_calls integer default 0,
  offers_made integer default 0,
  closed_deals integer default 0,
  cash_collected numeric default 0,
  follow_ups integer default 0,
  not_closed_yet integer default 0,
  notes text,
  created_at timestamptz not null default now(),
  unique (client_id, date)
);

-- ============================= CLIENT ADS (leadsLog) — individual lead records =============================
create table leads_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  date date not null,
  lead_name text not null,
  outcome text,
  offer_made boolean default false,
  cash numeric default 0,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================= ADS ACQUISITION (adsAcqLeads) =============================
create table ads_acq_leads (
  id uuid primary key default gen_random_uuid(),
  closer_name text,
  date date not null,
  lead_name text not null,
  outcome text,
  second_call_outcome text,
  offer_closed_pitched boolean default false,
  offer_made boolean default false,
  cash numeric default 0,
  recording_link text,
  created_at timestamptz not null default now()
);

-- ============================= ADS ACQUISITION (adsAcqMonthly) — one row per month =============================
create table ads_acq_monthly (
  month_key text primary key, -- "YYYY-MM"
  ad_spend numeric default 0,
  lp_views integer default 0,
  paid_trials integer default 0,
  full_package integer default 0,
  revenue numeric default 0
);

-- ============================= FITNESS (fitnessLog) =============================
create table fitness_log (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  weight numeric,
  calories integer,
  protein integer,
  foods text,
  from_sheet boolean default false,
  created_at timestamptz not null default now()
);

-- ============================= DAILY WORKFLOW =============================
create table workflow_checks (
  date date not null,
  check_id text not null, -- e.g. "li-m-1", "eod-clickup"
  checked boolean default true,
  primary key (date, check_id)
);

create table workflow_notes (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  section text not null check (section in ('morning','afternoon')),
  type text not null check (type in ('hot','task')),
  text text not null,
  done boolean default false,
  sort_order integer default 0,
  created_at timestamptz not null default now()
);

create table workflow_reports (
  date date primary key,
  cold_calls integer default 0,
  old_leads integer default 0,
  meetings integer default 0,
  revenue numeric default 0,
  notes text
);

create table workflow_lead_calls (
  date date not null,
  section text not null check (section in ('morning','afternoon')),
  client_id uuid references clients(id) on delete cascade,
  done boolean default true,
  primary key (date, section, client_id)
);

-- ============================= SETTINGS (single row) =============================
create table settings (
  id boolean primary key default true check (id), -- forces exactly one row
  weight_unit text not null default 'kg' check (weight_unit in ('kg','lb')),
  target_show_rate numeric default 70,
  target_cancellation_rate numeric default 15,
  target_close_rate numeric default 30,
  target_offer_close_rate numeric default 45
);
insert into settings (id) values (true);

-- ============================= ROW LEVEL SECURITY =============================
-- Single-user internal tool: any authenticated user (i.e. you, once logged in
-- via Supabase Auth) can read/write everything. No public/anon access at all.
alter table clients enable row level security;
alter table b2b_log enable row level security;
alter table ads_log enable row level security;
alter table leads_log enable row level security;
alter table ads_acq_leads enable row level security;
alter table ads_acq_monthly enable row level security;
alter table fitness_log enable row level security;
alter table workflow_checks enable row level security;
alter table workflow_notes enable row level security;
alter table workflow_reports enable row level security;
alter table workflow_lead_calls enable row level security;
alter table settings enable row level security;

create policy "authenticated full access" on clients for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on b2b_log for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on ads_log for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on leads_log for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on ads_acq_leads for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on ads_acq_monthly for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on fitness_log for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on workflow_checks for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on workflow_notes for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on workflow_reports for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on workflow_lead_calls for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on settings for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
