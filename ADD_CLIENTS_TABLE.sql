-- Run this once in the Supabase SQL editor for this project.
-- Creates the self-service client registry and seeds it with the 7 clients
-- that were previously hardcoded in app.py / app.js / client.html.

create table if not exists public.clients (
  slug                  text primary key,
  display_name          text not null,
  budget_tracker_url    text,
  archive_workspace_id  text,
  created_at            timestamptz not null default now()
);

insert into public.clients (slug, display_name, budget_tracker_url, archive_workspace_id) values
  ('madegood',       'MadeGood',                         'https://emmett-create.github.io/madegood-budget-tracker/',       '0cec8ea5-c3b3-4bb1-8083-eaab65719f8e'),
  ('magna',          'Magna',                            '',                                                                 '1a9f4270-c1c5-4dde-bcfa-3040589e9184'),
  ('evolvetogether', 'EvolveTogether',                    'https://emmett-create.github.io/evolvetogether-budget-tracker/', 'c8493a78-3eb0-4bad-9567-70dc2dc76e98'),
  ('stardust',       'Stardust',                          'https://emmett-create.github.io/stardust-budget-tracker/',       'd7413c10-4ac9-4a69-b7a6-0e0babaad8a1'),
  ('sys',            'SYS',                               'https://emmett-create.github.io/sys-budget-tracker/',            'c522e827-edc6-4314-8737-919b19829e0b'),
  ('tacbrand',       'The Absorption Company (Brand)',   '',                                                                 '77b77ba7-db31-44d2-819d-cc710cb89289'),
  ('tacgrowth',      'The Absorption Company (Growth)',  '',                                                                 '77b77ba7-db31-44d2-819d-cc710cb89289')
on conflict (slug) do nothing;

alter table public.clients enable row level security;
create policy "Allow all" on public.clients for all to anon, authenticated using (true) with check (true);
