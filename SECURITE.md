# Guide de Pédiatrie — sécurité

| Protection | Détail |
|---|---|
| Code 100 % hébergé sur le site | Bibliothèques (Supabase, jsPDF, pdf.js, JSZip) et polices dans `vendor/` et `fonts/` : aucun script ni police chargé depuis un service tiers. |
| Politique de sécurité du contenu (CSP) | Seuls les scripts de l'application (empreintes SHA-256 calculées à chaque version) peuvent s'exécuter ; plugins, balise `<base>` et formulaires externes interdits. |
| Anti-intégration | L'application refuse de s'afficher dans le cadre (iframe) d'un autre site. |
| Comptes | Mot de passe ≥ 8 caractères (majuscule, minuscule, chiffre) + indicateur de robustesse qui refuse les mots de passe prévisibles (nom, téléphone, mots courants). En mode local : PBKDF2-SHA256, 210 000 itérations. |
| Tentatives de connexion | Après 5 erreurs : blocage 30 s, puis durée doublée à chaque nouvel échec. |
| Session | Fermée après 1 h d'inactivité ; « Déconnecter tous mes appareils » (Supabase). |
| Verrouillage de l'écran | Mot de passe redemandé après 5, 15 (par défaut) ou 30 min sans activité, ou à la demande (🔒). Résiste au rechargement de la page ; 5 erreurs = déconnexion. |
| Confidentialité | Écran flouté quand l'application passe en arrière-plan ; nettoyage des données en mémoire à la déconnexion. |
| Sauvegardes | Export chiffré AES-256-GCM (clé dérivée d'une phrase secrète, PBKDF2 210 000 itérations), format `.pgsafe`. |
| Cache hors ligne | Seuls les fichiers de l'application sont mis en cache ; les données des serveurs et de PubMed ne le sont jamais. |
| Données sur le serveur | Supabase : règles RLS (chaque compte ne voit que ses données). PocketBase / serveur REST : règles équivalentes (voir `CONNEXIONS.md`). |
| Clés | Seule la clé publique (publishable/anon) figure dans `config.js` ; les clés secrètes sont refusées. |
| Banque EVC partagée | Lecture par tous les inscrits ; écriture réservée aux pédiatres et à l'administrateur, chacun ne modifie que ses propres questions (RLS / règles PocketBase / serveur REST). |
| Modules chargés à la demande | Les rubriques Carrière & recherche sont dans `mods/`, servies par le site lui-même (aucune source externe, conforme à la CSP). |

## Simulation d'attaque (test d'intrusion) — résultats

Un test a été mené : un compte « attaquant » a tenté de récupérer et d'altérer les données d'un compte « victime » (patients, publications, dossier CAMES) sur un serveur réel.

**Attaques repoussées sans modification :**
- Lire la liste des patients d'un autre utilisateur → renvoie une liste vide.
- Accès direct à l'identifiant d'un dossier d'autrui → 404.
- Écraser ou supprimer le dossier d'un autre → l'attaquant n'agit que sur ses propres données ; celles de la victime restent intactes.
- Lire les publications ou le dossier CAMES d'un autre → vide.
- Se déclarer administrateur via la mise à jour du profil → ignoré.
- Accéder à la liste des inscrits sans être administrateur → 403.
- Écrire dans la banque EVC sans être pédiatre → 403.
- Forger un jeton de session (signature invalide) ou requête sans jeton → 401.
- Injecter du code (script, `onerror`, `onload`) dans la banque EVC partagée → stocké comme texte, **jamais exécuté** chez les autres (échappement systématique + politique de sécurité du contenu).

**Failles trouvées et corrigées :**
- *Déni de service par enregistrement géant* : un pédiatre pouvait déposer 2 Mo dans la banque partagée, téléchargés ensuite par tous. → Limite de taille par enregistrement (120 Ko pour les données partagées, 1 Mo pour les données privées) sur le serveur REST, PocketBase et Supabase ; refus des données mal formées (400/413).
- *Question partagée mal formée* pouvant casser l'affichage de tous → nettoyage côté client de chaque question partagée (structure vérifiée, champs tronqués, question inexploitable ignorée).
- *Classement* : chaque examen créait une nouvelle ligne (croissance illimitée, lue par tous) et stockait le nom complet. → Une seule ligne par personne (meilleur score conservé), nom réduit à l'initiale.

**Limite connue (non bloquante)** : le score affiché dans le classement d'entraînement reste déclaratif (un utilisateur averti peut gonfler son propre score via l'API). Sans conséquence sur les données des autres ; acceptable pour un classement d'entraînement.

## Traduction et notes (v13)

| Protection | Détail |
|---|---|
| Clé de traduction | La clé DeepL (ou Google) est un secret de la fonction Supabase `traduire` : jamais dans l'application ni dans le dépôt. |
| Fonction `traduire` | Refuse les personnes non connectées ; 30 000 caractères maximum par demande ; 60 demandes par 10 minutes et par utilisateur ; origines autorisées limitées au site. |
| Contenus personnels | Brouillons de publication et diapositives : jamais envoyés au service public de secours sans accord explicite, jamais gardés en cache. |
| Exactitude | Intitulés des résumés traduits par table fixe ; contrôle automatique des chiffres entre l'original et la traduction. |
| Délais maximum | Un moteur de traduction qui ne répond pas est abandonné après quelques secondes : l'interface ne se bloque jamais. |
| Notes | Table `notes` protégée par RLS (chacun ne voit que ses notes), 200 Ko maximum par note ; contenu toujours affiché comme texte. Tant que `supabase_v7.sql` n'est pas exécuté, les notes restent sur l'appareil puis sont transférées automatiquement. |
| Rappels | Notifications affichées par le système sans contenu sensible au-delà du titre et d'un court extrait ; le fichier d'agenda (.ics) n'est créé qu'à la demande de l'utilisateur. |

## Chiffrement de bout en bout (v14)

Les données personnelles de chaque utilisateur sont chiffrées **sur son appareil, avant l'envoi**. Le serveur, l'administrateur de l'application et le propriétaire de la base de données (tableau de bord Supabase compris) ne voient que du texte illisible.

| Élément | Détail |
|---|---|
| Données chiffrées | Observations, patients, consultations, entraînement, présentations (y compris les fichiers PDF et images), publications, thèses, carnet de stage, dossier CAMES, notes. |
| Algorithme | AES-256-GCM ; identifiant et collection liés au contenu (un enregistrement ne peut pas être déplacé ou substitué). |
| Clé | Une clé aléatoire par utilisateur, protégée par son mot de passe (PBKDF2-SHA256, 210 000 itérations) et par une clé de secours de 160 bits, stockées dans la table privée `coffre`. |
| Sur l'appareil | Clé conservée sous forme non exportable, effacée à la déconnexion (manuelle ou après 1 h d'inactivité). |
| Changement de mot de passe | La clé est re-protégée automatiquement. |
| Mot de passe oublié | Après réinitialisation par e-mail, la clé de secours restaure l'accès. **Sans mot de passe d'origine ni clé de secours, les données sont définitivement perdues** — personne, pas même l'administrateur, ne peut les récupérer. |
| Données anciennes | Les éléments enregistrés avant le chiffrement sont chiffrés automatiquement à la première lecture. |
| Ce qui reste visible | Pour gérer les comptes : nom, prénom, e-mail, téléphone, profession et date d'inscription (liste des inscrits). Par conception : les contributions volontairement partagées (banque EVC, classement d'examen avec prénom et initiale). |
| Accès administrateur retiré | `supabase_v8.sql` supprime la lecture des données d'entraînement des autres par l'administrateur. |

## Avis entre confrères (v17)

| Élément | Détail |
|---|---|
| Qui voit une demande | Les membres **autorisés du même profil** (étudiants entre eux, résidents entre eux, pédiatres entre eux) et l'administrateur, pendant 24 h. Les autres profils ne la voient jamais. |
| Durée | Une demande qui a reçu une réponse disparaît chez les autres **24 h après sa publication** ; sans réponse, elle reste visible 7 jours au plus. Le serveur l'efface après 15 jours. |
| Anonymat des intervenants | Les tables `avis` et `avis_reponses` n'ont **aucune colonne d'utilisateur**. L'auteur prouve qu'il l'est avec un ticket secret, dont seule l'empreinte SHA-256 est stockée. Ni l'administrateur ni la base ne peuvent relier une demande ou une réponse à une personne. Les réponses d'une même personne ne sont pas reliables d'un avis à l'autre. |
| Anonymat du patient | Avant l'envoi, l'application bloque les e-mails, les numéros de téléphone, les noms présents dans vos patients ou observations et votre propre nom ; elle signale les dates précises, adresses et numéros de dossier. Le serveur refuse aussi toute adresse e-mail. Une case de certification est obligatoire. |
| Journal | Chaque demandeur garde ses demandes et les réponses reçues dans un journal **chiffré de bout en bout** (`avis_hist`), consultable et exportable en PDF par lui seul, même après 24 h. |
| Accès | L'administrateur active l'option pour chaque utilisateur, avec ou sans photo de carte d'étudiant ou professionnelle. La photo n'est vue que par lui et est **effacée dès sa décision**. Il peut suspendre un accès. |
| Limites | Pendant 24 h, le contenu d'un avis est lisible par le serveur, par l'administrateur et par tous les membres autorisés du groupe : il ne doit donc contenir aucune donnée identifiante. L'hébergeur technique pourrait en théorie rapprocher les heures de connexion et de publication dans ses journaux. Les pièces jointes (photos, PDF) ne sont pas prises en charge. |
| Installation | Exécuter `supabase_v9.sql` une fois dans Supabase > SQL Editor. |

## Contenu protégé et propriété (v18)

| Élément | Détail |
|---|---|
| Contenu pédagogique | Cours, fiches pathologies, QCM, cas cliniques, radiologie, examen clinique et normes ne sont plus dans le code publié ni dans ce dépôt. Ils sont stockés dans la table `contenus` (`supabase_v10.sql`) : **lecture réservée aux utilisateurs connectés**, écriture réservée à l'administrateur. |
| Mise à jour automatique | Le contenu est publié dans `paquet/contenu.enc`, **chiffré (AES-256-GCM)** avec une clé de contenu de 256 bits connue du seul propriétaire : sans cette clé, le fichier est illisible. L'administrateur saisit la clé une fois (Administration → Contenu pédagogique protégé) ; elle est rangée dans son coffre chiffré de bout en bout. À chaque ouverture de l'application par l'administrateur, une version plus récente est déchiffrée et installée automatiquement. |
| Import manuel (secours) | Administration → « Import manuel » avec le fichier `contenu_guide_pediatrie.json` (à conserver en lieu sûr, ne jamais le publier). |
| Sur l'appareil | Copie locale après connexion (usage hors ligne), effacée à la déconnexion. |
| Conditions d'utilisation | Acceptation obligatoire à l'inscription, puis à chaque nouvelle version (enregistrée dans le compte). Lisibles et téléchargeables en PDF depuis l'écran de connexion et le profil. |
| Mentions | © sur l'écran de connexion, le menu, chaque page PDF, le code publié et le fichier `LICENSE` (tous droits réservés). |
| Limite | Le code de l'interface reste téléchargeable, comme pour toute application web. Les anciennes versions de ce dépôt contiennent encore le contenu dans l'historique : rendre le dépôt privé pour le fermer. |

## Connexion biométrique (v20)

| Élément | Détail |
|---|---|
| Principe | Clé d'accès WebAuthn (passkey) liée à l'appareil : Face ID, Touch ID, empreinte (Android) ou Windows Hello. Le visage ou l'empreinte ne quittent jamais l'appareil. |
| Protection | Appareils récents (extension PRF) : la clé qui chiffre l'identifiant est produite par la puce sécurisée, uniquement après reconnaissance. Appareils plus anciens : clé non exportable de l'appareil, libérée seulement après une vérification biométrique réussie. |
| Serveur | Rien n'est envoyé : la connexion se fait ensuite normalement (mot de passe + chiffrement de bout en bout). |
| Verrouillage | Déverrouillage instantané, même hors ligne. |
| Gestion | Activation proposée après une connexion par mot de passe, ou dans Profil → Sécurité ; désactivable à tout moment. Mise à jour automatique au changement de mot de passe ; désactivation propre si le mot de passe a changé sur un autre appareil. |

## Renforcements v21

| Élément | Détail |
|---|---|
| Mots de passe ayant fuité | À l'inscription et au changement de mot de passe, vérification auprès de Have I Been Pwned par k-anonymat : seuls les 5 premiers caractères de l'empreinte SHA-1 sont envoyés, jamais le mot de passe. Un mot de passe présent dans une fuite connue est refusé. Si le service est injoignable, la vérification est ignorée. |
| Écran masqué | Quand l'application passe en arrière-plan, un écran neutre remplace le contenu : l'aperçu du sélecteur d'applications ne montre pas les données. |
| Référent | `no-referrer` : aucun site externe (PubMed, revues) ne reçoit l'adresse de la page consultée. |
| Réseau | Pastille « Hors ligne » dans la barre du haut ; synchronisation automatique (avis, contenu, mises à jour) au retour de la connexion. |

## Audit d'intrusion du 21/11/2026 (supabase_v11.sql)

52 attaques simulées sur la base (mêmes scripts SQL et mêmes droits par défaut que Supabase) et attaques dans l'application (injection de code par un membre malveillant, vol de données, cadre piégé, exfiltration).

| Faille trouvée | Gravité | Correction |
|---|---|---|
| Connexion par téléphone : un visiteur sans compte obtenait l'e-mail d'un membre à partir de son numéro, et pouvait lister les numéros inscrits | Élevée | `email_for_phone(tel, mot_de_passe)` : l'e-mail n'est rendu qu'avec le bon mot de passe ; 10 essais par numéro et par 15 min ; durée de réponse identique que le numéro existe ou non ; ancienne fonction supprimée |
| Avis : relecture des réponses d'un avis expiré via une fonction interne (`avis_json`) en connaissant son identifiant | Moyenne | fonctions internes fermées (`avis_json`, `avis_groupe`, `avis_purge`, `avis_visible`) |
| Classement : un membre pouvait insérer du HTML affiché chez les autres (bloqué en exécution par la CSP) et inonder la table | Moyenne | données validées et neutralisées à l'affichage ; une ligne par personne, 2 Ko maximum |
| Application affichable dans le cadre invisible d'un site pirate (« clickjacking ») : la protection existante ne fonctionnait pas | Moyenne | page masquée dès qu'elle est dans un cadre |
| Règle de sécurité (CSP) autorisant les connexions vers n'importe quel site | Faible | connexions limitées à Supabase, au contrôle des mots de passe divulgués, à la traduction et à PubMed |

Ce qui a résisté : lecture, modification, suppression ou appropriation des données d'un autre membre (12 tables), lecture par l'administrateur des données personnelles et du coffre de clés, élévation en administrateur ou en pédiatre, écriture du contenu des cours, lecture anonyme de toutes les tables, identité des auteurs d'avis, fichiers des autres membres, injection de code dans les avis, la banque EVC, la liste des membres et le tableau de bord administrateur.
