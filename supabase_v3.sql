-- =====================================================================
--  GUIDE DE PÉDIATRIE — version 3 : examens, classement, administration
--  À exécuter une fois dans Supabase > SQL Editor > New query > Run
--  (peut être relancé sans risque)
-- =====================================================================

-- 0. Table des résultats d'entraînement (si pas encore créée)
create table if not exists public.entrainement (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now());
alter table public.entrainement enable row level security;
drop policy if exists "entrainement_proprio" on public.entrainement;
create policy "entrainement_proprio" on public.entrainement
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 1. Fonction : l'utilisateur connecté est-il administrateur ?
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 2. Examens chronométrés (classement visible par tous les inscrits)
create table if not exists public.examens (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now());
alter table public.examens enable row level security;

drop policy if exists "examens_lecture_inscrits" on public.examens;
create policy "examens_lecture_inscrits" on public.examens
  for select using (auth.role() = 'authenticated');
drop policy if exists "examens_ajout_proprio" on public.examens;
create policy "examens_ajout_proprio" on public.examens
  for insert with check (auth.uid() = user_id);
drop policy if exists "examens_modif_proprio" on public.examens;
create policy "examens_modif_proprio" on public.examens
  for update using (auth.uid() = user_id);
drop policy if exists "examens_suppr_proprio" on public.examens;
create policy "examens_suppr_proprio" on public.examens
  for delete using (auth.uid() = user_id or public.is_admin());

-- 3. L'administrateur peut voir la liste des inscrits et leurs résultats
drop policy if exists "profil_lecture_admin" on public.profiles;
create policy "profil_lecture_admin" on public.profiles
  for select using (public.is_admin());
drop policy if exists "entrainement_lecture_admin" on public.entrainement;
create policy "entrainement_lecture_admin" on public.entrainement
  for select using (public.is_admin());

-- Vérification
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('entrainement','examens');
