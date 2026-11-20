-- =====================================================================
--  GUIDE DE PÉDIATRIE — schéma Supabase
--  À exécuter une fois dans : Supabase > SQL Editor > New query > Run
--  Ensuite, dans index.html, renseigner PG_CONFIG :
--    const PG_CONFIG = { supabaseUrl: "https://xxxx.supabase.co",
--                        supabaseAnonKey: "clé publishable / anon" };
-- =====================================================================

-- 1. Profils (créés automatiquement à l'inscription)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nom         text not null,
  prenom      text not null,
  email       text not null,
  tel         text unique,
  profession  text not null check (profession in ('etudiant','resident','pediatre')),
  created_at  timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nom, prenom, email, tel, profession)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'nom',''),
          coalesce(new.raw_user_meta_data->>'prenom',''),
          new.email,
          new.raw_user_meta_data->>'tel',
          coalesce(new.raw_user_meta_data->>'profession','etudiant'));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Connexion avec le numéro de téléphone comme identifiant
create or replace function public.email_for_phone(p_tel text)
returns text language sql security definer set search_path = public as $$
  select email from public.profiles
  where regexp_replace(tel, '\s', '', 'g') = regexp_replace(p_tel, '\s', '', 'g')
  limit 1;
$$;
grant execute on function public.email_for_phone(text) to anon, authenticated;

-- 2. Données de l'application (contenu en JSON)
create table if not exists public.observations (
  id text primary key, user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}', updated_at timestamptz default now());

create table if not exists public.patients (
  id text primary key, user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}', updated_at timestamptz default now());

create table if not exists public.consultations (
  id text primary key, user_id uuid not null references auth.users(id) on delete cascade,
  patient_id text references public.patients(id) on delete cascade,
  data jsonb not null default '{}', updated_at timestamptz default now());

create index if not exists consultations_patient_idx on public.consultations(patient_id);

-- 3. Sécurité : chaque utilisateur ne voit que ses propres données
alter table public.profiles      enable row level security;
alter table public.observations  enable row level security;
alter table public.patients      enable row level security;
alter table public.consultations enable row level security;

create policy "profil: lecture"      on public.profiles for select using (auth.uid() = id);
create policy "profil: mise à jour"  on public.profiles for update using (auth.uid() = id);

create policy "observations: propriétaire" on public.observations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Patients et consultations : réservés aux pédiatres
create or replace function public.is_pediatre() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and profession = 'pediatre');
$$;

create policy "patients: pédiatre propriétaire" on public.patients
  for all using (auth.uid() = user_id and public.is_pediatre())
  with check (auth.uid() = user_id and public.is_pediatre());

create policy "consultations: pédiatre propriétaire" on public.consultations
  for all using (auth.uid() = user_id and public.is_pediatre())
  with check (auth.uid() = user_id and public.is_pediatre());
