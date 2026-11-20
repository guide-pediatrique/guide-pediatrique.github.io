/* ==================================================================
   GUIDE DE PÉDIATRIE — SERVEUR DE DONNÉES
   C'est le seul endroit où l'on choisit le serveur. Sur GitHub :
   ouvrir ce fichier → crayon ✏️ → modifier → « Commit changes ».
   Le changement s'applique au prochain chargement de l'application.

   type : "supabase" | "pocketbase" | "rest" | "local"
   url  : adresse du serveur ("auto" = le serveur qui héberge l'application)
   cle  : clé PUBLIQUE uniquement (jamais service_role / sb_secret / mot de passe)
   ================================================================== */

/* --- Serveur actuel : Supabase --- */
window.PG_SERVEUR = {
  type: "supabase",
  url: "https://bqaufnotrlpiggzwniyc.supabase.co",
  cle: "sb_publishable_zQBJPbV9-DwIX3xegPQceA_KkBVGSwc"
};

/* --- Pour passer sur un autre serveur : supprimer les « // » d'UN seul bloc ci-dessous --- */

/* Deuxième serveur EN LIGNE avec PocketBase (voir CONNEXIONS.md §1) */
// window.PG_SERVEUR = { type: "pocketbase", url: "https://pb.mondomaine.com" };

/* Deuxième serveur EN LIGNE avec l'API REST (serveur/server.mjs ou votre propre serveur, voir CONNEXIONS.md §2) */
// window.PG_SERVEUR = { type: "rest", url: "https://api.mondomaine.com", cle: "" };

/* Serveur LOCAL (ordinateur du service, réseau Wi-Fi de l'hôpital) : l'application et les données
   sont servies par le même ordinateur → ouvrir http://ADRESSE-DE-L-ORDINATEUR:8787 sur les téléphones */
// window.PG_SERVEUR = { type: "rest", url: "auto" };

/* Sans serveur : données gardées sur chaque appareil */
// window.PG_SERVEUR = { type: "local" };
