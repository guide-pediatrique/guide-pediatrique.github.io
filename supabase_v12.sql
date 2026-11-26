-- =====================================================================
--  GUIDE DE PÉDIATRIE — version 12 : suppression du compte par l'utilisateur
--  À exécuter une fois dans Supabase > SQL Editor > New query > Run
--  (peut être relancé sans risque)
--
--  Chaque utilisateur peut supprimer lui-même son compte depuis « Mon profil ».
--  Sont effacés définitivement : le compte de connexion, le profil et TOUTES ses
--  données (observations, patients, notes, présentations, publications, thèses,
--  carnet, CAMES, entraînement, examens, coffre de clés, accès et journal des avis).
--  Les avis déjà publiés restent anonymes (aucun lien avec la personne) et sont
--  purgés automatiquement après 15 jours. Ses fichiers de cours sont supprimés
--  par l'application juste avant (le stockage n'accepte pas d'effacement en SQL).
-- =====================================================================

create or replace function public.supprimer_mon_compte()
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t text;
begin
  if u is null then raise exception 'Connexion requise'; end if;
  select regexp_replace(coalesce(tel,''), '\s', '', 'g') into t from public.profiles where id = u;
  delete from public.login_essais where cle = 'tel:' || t;
  -- toutes les tables de données sont liées au compte « on delete cascade »
  delete from auth.users where id = u;
end $$;
revoke all on function public.supprimer_mon_compte() from public, anon;
grant execute on function public.supprimer_mon_compte() to authenticated;

-- Vérification : doit afficher 1 ligne
select 'fonction' as objet, proname as nom from pg_proc where proname = 'supprimer_mon_compte';
