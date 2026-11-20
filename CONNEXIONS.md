# Guide de Pédiatrie — connecter un autre serveur ou une autre base de données

L'application peut enregistrer comptes, observations, patients, entraînement et présentations sur **quatre types de serveurs**. Il n'y a aucun réglage dans l'application : le serveur se choisit uniquement dans le fichier **`config.js`** à la racine du dépôt (sur GitHub : ouvrir `config.js` → crayon ✏️ → modifier → *Commit changes*). Des exemples prêts à l'emploi y sont déjà écrits ; il suffit d'enlever les `//` devant le bloc voulu.

| Option | Base de données | Pour qui |
|---|---|---|
| **Supabase** (par défaut) | PostgreSQL hébergé | Configuration actuelle, rien à faire |
| **PocketBase** | SQLite, un seul exécutable | Serveur personnel, VPS, serveur de l'hôpital ou de la faculté |
| **Mon serveur (API REST)** | MySQL, PostgreSQL, SQL Server, MongoDB, SQLite… | Équipe informatique qui a déjà un serveur |
| **Local** | Navigateur de l'appareil | Test, usage hors ligne, une seule personne |

> **Sécurité.** Ne saisissez jamais une clé secrète dans l'application (Supabase `service_role` / `sb_secret_…`, mot de passe de la base, clé d'administration). L'application les refuse. La protection des données repose sur les règles du serveur : chaque utilisateur ne voit que ses propres données ; seuls les résultats d'examen (classement) sont visibles par tous les connectés.

> **Changer de serveur sans perdre ses données.** Avant le changement : Mon profil → *Exporter mes données*. Après le changement : créer son compte sur le nouveau serveur → *Importer une sauvegarde*.

---

## 1. PocketBase (recommandé pour un serveur personnel)

1. Téléchargez PocketBase (v0.23 ou plus récent) sur <https://pocketbase.io/docs/> pour votre système.
2. Copiez le dossier `serveur/pocketbase/pb_migrations` de ce dépôt **à côté** de l'exécutable `pocketbase`.
3. Lancez `./pocketbase serve --http=0.0.0.0:8090` : les tables et les règles de sécurité sont créées automatiquement.
4. Créez votre compte d'administration PocketBase avec le lien affiché au démarrage.
5. Mettez le serveur derrière HTTPS (Caddy, Nginx, Cloudflare Tunnel…). L'application exige `https://` sauf en réseau local.
6. Dans PocketBase, *Settings → Application → URL de l'application* : indiquez l'adresse du site ; *Settings → Mail settings* pour la réinitialisation du mot de passe.
7. Dans `config.js` : `window.PG_SERVEUR = { type: "pocketbase", url: "https://votre-serveur" };`
8. Pour donner les droits administrateur à un compte : interface PocketBase → collection `users` → cocher `is_admin`.

Connexion possible par e-mail **ou** téléphone (champ `tel` déclaré comme identifiant).

## 2. Mon serveur (API REST) — n'importe quelle base de données

### Serveur prêt à l'emploi (Node.js 22.13+, aucune dépendance)

```bash
cd serveur
SECRET="une-longue-chaine-aleatoire" ORIGINS="https://guide-pediatrique.github.io" ADMINS="vous@exemple.com" PORT=8787 node server.mjs
```

Puis dans `config.js` : `window.PG_SERVEUR = { type: "rest", url: "https://adresse-du-serveur" };`. Les données sont enregistrées dans `guide.db` (SQLite). Pour MySQL, PostgreSQL, SQL Server ou MongoDB, gardez les mêmes routes et remplacez la section « STOCKAGE » de `server.mjs` par les requêtes de votre base (ou réécrivez le serveur dans le langage de votre choix : PHP, Python, Java…).

### Contrat d'API à respecter

Format JSON. Après connexion, chaque requête porte l'en-tête `Authorization: Bearer <jeton>`. Une clé d'API publique facultative est envoyée dans `X-API-Key`. Le serveur doit autoriser CORS pour l'adresse du site.

| Méthode | Route | Corps / réponse |
|---|---|---|
| GET | `/health` | `{ "ok": true, "nom": "…" }` |
| POST | `/auth/register` | `{nom, prenom, email, tel, profession, password}` → `{token, user}` |
| POST | `/auth/login` | `{identifiant (e-mail ou téléphone), password}` → `{token, user}` (401 si refus) |
| GET | `/auth/me` | → `user` (401 si jeton expiré) |
| PATCH | `/auth/me` | `{nom, prenom, tel}` → `user` |
| POST | `/auth/password` | `{ancien, nouveau}` |
| POST | `/auth/reset` | `{email}` (facultatif) |
| POST | `/auth/logout` | — |
| GET | `/data/<collection>` | → tableau d'objets de l'utilisateur, du plus récent au plus ancien |
| PUT | `/data/<collection>/<id>` | objet complet → objet enregistré (création ou remplacement) |
| DELETE | `/data/<collection>/<id>` | — |
| GET | `/admin/users` | → liste des utilisateurs (administrateur uniquement, sinon 403) |

* `user` = `{id, nom, prenom, email, tel, profession ("etudiant" | "resident" | "pediatre"), isAdmin, createdAt}`.
* Collections : `observations`, `patients`, `consultations`, `entrainement`, `examens`, `presentations`, `publications`, `theses`, `carnet`, `evc`, `cames`, `notes`, `coffre`.
* `GET /data/examens` et `GET /data/evc` renvoient les données de **tous** les utilisateurs (classement, banque EVC) ; seuls les pédiatres et l'administrateur peuvent écrire dans `evc`. Toutes les autres collections sont strictement personnelles.
* Les erreurs renvoient `{ "message": "texte en français" }` : il est affiché tel quel dans l'application.
* Mot de passe : 8 caractères minimum, avec majuscule, minuscule et chiffre ; toujours stocké haché (scrypt, bcrypt ou argon2).

### Serveur local (réseau de l'hôpital, sans Internet)

Les navigateurs interdisent à un site `https://` (GitHub Pages) d'appeler un serveur `http://` local. Le serveur local sert donc **aussi l'application** :

1. Copier tout le dépôt sur l'ordinateur du service (Node.js 22.13+ installé).
2. Dans `config.js` de cette copie : `window.PG_SERVEUR = { type: "rest", url: "auto" };`
3. Depuis le dossier du dépôt : `SECRET="longue-chaine" ADMINS="vous@exemple.com" APP=. node serveur/server.mjs`
4. Sur les téléphones connectés au même Wi-Fi : ouvrir `http://ADRESSE-IP-DE-L-ORDINATEUR:8787`.

## 3. Supabase (configuration actuelle)

Un autre projet Supabase peut être utilisé : mettre son URL et sa clé **publishable** (ou anon) dans `config.js`, puis exécuter dans l'éditeur SQL, dans l'ordre : `supabase_schema.sql`, `supabase_admin.sql`, `supabase_entrainement.sql`, `supabase_v3.sql`, `supabase_v4.sql`, `supabase_v5.sql`, `supabase_v6.sql`, `supabase_v7.sql`, `supabase_v8.sql`.

## Remarques

* Les fichiers des présentations (PDF, images) sont stockés dans Supabase Storage avec Supabase ; avec les autres serveurs, ils restent sur l'appareil, et seul le contenu des diapositives est synchronisé.
* La Veille scientifique interroge directement PubMed (NCBI) et ne passe par aucun de ces serveurs.
