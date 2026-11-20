-- =====================================================================
--  GUIDE DE PÉDIATRIE — version 8 : confidentialité totale des données
--  1. Coffre de clés (chiffrement de bout en bout)
--  2. L'administrateur ne peut plus lire les données d'entraînement des autres
--  À exécuter une fois dans Supabase > SQL Editor > New query > Run
-- =====================================================================

-- 1. Coffre : contient la clé de chaque utilisateur, elle-même chiffrée par son mot de passe
create table if not exists public.coffre (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now(),
  constraint coffre_taille check (octet_length(data::text) < 20000));
alter table public.coffre enable row level security;
drop policy if exists "coffre_proprio" on public.coffre;
create policy "coffre_proprio" on public.coffre for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Retirer l'accès de l'administrateur aux données d'entraînement des autres
drop policy if exists "entrainement_lecture_admin" on public.entrainement;

-- Vérification : liste des règles d'accès donnant un droit à l'administrateur.
-- Il ne doit rester que : profil_lecture_admin (liste des inscrits),
-- examens_suppr_proprio et evc_suppr_auteur (modération des contenus partagés).
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and (qual ilike '%is_admin%' or with_check ilike '%is_admin%');
