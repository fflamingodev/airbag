// =====================================================================
//  Démo « hello world » : Keycloak + un moteur d'autorisation
//  Ce serveur est le MÊME pour les 5 moteurs (OpenFGA, SpiceDB,
//  Permify, Casbin, Code Maison). Seul le fichier moteur.js change.
//
//  Le trajet d'une demande :
//    navigateur --(1) connexion--> Keycloak --(2) jeton--> navigateur
//    navigateur --(3) demande + jeton--> CE SERVEUR --(4) question--> moteur
//
//  Aucune bibliothèque externe : uniquement ce qui est fourni avec Node.js.
// =====================================================================
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./scenario');

const CONF = {
  port: Number(process.env.PORT || 3000),
  // Adresse de Keycloak vue par le NAVIGATEUR (c'est elle qui est écrite dans le jeton : « iss »)
  keycloakNavigateur: process.env.KEYCLOAK_URL_NAVIGATEUR || 'http://localhost:8080',
  // Adresse de Keycloak vue par CE SERVEUR, à l'intérieur de Docker
  keycloakInterne: process.env.KEYCLOAK_URL_INTERNE || 'http://keycloak:8080',
  realm: 'reskin-demo',
  client: 'app-demo',
};
const EMETTEUR_ATTENDU = `${CONF.keycloakNavigateur}/realms/${CONF.realm}`;
const DEMOS = [
  { nom: 'OpenFGA', port: 3001 }, { nom: 'SpiceDB', port: 3002 }, { nom: 'Permify', port: 3003 },
  { nom: 'Casbin', port: 3004 }, { nom: 'Code maison', port: 3005 }, { nom: 'Keycloak KAS', port: 3006 },
];

// Le moteur choisi (un fichier moteur.js par dossier)
const moteur = require(process.env.MOTEUR || '/moteur/moteur.js');
let fannyRetiree = false; // état de la délégation de démo

// ---------------------------------------------------------------------
// 1. Vérifier le jeton envoyé par le navigateur (JWT signé par Keycloak)
// ---------------------------------------------------------------------
let clesKeycloak = {}; // kid -> clé publique

async function chargerClesKeycloak() {
  const url = `${CONF.keycloakInterne}/realms/${CONF.realm}/protocol/openid-connect/certs`;
  const reponse = await fetch(url);
  if (!reponse.ok) throw new Error(`Keycloak ne donne pas ses clés (${reponse.status})`);
  const { keys } = await reponse.json();
  clesKeycloak = {};
  for (const cle of keys) {
    if (cle.use === 'sig' && cle.kty === 'RSA') clesKeycloak[cle.kid] = crypto.createPublicKey({ key: cle, format: 'jwk' });
  }
}

const lireBase64url = (texte) => JSON.parse(Buffer.from(texte, 'base64url').toString('utf8'));

class Erreur extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function verifierJeton(entete) {
  if (!entete || !entete.startsWith('Bearer ')) throw new Erreur(401, 'Pas de jeton : connectez-vous.');
  const morceaux = entete.slice(7).split('.');
  if (morceaux.length !== 3) throw new Erreur(401, 'Jeton mal formé.');
  const [e, c, signature] = morceaux;
  const enTete = lireBase64url(e);
  const contenu = lireBase64url(c);

  // a) la signature : le jeton vient bien de Keycloak et n'a pas été modifié
  if (enTete.alg !== 'RS256') throw new Erreur(401, `Algorithme refusé : ${enTete.alg}`);
  if (!clesKeycloak[enTete.kid]) await chargerClesKeycloak();
  const cle = clesKeycloak[enTete.kid];
  if (!cle) throw new Erreur(401, 'Clé de signature inconnue.');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${e}.${c}`), cle, Buffer.from(signature, 'base64url'));
  if (!ok) throw new Erreur(401, 'Signature invalide.');

  // b) le contenu : bon émetteur, bonne application, pas expiré
  if (contenu.iss !== EMETTEUR_ATTENDU) throw new Erreur(401, `Émetteur inattendu : ${contenu.iss}`);
  if (![].concat(contenu.aud || []).includes(CONF.client)) throw new Erreur(401, "Ce jeton n'est pas destiné à cette application.");
  if (contenu.exp * 1000 < Date.now()) throw new Erreur(401, 'Jeton expiré : reconnectez-vous.');

  return {
    // Pour la démo on utilise le nom de connexion. Dans la vraie plateforme : l'identifiant « sub ».
    utilisateur: contenu.preferred_username,
    rolesApp: contenu.resource_access?.[CONF.client]?.roles || [],
    jeton: entete.slice(7), // gardé pour les moteurs qui décident à partir du jeton (Keycloak KAS)
  };
}

// ---------------------------------------------------------------------
// 2. Le journal des décisions (en mémoire, les 60 dernières)
// ---------------------------------------------------------------------
const journal = [];
function noter(entree) {
  journal.unshift({ heure: new Date().toLocaleTimeString('fr-BE'), ...entree });
  journal.length = Math.min(journal.length, 60);
}

// ---------------------------------------------------------------------
// 3. La décision : niveau 1 (Keycloak) puis niveau 3 (le moteur)
// ---------------------------------------------------------------------
async function decider(utilisateur, aUnRoleDansLApp, action, objet, { journaliser = true, jeton } = {}) {
  let d;
  if (!aUnRoleDansLApp) {
    // Niveau 1 : Keycloak dit que ce compte n'a pas accès à l'application
    d = { autorise: false, par: 'Keycloak', duree_ms: 0 };
  } else {
    // Niveau 3 : le moteur dit si CE compte peut faire CETTE action sur CET objet, MAINTENANT
    const debut = process.hrtime.bigint();
    const autorise = await moteur.verifier(utilisateur, action, objet, new Date(), { jeton });
    const duree = Number(process.hrtime.bigint() - debut) / 1e6;
    d = { autorise, par: moteur.nom, duree_ms: Math.round(duree * 10) / 10 };
  }
  if (journaliser) noter({ utilisateur, action, objet: S.LIBELLES[objet] || objet, ...d });
  return d;
}

async function droitsDe(utilisateur, aUnRole, options) {
  const lignes = [];
  for (const cas of S.CAS) {
    const d = await decider(utilisateur, aUnRole, cas.action, cas.objet, options);
    const att = S.attendu(utilisateur, cas.id, fannyRetiree);
    lignes.push({ ...cas, libelle: S.LIBELLES[cas.objet], ...d, attendu: att, conforme: d.autorise === att });
  }
  return lignes;
}

// ---------------------------------------------------------------------
// 4. Les routes de l'API
// ---------------------------------------------------------------------
const PAGE = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

async function lireCorps(req) {
  let texte = '';
  for await (const morceau of req) texte += morceau;
  return texte ? JSON.parse(texte) : {};
}

async function router(req, res) {
  const url = new URL(req.url, 'http://x');
  const envoyer = (code, donnees) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(donnees));
  };

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  // Informations publiques pour la page
  if (req.method === 'GET' && url.pathname === '/api/config') {
    return envoyer(200, {
      keycloak: CONF.keycloakNavigateur, realm: CONF.realm, client: CONF.client,
      moteur: { nom: moteur.nom, version: moteur.version, explication: moteur.explication, modele: moteur.modele },
      comptes: S.COMPTES.map(({ nom, roleKeycloak, type }) => ({ nom, roleKeycloak, type })),
      regles: S.REGLES, demos: DEMOS, port: CONF.port,
    });
  }

  // Tout le reste demande d'être connecté
  const qui = await verifierJeton(req.headers.authorization);
  const aUnRole = qui.rolesApp.length > 0;

  if (req.method === 'GET' && url.pathname === '/api/moi') return envoyer(200, { utilisateur: qui.utilisateur, rolesApp: qui.rolesApp, fannyRetiree });

  // Les 14 questions pour le compte connecté
  if (req.method === 'GET' && url.pathname === '/api/mes-droits') return envoyer(200, await droitsDe(qui.utilisateur, aUnRole, { jeton: qui.jeton }));

  // Le banc de test : les 14 questions pour TOUS les comptes (réponse du moteur comparée à l'attendu)
  if (req.method === 'GET' && url.pathname === '/api/banc') {
    const debut = Date.now();
    const comptes = [];
    for (const c of S.COMPTES) comptes.push({ nom: c.nom, lignes: await droitsDe(c.nom, c.roleKeycloak !== null, { journaliser: false }) });
    const toutes = comptes.flatMap((c) => c.lignes);
    const appelsMoteur = toutes.filter((l) => l.par !== 'Keycloak');
    return envoyer(200, {
      comptes, total: toutes.length, conformes: toutes.filter((l) => l.conforme).length,
      appels: appelsMoteur.length, duree_totale_ms: Date.now() - debut,
      duree_moyenne_ms: Math.round((appelsMoteur.reduce((s, l) => s + l.duree_ms, 0) / appelsMoteur.length) * 10) / 10,
    });
  }

  // Un bouton de l'écran « Ce que voit le compte » : l'API revérifie TOUJOURS auprès du moteur.
  // (Cacher un bouton dans la page ne protège rien : quelqu'un peut appeler l'API directement.)
  if (req.method === 'POST' && url.pathname === '/api/action') {
    const { action, objet } = await lireCorps(req);
    if (!S.CAS.some((c) => c.action === action && c.objet === objet)) throw new Erreur(400, 'Action ou objet inconnu.');
    const d = await decider(qui.utilisateur, aUnRole, action, objet, { jeton: qui.jeton });
    if (!d.autorise) throw new Erreur(403, `Refusé par ${d.par} : ${qui.utilisateur} ne peut pas « ${action} » sur ${S.LIBELLES[objet]}.`);
    return envoyer(200, { ok: true, message: `Fait (démo) : ${action} sur ${S.LIBELLES[objet]}, autorisé par ${d.par}.` });
  }

  if (req.method === 'GET' && url.pathname === '/api/relations') return envoyer(200, await moteur.relations());

  // La délégation : retirer (ou rendre) le rôle de facility manager à fanny.
  // Le MOTEUR décide qui a le droit de le faire (permission « deleguer » sur le bâtiment A).
  if (req.method === 'POST' && url.pathname === '/api/delegation') {
    const { retirer } = await lireCorps(req);
    const d = await decider(qui.utilisateur, aUnRole, 'deleguer', 'batiment:A', { jeton: qui.jeton });
    if (!d.autorise) throw new Erreur(403, `${qui.utilisateur} n'a pas le droit de déléguer sur le bâtiment A (seul le propriétaire peut).`);
    if (retirer) await moteur.retirer(S.DELEGATION); else await moteur.ajouter(S.DELEGATION);
    fannyRetiree = !!retirer;
    noter({ utilisateur: qui.utilisateur, action: retirer ? 'révoque fanny' : 'rend le rôle à fanny', objet: 'Bâtiment A', autorise: true, par: moteur.nom, duree_ms: 0 });
    return envoyer(200, { fannyRetiree });
  }

  if (req.method === 'GET' && url.pathname === '/api/journal') return envoyer(200, journal);

  throw new Erreur(404, 'Route inconnue.');
}

// ---------------------------------------------------------------------
// 5. Démarrage : on prépare le moteur et on attend Keycloak, puis on écoute
// ---------------------------------------------------------------------
async function reessayer(nom, fonction, max) {
  for (let essai = 1; ; essai++) {
    try { return await fonction(); } catch (err) {
      if (essai >= max) throw err;
      if (essai % 5 === 1) console.log(`${nom} n'est pas encore prêt (essai ${essai}) : ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function demarrer() {
  console.log(`Moteur : ${moteur.nom} ${moteur.version}`);
  await reessayer(moteur.nom, () => moteur.demarrer(S.FAITS), 120);
  console.log('Moteur prêt : modèle et faits de départ chargés.');
  await reessayer('Keycloak', chargerClesKeycloak, 120);
  console.log('Keycloak prêt : clés de signature chargées.');

  http.createServer((req, res) => {
    router(req, res).catch((err) => {
      const code = Number.isInteger(err.code) ? err.code : 500;
      if (code === 500) console.error(err);
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ erreur: err.message }));
    });
  }).listen(CONF.port, () => console.log(`Démo ${moteur.nom} prête : ouvrez http://localhost:${process.env.PORT_NAVIGATEUR || CONF.port}`));
}

demarrer().catch((err) => { console.error('Impossible de démarrer :', err); process.exit(1); });
