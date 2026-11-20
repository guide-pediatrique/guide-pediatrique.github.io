-- =====================================================================
--  GUIDE DE PÉDIATRIE — version 4 : présentations des résidents
--  À exécuter une fois dans Supabase > SQL Editor > New query > Run
-- =====================================================================

-- 1. Table des présentations (chacun ne voit que les siennes)
create table if not exists public.presentations (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now());
alter table public.presentations enable row level security;
drop policy if exists "presentations_proprio" on public.presentations;
create policy "presentations_proprio" on public.presentations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Espace de stockage privé pour les fichiers importés (PDF, images)
insert into storage.buckets (id, name, public, file_size_limit)
values ('cours', 'cours', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "cours_lecture_proprio" on storage.objects;
create policy "cours_lecture_proprio" on storage.objects for select to authenticated
  using (bucket_id = 'cours' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "cours_ajout_proprio" on storage.objects;
create policy "cours_ajout_proprio" on storage.objects for insert to authenticated
  with check (bucket_id = 'cours' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "cours_modif_proprio" on storage.objects;
create policy "cours_modif_proprio" on storage.objects for update to authenticated
  using (bucket_id = 'cours' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "cours_suppr_proprio" on storage.objects;
create policy "cours_suppr_proprio" on storage.objects for delete to authenticated
  using (bucket_id = 'cours' and (storage.foldername(name))[1] = auth.uid()::text);

-- Vérification
select id, public from storage.buckets where id = 'cours';
