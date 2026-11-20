-- =====================================================================
--  GUIDE DE PÉDIATRIE — version 6 : espace CAMES (agrégation)
--  À exécuter une fois dans Supabase > SQL Editor > New query > Run
-- =====================================================================
create table if not exists public.cames (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now());
alter table public.cames enable row level security;
drop policy if exists "cames_proprio" on public.cames;
create policy "cames_proprio" on public.cames for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists cames_user_idx on public.cames (user_id, updated_at desc);

-- Vérification : doit afficher une ligne avec rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'cames';
