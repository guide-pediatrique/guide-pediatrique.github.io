-- =====================================================================
--  GUIDE DE PÉDIATRIE — version 9 : « Avis entre confrères »
--  À exécuter une fois dans Supabase > SQL Editor > New query > Run
--  (après supabase_v3.sql, qui crée public.is_admin()).
--
--  Principes :
--   • Un avis n'est visible que par les membres AUTORISÉS du même profil
--     (étudiant / résident / pédiatre) et par l'administrateur, pendant 24 h.
--   • Les tables d'avis ne contiennent AUCUN identifiant d'utilisateur :
--     ni la base, ni l'administrateur ne peuvent savoir qui a demandé ou
--     répondu. L'auteur prouve qu'il est l'auteur avec un « ticket » secret
--     (seule son empreinte SHA-256 est stockée).
--   • Après 24 h, seul le demandeur retrouve son avis (dans son journal
--     personnel chiffré). Les lignes du serveur sont purgées après 15 jours.
--   • Aucune lecture directe des tables : tout passe par les fonctions
--     ci-dessous (security definer).
-- =====================================================================

-- 1. Accès à l'option Avis (validé par l'administrateur)
create table if not exists public.avis_acces (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  groupe      text not null check (groupe in ('etudiant','resident','pediatre')),
  statut      text not null default 'attente' check (statut in ('attente','actif','refuse','suspendu')),
  carte       text,          -- photo de la carte (data URL), effacée après la décision
  message     text,
  demande_le  timestamptz default now(),
  decide_le   timestamptz,
  motif       text,
  constraint avis_carte_taille check (carte is null or octet_length(carte) < 1500000),
  constraint avis_msg_taille check (message is null or length(message) <= 500));
alter table public.avis_acces enable row level security;   -- aucune politique : accès par fonctions

-- 2. Les avis (sans auteur)
create table if not exists public.avis (
  id           text primary key check (id ~ '^av-[a-z0-9]{10,40}$'),
  groupe       text not null check (groupe in ('etudiant','resident','pediatre')),
  cree_le      timestamptz not null default now(),
  ticket_hash  text not null,
  contenu      jsonb not null,
  nb_rep       int not null default 0,
  derniere_rep timestamptz,
  constraint avis_taille check (octet_length(contenu::text) < 40000));
create index if not exists avis_groupe_idx on public.avis (groupe, cree_le desc);
alter table public.avis enable row level security;

create table if not exists public.avis_reponses (
  id            text primary key check (id ~ '^rp-[a-z0-9]{10,40}$'),
  avis_id       text not null references public.avis(id) on delete cascade,
  cree_le       timestamptz not null default now(),
  ticket_hash   text not null,
  par_demandeur boolean not null default false,
  contenu       jsonb not null,
  constraint avis_rep_taille check (octet_length(contenu::text) < 20000));
create index if not exists avis_rep_idx on public.avis_reponses (avis_id, cree_le);
alter table public.avis_reponses enable row level security;

-- Quotas anti-abus (nombre par jour uniquement, jamais le lien avec un avis)
create table if not exists public.avis_quota (
  user_id uuid not null, jour date not null, n_avis int not null default 0, n_rep int not null default 0,
  primary key (user_id, jour));
alter table public.avis_quota enable row level security;

-- 3. Journal personnel chiffré de bout en bout (comme « notes »)
create table if not exists public.avis_hist (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now(),
  constraint avis_hist_taille check (octet_length(data::text) < 400000));
alter table public.avis_hist enable row level security;
drop policy if exists "avis_hist_proprio" on public.avis_hist;
create policy "avis_hist_proprio" on public.avis_hist for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists avis_hist_user_idx on public.avis_hist (user_id, updated_at desc);

-- ===================== Fonctions =====================
create or replace function public.avis_h(t text) returns text
language sql immutable as $$ select encode(sha256(convert_to(t,'UTF8')),'hex') $$;

-- Groupe actif de l'appelant (null si non autorisé ou si son profil a changé)
create or replace function public.avis_groupe() returns text
language sql stable security definer set search_path = public as $$
  select a.groupe from public.avis_acces a join public.profiles p on p.id = a.user_id
   where a.user_id = auth.uid() and a.statut = 'actif' and a.groupe = p.profession $$;

create or replace function public.avis_purge() returns void
language sql security definer set search_path = public as $$
  delete from public.avis where cree_le < now() - interval '15 days';
  delete from public.avis_quota where jour < current_date - 2; $$;

-- Visibilité pour les membres : 24 h après la publication s'il y a eu une réponse,
-- sinon jusqu'à 7 jours (le temps d'obtenir une réponse).
create or replace function public.avis_visible(a public.avis) returns boolean
language sql stable as $$
  select (a.nb_rep = 0 and a.cree_le > now() - interval '7 days') or a.cree_le > now() - interval '24 hours' $$;

create or replace function public.avis_json(a public.avis) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id',a.id,'groupe',a.groupe,'cree_le',a.cree_le,'nb_rep',a.nb_rep,'contenu',a.contenu,
    'reponses',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'cree_le',r.cree_le,'p',left(r.ticket_hash,10),
       'par_demandeur',r.par_demandeur,'contenu',r.contenu) order by r.cree_le) from public.avis_reponses r where r.avis_id=a.id),'[]'::jsonb)) $$;

-- Mon accès
create or replace function public.avis_mon_acces() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('profession',p.profession,'statut',coalesce(a.statut,'aucun'),'groupe',a.groupe,
     'actif',public.avis_groupe() is not null,'motif',a.motif,'demande_le',a.demande_le,'decide_le',a.decide_le,'carte',a.carte is not null)
    from public.profiles p left join public.avis_acces a on a.user_id = p.id where p.id = auth.uid() $$;

-- Demander l'accès (avec ou sans photo de carte)
create or replace function public.avis_demander(p_carte text, p_message text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare prof text; st text;
begin
  select profession into prof from public.profiles where id = auth.uid();
  if prof is null then raise exception 'Profil introuvable'; end if;
  if p_carte is not null and (p_carte !~ '^data:image/(jpeg|png|webp);base64,' or octet_length(p_carte) > 1400000) then
    raise exception 'Image invalide ou trop lourde'; end if;
  select statut into st from public.avis_acces where user_id = auth.uid();
  if st = 'actif' and public.avis_groupe() is not null then return public.avis_mon_acces(); end if;
  if st = 'suspendu' then raise exception 'Accès suspendu par l''administrateur'; end if;
  insert into public.avis_acces(user_id,groupe,statut,carte,message,demande_le,decide_le,motif)
    values (auth.uid(),prof,'attente',p_carte,left(p_message,500),now(),null,null)
  on conflict (user_id) do update set groupe=excluded.groupe,statut='attente',carte=excluded.carte,
    message=excluded.message,demande_le=now(),decide_le=null,motif=null;
  return public.avis_mon_acces();
end $$;

-- ----- Administrateur : gère les accès, ne voit jamais qui écrit quoi -----
create or replace function public.avis_admin_liste() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id',p.id,'nom',p.nom,'prenom',p.prenom,'email',p.email,
     'profession',p.profession,'statut',coalesce(a.statut,'aucun'),'carte',a.carte is not null,'message',a.message,
     'demande_le',a.demande_le,'decide_le',a.decide_le,'motif',a.motif,'coherent',a.groupe is null or a.groupe=p.profession)
     order by (a.statut='attente') desc nulls last, a.demande_le desc nulls last, p.nom)
   from public.profiles p left join public.avis_acces a on a.user_id=p.id),'[]'::jsonb);
end $$;

create or replace function public.avis_admin_carte(p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return (select carte from public.avis_acces where user_id = p_user);
end $$;

create or replace function public.avis_admin_decider(p_user uuid, p_statut text, p_motif text) returns void
language plpgsql security definer set search_path = public as $$
declare prof text;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_statut not in ('actif','refuse','suspendu') then raise exception 'Statut invalide'; end if;
  select profession into prof from public.profiles where id = p_user;
  if prof is null then raise exception 'Utilisateur introuvable'; end if;
  insert into public.avis_acces(user_id,groupe,statut,carte,decide_le,motif)
    values (p_user,prof,p_statut,null,now(),left(p_motif,300))
  on conflict (user_id) do update set groupe=prof,statut=p_statut,carte=null,decide_le=now(),motif=left(p_motif,300);
end $$;

-- L'administrateur peut lire les avis des dernières 24 h (anonymes), tous profils
create or replace function public.avis_admin_avis() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return coalesce((select jsonb_agg(public.avis_json(a) order by a.cree_le desc)
    from public.avis a where a.cree_le > now() - interval '24 hours'),'[]'::jsonb);
end $$;

-- ----- Membres -----
create or replace function public.avis_liste() returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text := public.avis_groupe();
begin
  if g is null then raise exception 'Accès à l''option Avis non autorisé'; end if;
  perform public.avis_purge();
  return coalesce((select jsonb_agg(public.avis_json(a) order by a.cree_le desc)
    from (select * from public.avis a where a.groupe = g and public.avis_visible(a) order by a.cree_le desc limit 150) a),'[]'::jsonb);
end $$;

create or replace function public.avis_publier(p_id text, p_contenu jsonb, p_ticket text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text := public.avis_groupe(); n int; a public.avis;
begin
  if g is null then raise exception 'Accès à l''option Avis non autorisé'; end if;
  if length(coalesce(p_ticket,'')) < 32 then raise exception 'Ticket invalide'; end if;
  if jsonb_typeof(p_contenu) <> 'object' then raise exception 'Contenu invalide'; end if;
  if p_contenu::text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then raise exception 'Adresse e-mail interdite dans un avis (anonymat)'; end if;
  insert into public.avis_quota(user_id,jour,n_avis) values (auth.uid(),current_date,1)
    on conflict (user_id,jour) do update set n_avis = avis_quota.n_avis + 1 returning n_avis into n;
  if n > 20 then raise exception 'Limite de 20 demandes par jour atteinte'; end if;
  perform public.avis_purge();
  insert into public.avis(id,groupe,ticket_hash,contenu) values (p_id,g,public.avis_h(p_ticket),p_contenu) returning * into a;
  return public.avis_json(a);
end $$;

create or replace function public.avis_repondre(p_id text, p_avis text, p_contenu jsonb, p_ticket text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text := public.avis_groupe(); n int; a public.avis; th text := public.avis_h(p_ticket); dem boolean;
begin
  if length(coalesce(p_ticket,'')) < 32 then raise exception 'Ticket invalide'; end if;
  select * into a from public.avis where id = p_avis for update;
  if a.id is null then raise exception 'Avis introuvable ou expiré'; end if;
  dem := (a.ticket_hash = th);
  if not dem and (g is null or g <> a.groupe or not public.avis_visible(a)) then raise exception 'Avis introuvable ou expiré'; end if;
  if jsonb_typeof(p_contenu) <> 'object' then raise exception 'Contenu invalide'; end if;
  if p_contenu::text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then raise exception 'Adresse e-mail interdite (anonymat)'; end if;
  insert into public.avis_quota(user_id,jour,n_rep) values (auth.uid(),current_date,1)
    on conflict (user_id,jour) do update set n_rep = avis_quota.n_rep + 1 returning n_rep into n;
  if n > 200 then raise exception 'Limite de réponses du jour atteinte'; end if;
  insert into public.avis_reponses(id,avis_id,ticket_hash,par_demandeur,contenu) values (p_id,p_avis,th,dem,p_contenu);
  update public.avis set nb_rep = nb_rep + (case when dem then 0 else 1 end), derniere_rep = now() where id = p_avis returning * into a;
  return public.avis_json(a);
end $$;

-- Mes demandes (preuve : le ticket), même après 24 h et même si l'accès est suspendu
create or replace function public.avis_mes(p_items jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.avis_json(a)),'[]'::jsonb) from public.avis a
   join (select x->>'id' id, public.avis_h(x->>'ticket') th from jsonb_array_elements(
          case when jsonb_typeof(p_items)='array' then p_items else '[]'::jsonb end) x limit 300) t
     on t.id = a.id and t.th = a.ticket_hash
  where auth.uid() is not null $$;

create or replace function public.avis_supprimer(p_id text, p_ticket text) returns void
language sql security definer set search_path = public as $$
  delete from public.avis where id = p_id and ticket_hash = public.avis_h(p_ticket) and auth.uid() is not null $$;

-- Droits : uniquement les utilisateurs connectés
do $$ declare f text; begin
  foreach f in array array['avis_groupe()','avis_purge()','avis_mon_acces()','avis_demander(text,text)','avis_admin_liste()',
    'avis_admin_carte(uuid)','avis_admin_decider(uuid,text,text)','avis_admin_avis()','avis_liste()','avis_publier(text,jsonb,text)',
    'avis_repondre(text,text,jsonb,text)','avis_mes(jsonb)','avis_supprimer(text,text)','avis_json(public.avis)'] loop
    execute 'revoke all on function public.'||f||' from public, anon';
    execute 'grant execute on function public.'||f||' to authenticated';
  end loop; end $$;
revoke all on public.avis, public.avis_reponses, public.avis_quota, public.avis_acces from anon, authenticated;

-- Vérification : 5 lignes avec rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'avis%' order by 1;
