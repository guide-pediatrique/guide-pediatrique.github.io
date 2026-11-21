-- =====================================================================
--  GUIDE DE PÉDIATRIE — version 11 : correctifs de sécurité (audit du 21/11/2026)
--  À exécuter une fois dans Supabase > SQL Editor > New query > Run
--  (peut être relancé sans risque)
--
--  1. Connexion par téléphone : n'importe quel visiteur pouvait obtenir l'adresse
--     e-mail d'un membre à partir de son numéro (et savoir qui est inscrit).
--     → L'e-mail n'est plus rendu qu'avec le BON mot de passe, avec une limite
--       de 10 essais par numéro et par quart d'heure.
--  2. Avis : une fonction interne (avis_json) permettait de relire les réponses
--     d'un avis expiré en connaissant son identifiant. → Fonctions internes fermées.
--  3. Classement : un membre pouvait inonder le classement (lignes illimitées,
--     taille illimitée). → Une seule ligne par personne, 2 Ko maximum.
-- =====================================================================

-- 1. Connexion par téléphone protégée -----------------------------------
create table if not exists public.login_essais (
  cle   text primary key,
  n     int not null default 1,
  debut timestamptz not null default now());
alter table public.login_essais enable row level security;          -- aucune politique : invisible
revoke all on public.login_essais from anon, authenticated;

drop function if exists public.email_for_phone(text);

create or replace function public.email_for_phone(p_tel text, p_pw text)
returns text language plpgsql security definer set search_path = public as $$
declare
  t text := regexp_replace(coalesce(p_tel,''), '\s', '', 'g');
  e text; h text; v_n int;
begin
  if length(t) < 6 or length(t) > 20 or p_pw is null or length(p_pw) > 200 then return null; end if;
  -- limite : 10 essais par numéro et par tranche de 15 minutes
  insert into public.login_essais(cle) values ('tel:' || t)
  on conflict (cle) do update set
    n     = case when login_essais.debut < now() - interval '15 minutes' then 1 else login_essais.n + 1 end,
    debut = case when login_essais.debut < now() - interval '15 minutes' then now() else login_essais.debut end
  returning login_essais.n into v_n;
  delete from public.login_essais where debut < now() - interval '1 day';
  if v_n > 10 then return null; end if;
  select p.email, u.encrypted_password into e, h
    from public.profiles p join auth.users u on u.id = p.id
   where regexp_replace(p.tel, '\s', '', 'g') = t limit 1;
  if h is null then
    -- même durée de calcul qu'avec un vrai compte : on ne révèle pas si le numéro existe
    perform extensions.crypt(p_pw, extensions.gen_salt('bf', 10));
    return null;
  end if;
  if extensions.crypt(p_pw, h) <> h then return null; end if;
  update public.login_essais set n = 0 where cle = 'tel:' || t;   -- connexion réussie : compteur remis à zéro
  return e;
end $$;
revoke all on function public.email_for_phone(text, text) from public;
grant execute on function public.email_for_phone(text, text) to anon, authenticated;

-- 2. Avis : fonctions internes inaccessibles depuis l'application ----------
revoke all on function public.avis_json(public.avis) from public, anon, authenticated;
revoke all on function public.avis_groupe() from public, anon, authenticated;
revoke all on function public.avis_purge() from public, anon, authenticated;
revoke all on function public.avis_visible(public.avis) from public, anon, authenticated;

-- 3. Classement : une ligne par personne, taille limitée ------------------
alter table public.examens drop constraint if exists examens_une_ligne;
alter table public.examens add constraint examens_une_ligne check (id = 'exam-' || user_id::text) not valid;
alter table public.examens drop constraint if exists examens_taille;
alter table public.examens add constraint examens_taille check (octet_length(data::text) < 2000) not valid;

-- Vérification : doit afficher 2 lignes (la fonction à 2 paramètres et la table des essais)
select 'fonction' as objet, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as nom
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public' and p.proname = 'email_for_phone'
union all
select 'table', tablename from pg_tables where schemaname = 'public' and tablename = 'login_essais';
