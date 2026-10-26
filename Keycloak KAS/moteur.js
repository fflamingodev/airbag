// =====================================================================
//  Branchement de Keycloak Authorization Services (KAS)
//  Le module d'autorisation de Keycloak : AUCUN composant en plus.
//  Tout ce qu'il faut écrire pour ce « moteur » est dans ce fichier.
//
//  KAS ne lit pas une liste de faits : il faut CONSTRUIRE sa configuration
//  dans Keycloak (par son API d'administration) à partir des faits :
//   - des GROUPES (et sous-groupes) : qui a quel rôle dans quel bâtiment / ménage
//   - des RESSOURCES avec des SCOPES : chaque bâtiment, espace, machine et ses actions
//   - des POLITIQUES : « membre de tel groupe », « tel utilisateur ET avant telle date »
//   - des PERMISSIONS : telle ressource + tel scope <- telles politiques
//
//  Comment chaque type de droit est obtenu ici :
//   - rôle direct ............ membre du sous-groupe /batiment-A/proprietaire
//   - groupe (ménage) ........ sous-groupe /batiment-A/menages/dupont (master, invite)
//   - héritage ............... « extend to children » : le groupe du bâtiment couvre
//                              tous ses sous-groupes (rôles et ménages)
//   - héritage vers les objets  NON natif : NOTRE code choisit les politiques de
//                              chaque espace et machine (selon son bâtiment)
//   - exception .............. NON native : NOTRE code ne met pas la politique
//                              « gestion » sur un logement occupé
//   - date de fin ............ une politique « utilisateur ET avant la date » PAR LIEN
//   - attribut (marque) ...... un groupe par marque, mis sur les machines de la marque
//
//  La décision : pour le compte connecté, avec SON jeton (requête UMA, comme le
//  ferait une vraie API) ; pour le banc de test, avec l'outil d'évaluation de
//  l'API d'administration (le même que l'onglet « Evaluate » de la console).
// =====================================================================
const K = process.env.KEYCLOAK_URL_INTERNE || 'http://keycloak:8080';
const REALM = 'reskin-demo';
const CLIENT = 'kas-demo'; // le client Keycloak qui porte l'autorisation (« resource server »)
const ADMIN = { utilisateur: process.env.KEYCLOAK_ADMIN_UTILISATEUR || 'admin', mdp: process.env.KEYCLOAK_ADMIN_MOT_DE_PASSE || 'admin' };
const RACINE = 'kas-demo'; // le groupe racine de la démo

const SCOPES = {
  batiment: ['voir', 'modifier_structure', 'gerer_menages', 'gerer_evenements', 'deleguer'],
  espace: ['voir_mesures', 'inviter'],
  machine: ['voir_donnees', 'piloter'],
};
const ROLES_EN_GROUPE = ['proprietaire', 'building_admin', 'facility_manager']; // les rôles sans date de fin

// ---------------------------------------------------------------------
// Petits outils pour l'API d'administration de Keycloak
// ---------------------------------------------------------------------
let jetonAdmin = null, finJetonAdmin = 0;
async function admin() {
  if (jetonAdmin && Date.now() < finJetonAdmin - 10000) return jetonAdmin;
  const r = await fetch(`${K}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: ADMIN.utilisateur, password: ADMIN.mdp }),
  });
  if (!r.ok) throw new Error(`Keycloak admin ${r.status}`);
  const t = await r.json();
  jetonAdmin = t.access_token; finJetonAdmin = Date.now() + t.expires_in * 1000;
  return jetonAdmin;
}
let nbAppelsConfig = 0;
async function api(methode, chemin, corps) {
  nbAppelsConfig++;
  const r = await fetch(`${K}/admin/realms/${REALM}${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${await admin()}`, 'Content-Type': 'application/json' },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const texte = await r.text();
  if (!r.ok) throw new Error(`Keycloak ${methode} ${chemin} ${r.status} : ${texte.slice(0, 300)}`);
  const id = r.headers.get('location')?.split('/').pop();
  const json = texte ? JSON.parse(texte) : {};
  return id && !json.id ? { ...json, id } : json;
}

// ---------------------------------------------------------------------
// L'état construit au démarrage (identifiants Keycloak)
// ---------------------------------------------------------------------
let E = null;    // { clientId, rs, utilisateurs, groupes, politiques, ressources, compte }
let FAITS = [];  // les faits actuels (pour reconstruire si besoin)

const id = (texte) => texte.split(':')[1];
const typeDe = (texte) => texte.split(':')[0];
// Keycloak attend « AAAA-MM-JJ hh:mm:ss » (heure du serveur Keycloak, UTC dans Docker)
const dateKeycloak = (iso) => iso.slice(0, 19).replace('T', ' ');

async function idUtilisateur(nom) {
  if (!E.utilisateurs[nom]) {
    const [u] = await api('GET', `/users?username=${encodeURIComponent(nom)}&exact=true`);
    if (!u) throw new Error(`Compte inconnu dans Keycloak : ${nom}`);
    E.utilisateurs[nom] = u.id;
  }
  return E.utilisateurs[nom];
}

async function creerGroupe(chemin, parentId) {
  const nom = chemin.split('/').pop();
  const g = parentId ? await api('POST', `/groups/${parentId}/children`, { name: nom }) : await api('POST', '/groups', { name: nom });
  E.groupes[chemin] = g.id;
  return g.id;
}

async function construire(faits) {
  E = { utilisateurs: {}, groupes: {}, politiques: {}, ressources: {}, compte: {} };
  nbAppelsConfig = 0;

  // 0) repartir de zéro : supprimer l'ancien client et l'ancien groupe racine
  for (const c of await api('GET', `/clients?clientId=${CLIENT}`)) await api('DELETE', `/clients/${c.id}`);
  for (const g of await api('GET', `/groups?search=${RACINE}&exact=true`)) if (g.name === RACINE) await api('DELETE', `/groups/${g.id}`);

  // 1) le client qui porte l'autorisation
  E.clientId = (await api('POST', '/clients', {
    clientId: CLIENT, name: 'Autorisation de la démo (KAS)', publicClient: false, serviceAccountsEnabled: true,
    authorizationServicesEnabled: true, standardFlowEnabled: false, directAccessGrantsEnabled: false,
  })).id;
  E.rs = `/clients/${E.clientId}/authz/resource-server`;
  await api('PUT', E.rs, { policyEnforcementMode: 'ENFORCING', decisionStrategy: 'AFFIRMATIVE', allowRemoteResourceManagement: false });

  // 2) lire les faits : la structure et les liens
  const parent = {}, espaceDe = {}, occupant = {}, batimentDuMenage = {}, marqueDe = {};
  const objets = new Set(), datés = [], membres = []; // membres = { groupe, utilisateur }
  for (const f of faits) {
    if (f.relation === 'parent') { parent[f.objet] = f.sujet; objets.add(f.objet); objets.add(f.sujet); }
    if (f.relation === 'espace') { espaceDe[f.objet] = f.sujet; objets.add(f.objet); }
    if (f.relation === 'occupant') occupant[f.objet] = f.sujet;
    if (f.relation === 'menage') batimentDuMenage[f.sujet] = f.objet;
    if (f.relation === 'marque') marqueDe[f.objet] = f.sujet;
    if (typeDe(f.objet) === 'batiment') objets.add(f.objet);
  }
  for (const f of faits) {
    if (typeDe(f.sujet) !== 'utilisateur') continue;
    if (f.fin) datés.push(f);
    else if (typeDe(f.objet) === 'batiment') membres.push({ groupe: `${RACINE}/batiment-${id(f.objet)}/${f.relation}`, utilisateur: id(f.sujet) });
    else if (typeDe(f.objet) === 'menage') membres.push({ groupe: `${RACINE}/batiment-${id(batimentDuMenage[f.objet])}/menages/${id(f.objet)}/${f.relation}`, utilisateur: id(f.sujet) });
    else if (typeDe(f.objet) === 'marque') membres.push({ groupe: `${RACINE}/marque-${id(f.objet)}`, utilisateur: id(f.sujet) });
  }
  const batiments = [...objets].filter((o) => typeDe(o) === 'batiment').sort();
  const espaces = [...objets].filter((o) => typeDe(o) === 'espace').sort();
  const machines = [...objets].filter((o) => typeDe(o) === 'machine').sort();
  const marques = [...new Set(Object.values(marqueDe).concat(faits.filter((f) => f.relation === 'fabricant').map((f) => f.objet)))].sort();

  // 3) les groupes et sous-groupes
  const racine = await creerGroupe(RACINE);
  for (const b of batiments) {
    const gb = await creerGroupe(`${RACINE}/batiment-${id(b)}`, racine);
    for (const r of ROLES_EN_GROUPE) await creerGroupe(`${RACINE}/batiment-${id(b)}/${r}`, gb);
    const gm = await creerGroupe(`${RACINE}/batiment-${id(b)}/menages`, gb);
    for (const m of Object.keys(batimentDuMenage).filter((x) => batimentDuMenage[x] === b)) {
      const g = await creerGroupe(`${RACINE}/batiment-${id(b)}/menages/${id(m)}`, gm);
      await creerGroupe(`${RACINE}/batiment-${id(b)}/menages/${id(m)}/master`, g);
      await creerGroupe(`${RACINE}/batiment-${id(b)}/menages/${id(m)}/invite`, g);
    }
  }
  for (const m of marques) await creerGroupe(`${RACINE}/marque-${id(m)}`, racine);
  for (const { groupe, utilisateur } of membres) await api('PUT', `/users/${await idUtilisateur(utilisateur)}/groups/${E.groupes[groupe]}`);

  // 4) les politiques
  const politique = async (type, nom, corps) => (E.politiques[nom] = (await api('POST', `${E.rs}/policy/${type}`, { name: nom, logic: 'POSITIVE', ...corps })).id);
  const groupe = (nom, chemins, enfants = false) => politique('group', nom, { groups: chemins.map((c) => ({ id: E.groupes[c], extendChildren: enfants })) });
  for (const b of batiments) {
    const g = `${RACINE}/batiment-${id(b)}`;
    await groupe(`${b} · tout le bâtiment`, [g], true); // tous les sous-groupes : rôles ET ménages
    for (const r of ROLES_EN_GROUPE) await groupe(`${b} · ${r}`, [`${g}/${r}`]);
    await groupe(`${b} · gestion`, [`${g}/proprietaire`, `${g}/facility_manager`]);
  }
  for (const [m, b] of Object.entries(batimentDuMenage)) {
    const g = `${RACINE}/batiment-${id(b)}/menages/${id(m)}`;
    await groupe(`${m} · membres`, [g], true);
    await groupe(`${m} · master`, [`${g}/master`]);
  }
  for (const m of marques) await groupe(`${m} · fabricants`, [`${RACINE}/marque-${id(m)}`]);
  // un droit daté = « cet utilisateur » ET « avant cette date » : une politique PAR LIEN
  for (const f of datés) {
    const pu = await politique('user', `utilisateur ${id(f.sujet)} · ${f.relation} ${f.objet}`, { users: [await idUtilisateur(id(f.sujet))] });
    const pt = await politique('time', `avant le ${f.fin.slice(0, 10)} · ${f.relation} ${f.objet}`, { notOnOrAfter: dateKeycloak(f.fin) });
    await politique('aggregate', `lien ${id(f.sujet)} ${f.relation} ${f.objet} (jusqu'au ${f.fin.slice(0, 10)})`, { policies: [pu, pt], decisionStrategy: 'UNANIMOUS' });
  }
  const liens = (relation, objet) => datés.filter((f) => f.relation === relation && f.objet === objet)
    .map((f) => `lien ${id(f.sujet)} ${f.relation} ${f.objet} (jusqu'au ${f.fin.slice(0, 10)})`);

  // 5) les scopes et les ressources
  for (const s of [...new Set(Object.values(SCOPES).flat())]) await api('POST', `${E.rs}/scope`, { name: s });
  for (const o of [...batiments, ...espaces, ...machines]) {
    E.ressources[o] = (await api('POST', `${E.rs}/resource`, { name: o, scopes: SCOPES[typeDe(o)].map((name) => ({ name })) }))._id;
  }

  // 6) les permissions : quelles politiques pour chaque ressource et chaque scope
  //    (c'est ICI que notre code fait l'héritage vers les objets et l'exception)
  const regles = {};
  for (const b of batiments) {
    regles[b] = {
      voir: [`${b} · tout le bâtiment`, ...liens('architecte', b), ...liens('event_manager', b)],
      modifier_structure: [`${b} · proprietaire`, ...liens('architecte', b)],
      gerer_menages: [`${b} · proprietaire`, `${b} · building_admin`],
      gerer_evenements: [`${b} · proprietaire`, ...liens('event_manager', b)],
      deleguer: [`${b} · proprietaire`],
    };
  }
  const mesures = (e) => (occupant[e] ? [`${occupant[e]} · membres`] : [`${parent[e]} · gestion`]);
  const pilotage = (e) => (occupant[e] ? [`${occupant[e]} · master`] : [`${parent[e]} · gestion`]);
  for (const e of espaces) regles[e] = { voir_mesures: mesures(e), inviter: occupant[e] ? [`${occupant[e]} · master`] : [] };
  for (const m of machines) {
    const e = espaceDe[m];
    regles[m] = {
      voir_donnees: [...mesures(e), ...liens('technicien', m), ...(marqueDe[m] ? [`${marqueDe[m]} · fabricants`] : [])],
      piloter: [...pilotage(e), ...liens('technicien', m)],
    };
  }
  let nbPermissions = 0;
  for (const [o, parScope] of Object.entries(regles)) {
    for (const [s, noms] of Object.entries(parScope)) {
      if (!noms.length) continue; // pas de politique = refusé (mode ENFORCING)
      await api('POST', `${E.rs}/permission/scope`, {
        name: `${o} · ${s}`, resources: [E.ressources[o]], scopes: [s], policies: noms.map((n) => E.politiques[n]), decisionStrategy: 'AFFIRMATIVE',
      });
      nbPermissions++;
    }
  }
  E.regles = regles;
  E.compte = {
    groupes: Object.keys(E.groupes).length, politiques: Object.keys(E.politiques).length,
    ressources: Object.keys(E.ressources).length, permissions: nbPermissions, appels: nbAppelsConfig,
  };
  console.log(`KAS configuré : ${JSON.stringify(E.compte)}`);
}

// Les liens sans date sur bâtiment / ménage / marque = une appartenance à un groupe
function groupeDuFait(f) {
  if (f.fin || typeDe(f.sujet) !== 'utilisateur') return null;
  if (typeDe(f.objet) === 'batiment' && ROLES_EN_GROUPE.includes(f.relation)) return `${RACINE}/batiment-${id(f.objet)}/${f.relation}`;
  return null;
}

// ---------------------------------------------------------------------
// Les deux façons de demander une décision à KAS
// ---------------------------------------------------------------------
// a) Comme une vraie API : avec le jeton du compte connecté (requête « UMA », réponse oui/non)
async function decisionAvecJeton(jeton, action, objet) {
  const r = await fetch(`${K}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jeton}` },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:uma-ticket', audience: CLIENT,
      permission: `${objet}#${action}`, response_mode: 'decision',
    }),
  });
  if (r.status === 403) return false;
  const t = await r.json();
  if (!r.ok) throw new Error(`KAS ${r.status} : ${t.error_description || t.error}`);
  return t.result === true;
}
// b) Pour n'importe quel compte (banc de test) : l'outil d'évaluation de l'administration
async function decisionParEvaluation(utilisateur, action, objet) {
  const r = await api('POST', `${E.rs}/policy/evaluate`, {
    resources: [{ _id: E.ressources[objet], scopes: [{ name: action }] }],
    userId: await idUtilisateur(utilisateur), roleIds: [], context: { attributes: {} }, entitlements: false,
  });
  return (r.results?.[0]?.allowedScopes || []).some((s) => s.name === action);
}

module.exports = {
  nom: 'Keycloak KAS',
  version: 'Keycloak 26.8.1',
  explication: "Le module d'autorisation de Keycloak (aucun composant en plus). Groupes + ressources + politiques + permissions, construits depuis les faits.",
  get modele() {
    const c = E?.compte;
    return `Keycloak Authorization Services – client « ${CLIENT} » (resource server)

Groupes (Keycloak) :
  /${RACINE}/batiment-A/proprietaire | building_admin | facility_manager
  /${RACINE}/batiment-A/menages/dupont/master | invite
  /${RACINE}/marque-thermox ...

Politiques :
  « A · tout le bâtiment »  = groupe /batiment-A + tous ses sous-groupes
  « A · gestion »           = groupes proprietaire + facility_manager
  « dupont · membres »      = groupe du ménage + sous-groupes
  « lien martin architecte batiment:A » = utilisateur martin ET avant la date de fin
     (une politique de ce type PAR droit daté)

Permissions (une par ressource et par scope) :
  batiment:A · voir         <- A · tout le bâtiment, lien martin, lien eva
  espace:A1 · voir_mesures  <- dupont · membres     (logement occupé)
  espace:A2 · voir_mesures  <- A · gestion          (logement vide)
  machine:M2 · piloter      <- A · gestion, lien theo M2
  ...
  Le choix « occupé / vide » et le lien machine -> espace -> bâtiment
  sont faits par NOTRE code (moteur.js) en créant les permissions.

Créés au démarrage : ${c ? `${c.groupes} groupes, ${c.politiques} politiques, ${c.ressources} ressources, ${c.permissions} permissions, ${c.appels} appels à l'API d'administration` : '…'}`;
  },

  async demarrer(faits) {
    FAITS = faits.map((f) => ({ ...f }));
    await construire(FAITS);
  },

  async verifier(utilisateur, action, objet, maintenant, contexte = {}) {
    if (!E.ressources[objet]) return false;
    return contexte.jeton ? decisionAvecJeton(contexte.jeton, action, objet) : decisionParEvaluation(utilisateur, action, objet);
  },

  // Donner / retirer : un rôle sans date = ajouter / retirer du sous-groupe (immédiat).
  // Sinon il faut reconstruire les politiques et permissions concernées (ici : tout).
  async ajouter(fait) {
    FAITS.push({ ...fait });
    const g = groupeDuFait(fait);
    if (g) await api('PUT', `/users/${await idUtilisateur(id(fait.sujet))}/groups/${E.groupes[g]}`);
    else await construire(FAITS);
  },

  async retirer(fait) {
    FAITS = FAITS.filter((f) => !(f.sujet === fait.sujet && f.relation === fait.relation && f.objet === fait.objet));
    const g = groupeDuFait(fait);
    if (g) await api('DELETE', `/users/${await idUtilisateur(id(fait.sujet))}/groups/${E.groupes[g]}`);
    else await construire(FAITS);
  },

  async relations() {
    const lignes = [];
    for (const [chemin, gid] of Object.entries(E.groupes)) {
      const m = await api('GET', `/groups/${gid}/members?briefRepresentation=true`);
      if (m.length) lignes.push(`groupe /${chemin} : ${m.map((u) => u.username).join(', ')}`);
    }
    lignes.push('');
    for (const [o, parScope] of Object.entries(E.regles)) {
      for (const [s, noms] of Object.entries(parScope)) lignes.push(`permission ${o} · ${s} <- ${noms.length ? noms.join(' | ') : '(aucune : refusé)'}`);
    }
    return lignes;
  },
};
