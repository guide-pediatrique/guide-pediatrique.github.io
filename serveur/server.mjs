/* Guide de Pédiatrie — serveur de référence « API REST »
   Aucune dépendance : Node.js 22.13 ou plus récent (module node:sqlite intégré).
   Démarrage :  node server.mjs
   Serveur LOCAL : lancez-le depuis le dossier du dépôt avec  APP=..  pour qu'il serve aussi l'application
                (les téléphones ouvrent alors http://ADRESSE-DE-L-ORDINATEUR:8787 ; config.js : url "auto").
   Variables :  PORT=8787  DB=./guide.db  SECRET=<longue chaîne aléatoire>  ORIGINS=https://votre-site.github.io
                ADMINS=email1@x.com,email2@y.com   (comptes administrateurs)
   Pour MySQL / PostgreSQL / SQL Server / MongoDB : gardez les mêmes routes et remplacez
   les fonctions de la section « STOCKAGE » par les requêtes de votre base. */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scryptSync, randomBytes, timingSafeEqual, createHmac, createHash, randomUUID } from "node:crypto";

const PORT = +(process.env.PORT || 8787);
const SECRET = process.env.SECRET || (console.warn("⚠️  Définissez SECRET en production."), randomBytes(32).toString("hex"));
const ORIGINS = (process.env.ORIGINS || "*").split(",").map(s => s.trim());
const ADMINS = (process.env.ADMINS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
const COLS = new Set(["observations", "patients", "consultations", "entrainement", "examens", "presentations", "publications", "theses", "carnet", "evc", "cames", "notes", "coffre", "avis_hist"]);
const APP = process.env.APP ? resolve(process.env.APP) : null; // dossier de l'application à servir (facultatif)
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const SHARED_READ = new Set(["examens", "evc"]); // classement et banque EVC visibles par tous les connectés
const MAX_REC = 1_000_000;            // taille maximale d'un enregistrement privé (1 Mo)
const MAX_SHARED = 120_000;          // taille maximale d'un enregistrement partagé (120 Ko)

/* ===== STOCKAGE (SQLite) ===== */
const db = new DatabaseSync(process.env.DB || "./guide.db");
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, nom TEXT, prenom TEXT, email TEXT UNIQUE, tel TEXT UNIQUE, profession TEXT, hash TEXT, is_admin INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS records(col TEXT, id TEXT, user_id TEXT, data TEXT, updated_at TEXT, PRIMARY KEY(col,id,user_id));
CREATE INDEX IF NOT EXISTS rec_user ON records(col,user_id,updated_at);
CREATE TABLE IF NOT EXISTS avis_acces(user_id TEXT PRIMARY KEY, groupe TEXT, statut TEXT, carte TEXT, message TEXT, demande_le TEXT, decide_le TEXT, motif TEXT);
CREATE TABLE IF NOT EXISTS avis(id TEXT PRIMARY KEY, groupe TEXT, cree_le TEXT, ticket_hash TEXT, contenu TEXT, nb_rep INTEGER DEFAULT 0, derniere_rep TEXT);
CREATE TABLE IF NOT EXISTS avis_reponses(id TEXT PRIMARY KEY, avis_id TEXT, cree_le TEXT, ticket_hash TEXT, par_demandeur INTEGER, contenu TEXT);
CREATE TABLE IF NOT EXISTS contenus(id TEXT PRIMARY KEY, data TEXT, maj TEXT);
CREATE TABLE IF NOT EXISTS avis_quota(user_id TEXT, jour TEXT, n_avis INTEGER DEFAULT 0, n_rep INTEGER DEFAULT 0, PRIMARY KEY(user_id,jour));`);
const q = {
  userByEmail: db.prepare("SELECT * FROM users WHERE email=?"),
  userByIdent: db.prepare("SELECT * FROM users WHERE email=? OR replace(tel,' ','')=?"),
  userById: db.prepare("SELECT * FROM users WHERE id=?"),
  addUser: db.prepare("INSERT INTO users(id,nom,prenom,email,tel,profession,hash,is_admin,created_at) VALUES(?,?,?,?,?,?,?,?,?)"),
  updUser: db.prepare("UPDATE users SET nom=?,prenom=?,tel=? WHERE id=?"),
  setHash: db.prepare("UPDATE users SET hash=? WHERE id=?"),
  allUsers: db.prepare("SELECT * FROM users ORDER BY created_at DESC"),
  list: db.prepare("SELECT data FROM records WHERE col=? AND user_id=? ORDER BY updated_at DESC"),
  listAll: db.prepare("SELECT data FROM records WHERE col=? ORDER BY updated_at DESC"),
  put: db.prepare("INSERT INTO records(col,id,user_id,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(col,id,user_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at"),
  del: db.prepare("DELETE FROM records WHERE col=? AND id=? AND user_id=?"),
};

/* ===== Sécurité ===== */
const hashPw = pw => { const s = randomBytes(16); return s.toString("hex") + ":" + scryptSync(pw, s, 64).toString("hex"); };
const checkPw = (pw, h) => { const [s, k] = (h || ":").split(":"); try { return timingSafeEqual(Buffer.from(k, "hex"), scryptSync(pw, Buffer.from(s, "hex"), 64)); } catch { return false; } };
const b64 = s => Buffer.from(s).toString("base64url");
const sign = uid => { const p = b64(JSON.stringify({ uid, exp: Date.now() + 7 * 864e5 })); return p + "." + createHmac("sha256", SECRET).update(p).digest("base64url"); };
const verify = t => { const [p, s] = (t || "").split("."); if (!p || !s) return null; const ok = createHmac("sha256", SECRET).update(p).digest("base64url");
  if (ok.length !== s.length || !timingSafeEqual(Buffer.from(ok), Buffer.from(s))) return null; const j = JSON.parse(Buffer.from(p, "base64url")); return j.exp > Date.now() ? j.uid : null; };
const PW_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const pub = u => ({ id: u.id, nom: u.nom, prenom: u.prenom, email: u.email, tel: u.tel, profession: u.profession, isAdmin: !!u.is_admin || ADMINS.includes(u.email), createdAt: u.created_at });
const hits = new Map(); // limite simple des tentatives de connexion
const limited = ip => { const n = Date.now(), a = (hits.get(ip) || []).filter(t => n - t < 15 * 60e3); a.push(n); hits.set(ip, a); return a.length > 20; };


/* ===== AVIS ENTRE CONFRÈRES (mêmes règles que supabase_v9.sql) =====
   Les tables d'avis ne stockent aucun identifiant d'utilisateur. */
const H = t => createHash("sha256").update(String(t), "utf8").digest("hex");
const nowIso = () => new Date().toISOString(), ago = ms => new Date(Date.now() - ms).toISOString();
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const AV = {
  acces: db.prepare("SELECT * FROM avis_acces WHERE user_id=?"),
  upAcces: db.prepare("INSERT INTO avis_acces(user_id,groupe,statut,carte,message,demande_le,decide_le,motif) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET groupe=excluded.groupe,statut=excluded.statut,carte=excluded.carte,message=COALESCE(excluded.message,avis_acces.message),demande_le=COALESCE(excluded.demande_le,avis_acces.demande_le),decide_le=excluded.decide_le,motif=excluded.motif"),
  get: db.prepare("SELECT * FROM avis WHERE id=?"),
  ins: db.prepare("INSERT INTO avis(id,groupe,cree_le,ticket_hash,contenu,nb_rep) VALUES(?,?,?,?,?,0)"),
  reps: db.prepare("SELECT * FROM avis_reponses WHERE avis_id=? ORDER BY cree_le"),
  insRep: db.prepare("INSERT INTO avis_reponses(id,avis_id,cree_le,ticket_hash,par_demandeur,contenu) VALUES(?,?,?,?,?,?)"),
  incRep: db.prepare("UPDATE avis SET nb_rep=nb_rep+?, derniere_rep=? WHERE id=?"),
  groupe: db.prepare("SELECT * FROM avis WHERE groupe=? ORDER BY cree_le DESC LIMIT 400"),
  recent: db.prepare("SELECT * FROM avis WHERE cree_le>? ORDER BY cree_le DESC"),
  del: db.prepare("DELETE FROM avis WHERE id=? AND ticket_hash=?"),
  delReps: db.prepare("DELETE FROM avis_reponses WHERE avis_id NOT IN (SELECT id FROM avis)"),
  purge: db.prepare("DELETE FROM avis WHERE cree_le<?"),
  quota: db.prepare("INSERT INTO avis_quota(user_id,jour,n_avis,n_rep) VALUES(?,?,?,?) ON CONFLICT(user_id,jour) DO UPDATE SET n_avis=n_avis+excluded.n_avis,n_rep=n_rep+excluded.n_rep RETURNING n_avis,n_rep"),
};
const avGroupe = me => { const a = AV.acces.get(me.id); return a && a.statut === "actif" && a.groupe === me.profession ? a.groupe : null; };
const avVisible = a => (a.nb_rep === 0 && a.cree_le > ago(7 * 864e5)) || a.cree_le > ago(864e5);
const avJson = a => ({ id: a.id, groupe: a.groupe, cree_le: a.cree_le, nb_rep: a.nb_rep, contenu: JSON.parse(a.contenu),
  reponses: AV.reps.all(a.id).map(r => ({ id: r.id, cree_le: r.cree_le, p: r.ticket_hash.slice(0, 10), par_demandeur: !!r.par_demandeur, contenu: JSON.parse(r.contenu) })) });
const avPurge = () => { AV.purge.run(ago(15 * 864e5)); AV.delReps.run(); };
const avErr = m => Object.assign(new Error(m), { status: 400 });
const monAcces = me => { const a = AV.acces.get(me.id) || {}; return { profession: me.profession, statut: a.statut || "aucun", groupe: a.groupe || null, actif: !!avGroupe(me), motif: a.motif || null, demande_le: a.demande_le || null, decide_le: a.decide_le || null, carte: !!a.carte }; };
function avRpc(name, b, me) {
  const isAdm = pub(me).isAdmin, adm = () => { if (!isAdm) throw Object.assign(new Error("Réservé à l'administrateur"), { status: 403 }); };
  const need = () => { const g = avGroupe(me); if (!g) throw Object.assign(new Error("Accès à l'option Avis non autorisé"), { status: 403 }); return g; };
  const okContenu = c => { if (!c || typeof c !== "object" || Array.isArray(c)) throw avErr("Contenu invalide"); const t = JSON.stringify(c); if (EMAIL_RE.test(t)) throw avErr("Adresse e-mail interdite dans un avis (anonymat)"); return t; };
  switch (name) {
    case "avis_mon_acces": return monAcces(me);
    case "avis_demander": {
      const carte = b.p_carte ?? null;
      if (carte !== null && (!/^data:image\/(jpeg|png|webp);base64,/.test(carte) || carte.length > 1_400_000)) throw avErr("Image invalide ou trop lourde");
      const a = AV.acces.get(me.id);
      if (a && a.statut === "actif" && avGroupe(me)) return monAcces(me);
      if (a && a.statut === "suspendu") throw avErr("Accès suspendu par l'administrateur");
      AV.upAcces.run(me.id, me.profession, "attente", carte, String(b.p_message || "").slice(0, 500), nowIso(), null, null); return monAcces(me);
    }
    case "avis_admin_liste": adm(); return q.allUsers.all().map(u => { const a = AV.acces.get(u.id) || {}; return { user_id: u.id, nom: u.nom, prenom: u.prenom, email: u.email, profession: u.profession, statut: a.statut || "aucun", carte: !!a.carte, message: a.message || null, demande_le: a.demande_le || null, decide_le: a.decide_le || null, motif: a.motif || null, coherent: !a.groupe || a.groupe === u.profession }; })
      .sort((x, y) => (y.statut === "attente") - (x.statut === "attente") || String(y.demande_le || "").localeCompare(String(x.demande_le || "")));
    case "avis_admin_carte": adm(); return (AV.acces.get(b.p_user) || {}).carte || null;
    case "avis_admin_decider": { adm(); if (!["actif", "refuse", "suspendu"].includes(b.p_statut)) throw avErr("Statut invalide"); const u = q.userById.get(b.p_user); if (!u) throw avErr("Utilisateur introuvable");
      AV.upAcces.run(u.id, u.profession, b.p_statut, null, null, null, nowIso(), String(b.p_motif || "").slice(0, 300)); return null; }
    case "avis_admin_avis": adm(); return AV.recent.all(ago(864e5)).map(avJson);
    case "avis_liste": { const g = need(); avPurge(); return AV.groupe.all(g).filter(avVisible).slice(0, 150).map(avJson); }
    case "avis_publier": { const g = need(); if (String(b.p_ticket || "").length < 32) throw avErr("Ticket invalide"); if (!/^av-[a-z0-9]{10,40}$/.test(b.p_id || "")) throw avErr("Identifiant invalide");
      const t = okContenu(b.p_contenu); if (Buffer.byteLength(t) >= 40000) throw avErr("Avis trop long");
      if (AV.quota.get(me.id, nowIso().slice(0, 10), 1, 0).n_avis > 20) throw avErr("Limite de 20 demandes par jour atteinte");
      avPurge(); AV.ins.run(b.p_id, g, nowIso(), H(b.p_ticket), t); return avJson(AV.get.get(b.p_id)); }
    case "avis_repondre": { if (String(b.p_ticket || "").length < 32) throw avErr("Ticket invalide"); if (!/^rp-[a-z0-9]{10,40}$/.test(b.p_id || "")) throw avErr("Identifiant invalide");
      const a = AV.get.get(b.p_avis); if (!a) throw avErr("Avis introuvable ou expiré"); const th = H(b.p_ticket), dem = a.ticket_hash === th, g = avGroupe(me);
      if (!dem && (!g || g !== a.groupe || !avVisible(a))) throw avErr("Avis introuvable ou expiré");
      const t = okContenu(b.p_contenu); if (Buffer.byteLength(t) >= 20000) throw avErr("Réponse trop longue");
      if (AV.quota.get(me.id, nowIso().slice(0, 10), 0, 1).n_rep > 200) throw avErr("Limite de réponses du jour atteinte");
      AV.insRep.run(b.p_id, a.id, nowIso(), th, dem ? 1 : 0, t); AV.incRep.run(dem ? 0 : 1, nowIso(), a.id); return avJson(AV.get.get(a.id)); }
    case "avis_mes": return (Array.isArray(b.p_items) ? b.p_items.slice(0, 300) : []).map(x => { const a = x && AV.get.get(String(x.id)); return a && a.ticket_hash === H(x.ticket) ? avJson(a) : null; }).filter(Boolean);
    case "avis_supprimer": AV.del.run(String(b.p_id), H(b.p_ticket)); AV.delReps.run(); return null;
  }
  throw Object.assign(new Error("Fonction inconnue"), { status: 404 });
}

/* ===== HTTP ===== */
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
const err = (res, code, message) => send(res, code, { message });
const readJSON = req => new Promise((ok, ko) => { let d = ""; req.on("data", c => { d += c; if (d.length > 8e6) { ko(new Error("Requête trop volumineuse")); req.destroy(); } }); req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch { ko(new Error("JSON invalide")); } }); });

http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", ORIGINS.includes("*") ? "*" : (ORIGINS.includes(origin) ? origin : ORIGINS[0]));
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url, "http://x"), p = url.pathname.replace(/\/+$/, "") || "/", ip = req.socket.remoteAddress;
  try {
    const isApi = /^\/(health|auth|data|admin|avis|contenu)(\/|$)/.test(p);
    if (APP && !isApi && req.method === "GET") {
      const f = normalize(join(APP, p === "/" ? "index.html" : decodeURIComponent(p)));
      if (!f.startsWith(APP) || /(^|[\\/])\.|serveur|\.db/.test(f.slice(APP.length))) return err(res, 404, "Introuvable");
      try { const b = await readFile(f); res.writeHead(200, { "Content-Type": MIME[extname(f)] || "application/octet-stream", "Cache-Control": "no-cache" }); return res.end(b); }
      catch { return err(res, 404, "Introuvable"); }
    }
    if (p === "/health") return send(res, 200, { ok: true, nom: "Serveur Guide de Pédiatrie" });

    if (p === "/auth/register" && req.method === "POST") {
      const b = await readJSON(req), email = String(b.email || "").trim().toLowerCase();
      if (!b.nom || !b.prenom || !/^\S+@\S+\.\S+$/.test(email) || !b.tel) return err(res, 400, "Champs obligatoires manquants.");
      if (!PW_RE.test(b.password || "")) return err(res, 400, "Mot de passe : 8 caractères minimum, avec majuscule, minuscule et chiffre.");
      if (!["etudiant", "resident", "pediatre"].includes(b.profession)) return err(res, 400, "Profession invalide.");
      if (q.userByIdent.get(email, String(b.tel).replace(/\s/g, ""))) return err(res, 409, "Un compte existe déjà avec cet e-mail ou ce téléphone.");
      const id = randomUUID(); q.addUser.run(id, b.nom, b.prenom, email, String(b.tel), b.profession, hashPw(b.password), ADMINS.includes(email) ? 1 : 0, new Date().toISOString());
      return send(res, 201, { token: sign(id), user: pub(q.userById.get(id)) });
    }
    if (p === "/auth/login" && req.method === "POST") {
      if (limited(ip)) return err(res, 429, "Trop de tentatives, réessayez dans 15 minutes.");
      const b = await readJSON(req), id = String(b.identifiant || "").trim().toLowerCase();
      const u = q.userByIdent.get(id, id.replace(/\s/g, ""));
      if (!u || !checkPw(b.password || "", u.hash)) return err(res, 401, "Identifiant ou mot de passe incorrect.");
      return send(res, 200, { token: sign(u.id), user: pub(u) });
    }
    if (p === "/auth/reset") return err(res, 501, "Réinitialisation par e-mail non configurée : contactez l'administrateur.");

    /* Routes protégées */
    const uid = verify((req.headers.authorization || "").replace(/^Bearer /, ""));
    const me = uid && q.userById.get(uid);
    if (!me) return err(res, 401, "Session expirée, reconnectez-vous.");
    if (p === "/auth/logout") return send(res, 204);
    if (p === "/auth/me" && req.method === "GET") return send(res, 200, pub(me));
    if (p === "/auth/me" && req.method === "PATCH") { const b = await readJSON(req); q.updUser.run(b.nom ?? me.nom, b.prenom ?? me.prenom, b.tel ?? me.tel, me.id); return send(res, 200, pub(q.userById.get(me.id))); }
    if (p === "/auth/password" && req.method === "POST") { const b = await readJSON(req);
      if (!checkPw(b.ancien || "", me.hash)) return err(res, 400, "Mot de passe actuel incorrect."); if (!PW_RE.test(b.nouveau || "")) return err(res, 400, "Nouveau mot de passe trop faible.");
      q.setHash.run(hashPw(b.nouveau), me.id); return send(res, 204); }
    if (p === "/admin/users") { if (!pub(me).isAdmin) return err(res, 403, "Réservé à l'administrateur."); return send(res, 200, q.allUsers.all().map(pub)); }

    /* Traduction anglais → français (facultatif) : DEEPL_API_KEY dans l'environnement du serveur */
    if (p === "/traduire" && req.method === "POST") {
      const key = process.env.DEEPL_API_KEY;
      if (!key) return err(res, 501, "Traduction non configurée sur ce serveur.");
      const b = await readJSON(req), textes = Array.isArray(b.textes) ? b.textes.filter(t => typeof t === "string").slice(0, 60) : [];
      if (!textes.length) return err(res, 400, "Aucun texte à traduire.");
      if (textes.reduce((a, t) => a + t.length, 0) > 30000) return err(res, 413, "Texte trop long (30 000 caractères maximum).");
      const base = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
      const r = await fetch(base + "/v2/translate", { method: "POST", headers: { Authorization: "DeepL-Auth-Key " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ text: textes, target_lang: "FR", formality: "prefer_more", preserve_formatting: true, context: String(b.contexte || "").slice(0, 500) || undefined }) });
      if (!r.ok) return err(res, 502, r.status === 456 ? "Quota DeepL du mois atteint." : "DeepL : erreur " + r.status);
      const j = await r.json();
      return send(res, 200, { traductions: j.translations.map(t => t.text), moteur: "DeepL" });
    }
    /* Contenu pédagogique protégé : lecture pour les connectés, écriture pour l'administrateur */
    if (p === "/contenu/meta" && req.method === "GET") { const r = db.prepare("SELECT data FROM contenus WHERE id='meta'").get(); return send(res, 200, r ? { data: JSON.parse(r.data) } : null); }
    if (p === "/contenu" && req.method === "GET") { const ids = url.searchParams.get("ids"); return send(res, 200, db.prepare("SELECT id, data FROM contenus").all().map(r => ids ? { id: r.id } : { id: r.id, data: JSON.parse(r.data) })); }
    const cm = p.match(/^\/contenu\/(.+)$/);
    if (cm && (req.method === "PUT" || req.method === "DELETE")) {
      if (!pub(me).isAdmin) return err(res, 403, "Réservé à l'administrateur.");
      const id = decodeURIComponent(cm[1]); if (!/^(meta|[A-Z_]+#\d+)$/.test(id)) return err(res, 400, "Identifiant invalide.");
      if (req.method === "DELETE") { db.prepare("DELETE FROM contenus WHERE id=?").run(id); return send(res, 204); }
      const b = await readJSON(req); if (b.data == null) return err(res, 400, "Données manquantes.");
      db.prepare("INSERT INTO contenus(id,data,maj) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,maj=excluded.maj").run(id, JSON.stringify(b.data), new Date().toISOString()); return send(res, 204);
    }
    const ar = p.match(/^\/avis\/rpc\/([a-z_]+)$/);
    if (ar && req.method === "POST") { try { return send(res, 200, avRpc(ar[1], await readJSON(req), me) ?? null); } catch (e) { if (e.status) return err(res, e.status, e.message); throw e; } }
    const m = p.match(/^\/data\/([a-z_]+)(?:\/(.+))?$/);
    if (m && COLS.has(m[1])) {
      const [, col, rid] = m, id = rid && decodeURIComponent(rid);
      if (req.method === "GET" && !id) { const rows = SHARED_READ.has(col) ? q.listAll.all(col) : q.list.all(col, me.id); return send(res, 200, rows.map(r => JSON.parse(r.data))); }
      if (col === "evc" && req.method !== "GET" && me.profession !== "pediatre" && !pub(me).isAdmin) return err(res, 403, "Seuls les pédiatres peuvent modifier la banque EVC.");
      if (req.method === "PUT" && id) {
        const o = await readJSON(req);
        if (!o || typeof o !== "object" || Array.isArray(o)) return err(res, 400, "Données invalides.");
        o.id = id; o.updatedAt = new Date().toISOString();
        const body = JSON.stringify(o);
        const lim = SHARED_READ.has(col) ? MAX_SHARED : MAX_REC;
        if (Buffer.byteLength(body) > lim) return err(res, 413, `Enregistrement trop volumineux (max ${Math.round(lim / 1000)} Ko).`);
        q.put.run(col, id, me.id, body, o.updatedAt);
        return send(res, 200, o);
      }
      if (req.method === "DELETE" && id) { q.del.run(col, id, me.id); return send(res, 204); }
    }
    return err(res, 404, "Route inconnue.");
  } catch (e) { console.error(e); return err(res, 500, e.message || "Erreur interne"); }
}).listen(PORT, () => console.log(`Guide de Pédiatrie — API prête sur http://localhost:${PORT}`));
