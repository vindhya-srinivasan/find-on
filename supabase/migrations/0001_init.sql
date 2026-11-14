-- NOT APPLIED. Apply in Phase A3.

create table buildings (
  id text primary key,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  type text not null check (type in ('academic','library','residence','dining','outdoor','transit','desk'))
);

create table desks (
  id text primary key,
  name text not null,
  building_id text not null references buildings(id),
  hours_text text not null default ''
);

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (lower(email) like '%@usc.edu'),
  first_name text not null,
  last_initial text not null,
  role text not null default 'student' check (role in ('student','desk','admin')),
  desk_id text references desks(id) check (desk_id is null or role = 'desk'),
  flagged boolean not null default false,
  created_at timestamptz not null default now()
);

create table found_items (
  id uuid primary key default gen_random_uuid(),
  finder_id uuid not null references users(id),
  item_code text not null unique check (item_code ~ '^FO-[0-9]{4}$'),
  photo_paths text[] not null check (cardinality(photo_paths) between 1 and 3),
  blurred_thumb_path text not null,
  found_building_id text not null references buildings(id),
  landmark text,
  found_at timestamptz not null,
  category text not null,
  color text not null,
  brand text,
  public_title text not null,
  hidden_details jsonb not null default '[]' check (jsonb_typeof(hidden_details) = 'array'),
  verifiability text not null check (verifiability in ('high','medium','low')),
  is_valuable boolean not null default false,
  return_method text not null check (return_method in ('desk','finder')),
  held_at_desk_id text references desks(id),
  finder_availability text,
  status text not null check (status in ('en_route_to_desk','at_desk','with_finder','returned','unclaimed')),
  created_at timestamptz not null default now()
);

create table lost_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  raw_text text not null,
  category text not null,
  color text,
  brand text,
  marks text[] not null default '{}',
  building_ids text[] not null default '{}',
  not_sure boolean not null default false,
  landmarks text[] not null default '{}',
  time_start timestamptz not null,
  time_end timestamptz not null,
  owner_photo_path text,
  status text not null default 'open' check (status in ('open','resolved','closed')),
  created_at timestamptz not null default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  lost_report_id uuid not null references lost_reports(id) on delete cascade,
  found_item_id uuid not null references found_items(id) on delete cascade,
  score int not null check (score between 0 and 100),
  public_reason text not null,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (lost_report_id, found_item_id)
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  found_item_id uuid not null references found_items(id),
  lost_report_id uuid not null references lost_reports(id),
  claimant_id uuid not null references users(id),
  questions jsonb not null default '[]',
  answers jsonb,
  score int check (score between 0 and 100),
  reason text,
  flags text[] not null default '{}' check (flags <@ array['filed_after_listing','low_verifiability']::text[]),
  status text not null default 'awaiting_answers' check (status in ('awaiting_answers','likely_owner','needs_review','rejected','approved','returned')),
  pickup_code text check (pickup_code ~ '^[0-9]{6}$'),
  attempt_no int not null default 1 check (attempt_no between 1 and 2),
  created_at timestamptz not null default now(),
  unique (found_item_id, claimant_id, attempt_no)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims(id) on delete cascade,
  sender_id uuid not null references users(id),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table abuse_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id),
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  text text not null,
  link text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Indexes
create index found_items_status_category_created_idx on found_items (status, category, created_at desc);
create index found_items_finder_idx on found_items (finder_id);
create index lost_reports_owner_status_idx on lost_reports (owner_id, status);
create index claims_claimant_created_idx on claims (claimant_id, created_at desc);
create index claims_item_status_idx on claims (found_item_id, status);
create unique index claims_item_pickup_code_key on claims (found_item_id, pickup_code) where pickup_code is not null;
create index messages_claim_created_idx on messages (claim_id, created_at);
create index notifications_user_read_created_idx on notifications (user_id, read, created_at desc);
-- matches (lost_report_id) is already covered by the leading column of its unique constraint.

-- RLS: sensitive tables have no policies, so only the service role (API routes) can reach them.
alter table buildings enable row level security;
alter table desks enable row level security;
alter table users enable row level security;
alter table found_items enable row level security;
alter table lost_reports enable row level security;
alter table matches enable row level security;
alter table claims enable row level security;
alter table messages enable row level security;
alter table abuse_reports enable row level security;
alter table notifications enable row level security;

create policy buildings_read on buildings for select to anon, authenticated using (true);
create policy desks_read on desks for select to anon, authenticated using (true);
create policy users_read_own on users for select to authenticated using (id = (select auth.uid()));

-- Explicit grants because newer Supabase projects may not auto-expose public tables; confirm in A3.
revoke all on buildings, desks, users, found_items, lost_reports, matches, claims, messages, abuse_reports, notifications from anon, authenticated;
grant select on buildings, desks, users to anon, authenticated;
grant all on all tables in schema public to service_role;

-- Private photo bucket; no storage.objects policies, thumbnails are also served by signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
