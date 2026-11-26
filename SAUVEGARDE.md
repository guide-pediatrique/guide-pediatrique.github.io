# Sauvegarde automatique de la base

Chaque nuit (03 h 17, heure de Niamey), GitHub fait une copie complète de la base Supabase,
la **chiffre** avec votre mot de passe de sauvegarde, et la garde **30 jours** dans l'onglet
**Actions** du dépôt. Sans ce mot de passe, la copie est illisible, même pour GitHub.

## Mise en route (une seule fois, 5 minutes)

1. **Chaîne de connexion** — Supabase > votre projet > bouton **Connect** (en haut) >
   **Session pooler** > copiez l'URI `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`
   et remplacez `[YOUR-PASSWORD]` par le mot de passe de la base
   (Project Settings > Database > Reset database password si vous ne l'avez plus).
2. **Secrets GitHub** — dépôt `guide-pediatrique.github.io` > **Settings** > **Secrets and variables** >
   **Actions** > **New repository secret** :
   - `SUPABASE_DB_URL` : la chaîne de l'étape 1
   - `SAUVEGARDE_MOT_DE_PASSE` : une phrase secrète d'au moins 16 caractères. **Notez-la sur papier** :
     sans elle, aucune restauration n'est possible.
3. **Premier essai** — onglet **Actions** > **Sauvegarde de la base** > **Run workflow**.
   Après 1 à 2 minutes : coche verte, et le fichier `sauvegarde-AAAAMMJJ-HHMM` en bas de la page.

## Ce qui est sauvegardé

- toutes les tables de l'application (profils, contenus des cours, observations, notes… — les contenus
  personnels restent chiffrés de bout en bout, comme sur le serveur) ;
- les comptes de connexion (e-mails et mots de passe protégés par hachage).

Les fichiers PDF des présentations (stockage Supabase) ne sont pas dans cette sauvegarde.

## Restaurer

1. Téléchargez la sauvegarde (onglet Actions > l'exécution voulue > fichier en bas de page), décompressez le .zip.
2. Déchiffrez puis ouvrez l'archive :
   `gpg -d sauvegarde-AAAAMMJJ-HHMM.tgz.gpg > s.tgz && tar xzf s.tgz`
3. Sur un projet Supabase **vide** : exécutez d'abord `2_comptes.sql` puis `1_application.sql`
   avec `psql "CHAÎNE_DE_CONNEXION" -f fichier.sql`.

En cas de doute, demandez de l'aide avant de restaurer : une restauration sur la base en service écrase les données.
