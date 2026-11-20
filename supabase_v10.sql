-- =====================================================================
--  GUIDE DE PÉDIATRIE — version 10 : contenu pédagogique protégé
--  Cours, fiches, QCM, cas cliniques, radiologie, examen clinique, normes :
--  lisibles UNIQUEMENT par les utilisateurs connectés ; modifiables
--  uniquement par l'administrateur (import depuis Administration).
--  À exécuter une fois dans Supabase > SQL Editor > New query > Run
-- =====================================================================
create table if not exists public.contenus (
  id    text primary key check (id ~ '^(meta|[A-Z_]+#[0-9]+)$'),
  data  jsonb not null,
  maj   timestamptz default now(),
  constraint contenus_taille check (octet_length(data::text) < 900000));
alter table public.contenus enable row level security;

drop policy if exists "contenus_lecture_connectes" on public.contenus;
create policy "contenus_lecture_connectes" on public.contenus
  for select to authenticated using (true);

drop policy if exists "contenus_ecriture_admin" on public.contenus;
create policy "contenus_ecriture_admin" on public.contenus
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.contenus from anon;
grant select, insert, update, delete on public.contenus to authenticated;

-- Vérification : une ligne avec rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'contenus';
