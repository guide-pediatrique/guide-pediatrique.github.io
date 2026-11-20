-- =====================================================================
--  GUIDE DE PÉDIATRIE — droits administrateur
--  À exécuter dans Supabase > SQL Editor, APRÈS avoir créé votre compte
--  dans l'application.
-- =====================================================================

-- 1. Colonne « administrateur » dans les profils
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- 2. Sécurité : un utilisateur peut modifier son nom, prénom et téléphone,
--    mais jamais se donner lui-même les droits administrateur
revoke update on public.profiles from authenticated, anon;
grant update (nom, prenom, tel) on public.profiles to authenticated;

-- 3. L'administrateur a accès à l'espace Pédiatre (patients, consultations)
create or replace function public.is_pediatre() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles
                where id = auth.uid() and (profession = 'pediatre' or is_admin));
$$;

-- 4. Vous donner les droits administrateur
--    (remplacez l'e-mail si vous vous êtes inscrit avec une autre adresse)
update public.profiles set is_admin = true where email = 'elhadjikhalif@gmail.com';

-- Vérification : doit afficher votre ligne avec is_admin = true
select nom, prenom, email, profession, is_admin from public.profiles where is_admin;
