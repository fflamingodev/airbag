// =====================================================================
//  Branchement du moteur OpenFGA (ReBAC, inspiré de Google Zanzibar)
//  Tout ce qu'il faut écrire pour ce moteur est dans ce fichier.
//  On parle à OpenFGA par son API HTTP (port 8080 dans Docker).
//
//  Comment chaque type de droit est écrit ici :
//   - rôle direct ............ define architecte: [utilisateur]
//   - héritage ............... gestion from parent (le bâtiment au-dessus)
//   - groupe (ménage) ........ membre from occupant
//   - exception .............. ... but not occupe
//   - date de fin ............ [utilisateur with non_expire] + une « condition »
//   - attribut (marque) ...... fabricant from marque
// =====================================================================
const URL_OPENFGA = process.env.OPENFGA_URL || 'http://openfga:8080';

// Le modèle, dans la langue d'OpenFGA (affiché sur la page)
const MODELE = `model
  schema 1.1

type utilisateur

type menage
  relations
    define master: [utilisateur]
    define invite: [utilisateur]
    define membre: master or invite

type marque
  relations
    define fabricant: [utilisateur]

type batiment
  relations
    define proprietaire: [utilisateur]
    define architecte: [utilisateur with non_expire]
    define building_admin: [utilisateur]
    define facility_manager: [utilisateur]
    define event_manager: [utilisateur with non_expire]
    define menage: [menage]
    define gestion: proprietaire or facility_manager
    define voir: proprietaire or architecte or building_admin or facility_manager or event_manager or membre from menage
    define modifier_structure: proprietaire or architecte
    define gerer_menages: proprietaire or building_admin
    define gerer_evenements: proprietaire or event_manager
    define deleguer: proprietaire

type espace
  relations
    define parent: [batiment]
    define occupant: [menage]
    define occupe: [utilisateur:*]
    define voir_mesures: membre from occupant or (gestion from parent but not occupe)
    define inviter: master from occupant
    define pilotage: master from occupant or (gestion from parent but not occupe)

type machine
  relations
    define espace: [espace]
    define marque: [marque]
    define technicien: [utilisateur with non_expire]
    define voir_donnees: voir_mesures from espace or technicien or fabricant from marque
    define piloter: pilotage from espace or technicien

condition non_expire(maintenant: timestamp, fin: timestamp) {
  maintenant < fin
}`;

// ----- Le même modèle au format JSON, celui que l'API attend -----
const direct = { this: {} };
const rel = (r) => ({ computedUserset: { relation: r } });
const depuis = (lien, r) => ({ tupleToUserset: { tupleset: { relation: lien }, computedUserset: { relation: r } } });
const ou = (...enfants) => ({ union: { child: enfants } });
const sauf = (base, retire) => ({ difference: { base, subtract: retire } });
const types = (...t) => ({ directly_related_user_types: t });
const U = { type: 'utilisateur' };
const U_DATE = { type: 'utilisateur', condition: 'non_expire' };

const MODELE_JSON = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'utilisateur' },
    { type: 'menage',
      relations: { master: direct, invite: direct, membre: ou(rel('master'), rel('invite')) },
      metadata: { relations: { master: types(U), invite: types(U) } } },
    { type: 'marque', relations: { fabricant: direct }, metadata: { relations: { fabricant: types(U) } } },
    { type: 'batiment',
      relations: {
        proprietaire: direct, architecte: direct, building_admin: direct, facility_manager: direct, event_manager: direct, menage: direct,
        gestion: ou(rel('proprietaire'), rel('facility_manager')),
        voir: ou(rel('proprietaire'), rel('architecte'), rel('building_admin'), rel('facility_manager'), rel('event_manager'), depuis('menage', 'membre')),
        modifier_structure: ou(rel('proprietaire'), rel('architecte')),
        gerer_menages: ou(rel('proprietaire'), rel('building_admin')),
        gerer_evenements: ou(rel('proprietaire'), rel('event_manager')),
        deleguer: rel('proprietaire'),
      },
      metadata: { relations: {
        proprietaire: types(U), architecte: types(U_DATE), building_admin: types(U), facility_manager: types(U),
        event_manager: types(U_DATE), menage: types({ type: 'menage' }),
      } } },
    { type: 'espace',
      relations: {
        parent: direct, occupant: direct, occupe: direct,
        voir_mesures: ou(depuis('occupant', 'membre'), sauf(depuis('parent', 'gestion'), rel('occupe'))),
        inviter: depuis('occupant', 'master'),
        pilotage: ou(depuis('occupant', 'master'), sauf(depuis('parent', 'gestion'), rel('occupe'))),
      },
      metadata: { relations: {
        parent: types({ type: 'batiment' }), occupant: types({ type: 'menage' }), occupe: types({ type: 'utilisateur', wildcard: {} }),
      } } },
    { type: 'machine',
      relations: {
        espace: direct, marque: direct, technicien: direct,
        voir_donnees: ou(depuis('espace', 'voir_mesures'), rel('technicien'), depuis('marque', 'fabricant')),
        piloter: ou(depuis('espace', 'pilotage'), rel('technicien')),
      },
      metadata: { relations: {
        espace: types({ type: 'espace' }), marque: types({ type: 'marque' }), technicien: types(U_DATE),
      } } },
  ],
  conditions: {
    non_expire: {
      name: 'non_expire',
      expression: 'maintenant < fin',
      parameters: { maintenant: { type_name: 'TYPE_NAME_TIMESTAMP' }, fin: { type_name: 'TYPE_NAME_TIMESTAMP' } },
    },
  },
};

let magasin = null; // « store » OpenFGA : un espace de données
let modeleId = null;

async function appeler(methode, chemin, corps) {
  const r = await fetch(URL_OPENFGA + chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json' },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const texte = await r.text();
  if (!r.ok) throw new Error(`OpenFGA ${r.status} : ${texte}`);
  return texte ? JSON.parse(texte) : {};
}

// Un fait du scénario -> un ou deux « tuples » OpenFGA
function tuples(fait) {
  const t = { user: fait.sujet, relation: fait.relation, object: fait.objet };
  if (fait.fin) t.condition = { name: 'non_expire', context: { fin: fait.fin } };
  const liste = [t];
  // Un logement qui a un ménage occupant est marqué « occupé » pour tout le monde (utilisateur:*)
  if (fait.relation === 'occupant') liste.push({ user: 'utilisateur:*', relation: 'occupe', object: fait.objet });
  return liste;
}
const sansCondition = ({ user, relation, object }) => ({ user, relation, object });

module.exports = {
  nom: 'OpenFGA',
  version: 'v1.22.0',
  explication: 'Moteur ReBAC (relations), projet de la CNCF. Le modèle décrit les règles, les tuples décrivent qui est lié à quoi.',
  modele: MODELE,

  async demarrer(faits) {
    // 1) repartir d'un magasin neuf : on supprime l'ancien s'il existe (l'app a pu redémarrer seule)
    const { stores } = await appeler('GET', '/stores');
    for (const s of (stores || []).filter((x) => x.name === 'reskin-demo')) await appeler('DELETE', `/stores/${s.id}`);
    magasin = (await appeler('POST', '/stores', { name: 'reskin-demo' })).id;
    // 2) envoyer le modèle
    modeleId = (await appeler('POST', `/stores/${magasin}/authorization-models`, MODELE_JSON)).authorization_model_id;
    // 3) écrire les faits de départ (ignorés s'ils existent déjà)
    await appeler('POST', `/stores/${magasin}/write`, {
      authorization_model_id: modeleId,
      writes: { tuple_keys: faits.flatMap(tuples), on_duplicate: 'ignore' },
    });
  },

  // La question : « utilisateur:martin a-t-il la relation modifier_structure avec batiment:A, maintenant ? »
  async verifier(utilisateur, action, objet, maintenant) {
    const r = await appeler('POST', `/stores/${magasin}/check`, {
      authorization_model_id: modeleId,
      tuple_key: { user: `utilisateur:${utilisateur}`, relation: action, object: objet },
      context: { maintenant: maintenant.toISOString() },
    });
    return r.allowed === true;
  },

  async ajouter(fait) {
    await appeler('POST', `/stores/${magasin}/write`, {
      authorization_model_id: modeleId, writes: { tuple_keys: tuples(fait), on_duplicate: 'ignore' },
    });
  },

  async retirer(fait) {
    await appeler('POST', `/stores/${magasin}/write`, {
      authorization_model_id: modeleId, deletes: { tuple_keys: tuples(fait).map(sansCondition), on_missing: 'ignore' },
    });
  },

  async relations() {
    const lignes = [];
    let jeton = '';
    do {
      const r = await appeler('POST', `/stores/${magasin}/read`, { page_size: 100, continuation_token: jeton || undefined });
      for (const { key } of r.tuples || []) {
        const cond = key.condition ? `  [${key.condition.name} : fin = ${key.condition.context.fin.slice(0, 10)}]` : '';
        lignes.push(`${key.object}#${key.relation}@${key.user}${cond}`);
      }
      jeton = r.continuation_token;
    } while (jeton);
    return lignes.sort();
  },
};
