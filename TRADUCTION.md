# Guide de Pédiatrie — traduction anglais → français

Le bouton **🇫🇷 Traduire** apparaît dans la Veille scientifique (titres, résumés, articles « À lire »), dans l'éditeur de publications et dans l'éditeur de diapositives. L'option **🇫🇷 Titres en français** de la Veille traduit automatiquement tous les titres affichés.

## Les moteurs, du plus exact au secours

| Ordre | Moteur | Qualité | Disponible |
|---|---|---|---|
| 1 | **DeepL** via votre fonction Supabase `traduire` | La meilleure pour les textes médicaux | Après la configuration ci-dessous (≈ 10 min) |
| 2 | Traducteur intégré de Chrome | Bonne, sur l'appareil, rien n'est envoyé | Chrome sur ordinateur seulement, si le modèle est déjà installé |
| 3 | MyMemory (secours) | Variable | Immédiatement, 50 000 caractères/jour, **contenus publics uniquement** |

Sans configuration, la traduction fonctionne déjà avec le moteur de secours. Pour une traduction de qualité professionnelle, activez DeepL (gratuit jusqu'à 500 000 caractères par mois, soit environ 200 résumés d'articles).

## Garanties d'exactitude

- Les intitulés des résumés structurés (BACKGROUND, METHODS, RESULTS, CONCLUSIONS…) sont traduits par une table fixe, toujours identique.
- Chaque traduction est **comparée chiffre par chiffre** à l'original : si un nombre (dose, pourcentage, effectif, p) manque ou diffère, un avertissement ⚠️ s'affiche.
- L'original reste toujours accessible (bouton « ↺ Original »).
- Une traduction automatique n'est jamais garantie à 100 % : pour une décision clinique, l'original fait foi.

## Confidentialité

- Les contenus publics (titres et résumés PubMed) peuvent être envoyés au moteur de secours et sont gardés en cache sur l'appareil.
- Les contenus personnels (brouillons de publication, diapositives) ne passent que par votre fonction DeepL ou par Chrome ; sinon l'application demande votre accord à chaque session avant d'utiliser le moteur public, et ne les met jamais en cache.
- La clé DeepL reste sur le serveur Supabase : elle n'est jamais dans l'application.
- La fonction refuse les personnes non connectées, limite chaque demande à 30 000 caractères et 60 demandes par 10 minutes et par utilisateur.

## Activer DeepL (une seule fois)

### 1. Créer une clé DeepL gratuite
1. Allez sur **deepl.com/pro-api** → choisissez **DeepL API Free** → créez le compte.
2. Menu du compte → **API Keys** → copiez la clé (elle se termine par `:fx`).

### 2. Créer la fonction dans Supabase
1. Projet Supabase → menu de gauche **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nom de la fonction : `traduire` (exactement).
3. Effacez le code d'exemple et collez tout le contenu du fichier `supabase/functions/traduire/index.ts` de ce dépôt.
4. **Deploy function**.

### 3. Enregistrer la clé comme secret
1. **Edge Functions** → **Secrets** (ou Project Settings → Edge Functions).
2. Ajoutez :
   - `DEEPL_API_KEY` = votre clé DeepL
   - `ALLOWED_ORIGINS` = `https://guide-pediatrique.github.io`
3. Enregistrez.

### 4. Vérifier
Ouvrez l'application → Veille scientifique → **🇫🇷 Traduire** sur un article : la mention sous la traduction doit indiquer **« DeepL »**.

Si elle indique toujours « MyMemory (secours) » : vérifiez le nom exact de la fonction (`traduire`) et le secret `DEEPL_API_KEY`. Si les journaux de la fonction montrent « Invalid JWT », désactivez l'option **Enforce JWT verification** de la fonction : elle vérifie elle-même la connexion de l'utilisateur.

### Autres serveurs
- **Serveur REST fourni** (`serveur/server.mjs`) : lancez-le avec la variable `DEEPL_API_KEY=…` ; la route `/traduire` est déjà prête.
- **Google Cloud Translation** au lieu de DeepL : dans Supabase, définissez le secret `GOOGLE_TRANSLATE_KEY` à la place de `DEEPL_API_KEY`.
