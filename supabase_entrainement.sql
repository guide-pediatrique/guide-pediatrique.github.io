-- =====================================================================
--  GUIDE DE PÉDIATRIE — synchronisation des résultats d'entraînement
--  À exécuter une fois dans Supabase > SQL Editor > New query > Run
-- =====================================================================

create table if not exists public.entrainement (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table public.entrainement enable row level security;

drop policy if exists "entrainement_proprio" on public.entrainement;
create policy "entrainement_proprio" on public.entrainement
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Vérification : la table doit apparaître
select table_name from information_schema.tables where table_name = 'entrainement';
