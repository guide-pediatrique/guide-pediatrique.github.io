-- =====================================================================
--  GUIDE DE PÉDIATRIE — version 5 : publications, thèses, carnet de stage,
--  banque EVC pédiatrie
--  À exécuter une fois dans Supabase > SQL Editor > New query > Run
-- =====================================================================

-- 1. Tables personnelles (chacun ne voit et ne modifie que les siennes)
do $$
declare t text;
begin
  foreach t in array array['publications','theses','carnet'] loop
    execute format('create table if not exists public.%I (
      id text primary key,
      user_id uuid not null references auth.users(id) on delete cascade,
      data jsonb not null default ''{}'',
      updated_at timestamptz default now())', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_proprio" on public.%I', t, t);
    execute format('create policy "%s_proprio" on public.%I for all
      using (auth.uid() = user_id) with check (auth.uid() = user_id)', t, t);
    execute format('create index if not exists %I on public.%I (user_id, updated_at desc)', t || '_user_idx', t);
  end loop;
end $$;

-- 2. Banque de questions EVC : lue par tous les inscrits,
--    rédigée uniquement par les pédiatres (et l'administrateur), chacun ses questions
create table if not exists public.evc (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now(),
  constraint evc_taille check (octet_length(data::text) < 120000));
alter table public.evc enable row level security;

drop policy if exists "evc_lecture_inscrits" on public.evc;
create policy "evc_lecture_inscrits" on public.evc
  for select using (auth.role() = 'authenticated');
drop policy if exists "evc_ajout_pediatre" on public.evc;
create policy "evc_ajout_pediatre" on public.evc
  for insert with check (auth.uid() = user_id and (public.is_pediatre() or public.is_admin()));
drop policy if exists "evc_modif_auteur" on public.evc;
create policy "evc_modif_auteur" on public.evc
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "evc_suppr_auteur" on public.evc;
create policy "evc_suppr_auteur" on public.evc
  for delete using (auth.uid() = user_id or public.is_admin());

-- Vérification : doit afficher 4 lignes avec rowsecurity = true
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('publications','theses','carnet','evc');
