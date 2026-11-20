// Guide de Pédiatrie — fonction « traduire » (Supabase Edge Function)
// Traduit de l'anglais vers le français avec DeepL (recommandé) ou Google Cloud Translation.
// La clé de traduction reste sur le serveur (secret), jamais dans l'application.
//
// Secrets à définir dans Supabase > Edge Functions > Secrets :
//   DEEPL_API_KEY        clé DeepL (les clés gratuites se terminent par « :fx »)
//   GOOGLE_TRANSLATE_KEY (facultatif, utilisé seulement si DEEPL_API_KEY est absent)
//   ALLOWED_ORIGINS      adresse(s) du site, ex. https://guide-pediatrique.github.io

const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://guide-pediatrique.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);
const MAX_CHARS = 30000;          // par requête
const MAX_TEXTS = 60;             // segments par requête
const RATE = new Map<string, number[]>(); // limite simple par utilisateur (par instance)

function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (b: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(b), { status, headers: { ...h, "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin") ?? "");
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ message: "Méthode non autorisée" }, 405, h);

  // 1. Vérifier que la personne est connectée à l'application
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const u = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: key } });
  if (!u.ok) return json({ message: "Connexion requise" }, 401, h);
  const user = await u.json();

  // 2. Limite de débit : 60 requêtes par tranche de 10 minutes et par utilisateur
  const now = Date.now(), hist = (RATE.get(user.id) ?? []).filter((t) => now - t < 600000);
  if (hist.length >= 60) return json({ message: "Trop de demandes de traduction, réessayez dans quelques minutes." }, 429, h);
  hist.push(now); RATE.set(user.id, hist);

  // 3. Valider la demande
  let body: { textes?: unknown; contexte?: unknown };
  try { body = await req.json(); } catch { return json({ message: "Demande invalide" }, 400, h); }
  const textes = Array.isArray(body.textes) ? body.textes.filter((t) => typeof t === "string").slice(0, MAX_TEXTS) as string[] : [];
  if (!textes.length) return json({ message: "Aucun texte à traduire" }, 400, h);
  if (textes.reduce((a, t) => a + t.length, 0) > MAX_CHARS) return json({ message: "Texte trop long (30 000 caractères maximum)" }, 413, h);
  const contexte = String(body.contexte ?? "Texte médical scientifique en pédiatrie.").slice(0, 500);

  // 4. Traduire
  const deepl = Deno.env.get("DEEPL_API_KEY"), google = Deno.env.get("GOOGLE_TRANSLATE_KEY");
  try {
    if (deepl) {
      const base = deepl.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
      const r = await fetch(`${base}/v2/translate`, {
        method: "POST",
        headers: { Authorization: `DeepL-Auth-Key ${deepl}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: textes, target_lang: "FR", formality: "prefer_more", preserve_formatting: true, context: contexte }),
      });
      if (!r.ok) return json({ message: r.status === 456 ? "Quota DeepL du mois atteint" : `DeepL : erreur ${r.status}` }, 502, h);
      const j = await r.json();
      return json({ traductions: j.translations.map((t: { text: string }) => t.text), moteur: "DeepL" }, 200, h);
    }
    if (google) {
      const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(google)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: textes, source: "en", target: "fr", format: "text" }),
      });
      if (!r.ok) return json({ message: `Google : erreur ${r.status}` }, 502, h);
      const j = await r.json();
      return json({ traductions: j.data.translations.map((t: { translatedText: string }) => t.translatedText), moteur: "Google Cloud Translation" }, 200, h);
    }
    return json({ message: "Aucune clé de traduction configurée" }, 501, h);
  } catch (_e) {
    return json({ message: "Service de traduction injoignable" }, 502, h);
  }
});
