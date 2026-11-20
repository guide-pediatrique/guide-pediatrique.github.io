-- =====================================================================
--  GUIDE DE PÉDIATRIE — version 7 : « Mes notes » (étudiant, résident)
--  À exécuter une fois dans Supabase > SQL Editor > New query > Run
-- =====================================================================
create table if not exists public.notes (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now(),
  constraint notes_taille check (octet_length(data::text) < 200000));
alter table public.notes enable row level security;
drop policy if exists "notes_proprio" on public.notes;
create policy "notes_proprio" on public.notes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists notes_user_idx on public.notes (user_id, updated_at desc);

-- Vérification : doit afficher une ligne avec rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'notes';
