// =====================================================================
//  Branchement du moteur Permify (ReBAC + attributs, inspiré de Zanzibar)
//  Tout ce qu'il faut écrire pour ce moteur est dans ce fichier.
//  On parle à Permify par son API HTTP (port 3476 dans Docker).
//  « t1 » est le locataire (tenant) créé d'office par Permify.
//
//  Comment chaque type de droit est écrit ici :
//   - rôle direct ............ relation proprietaire @utilisateur
//   - héritage ............... parent.gestion (le bâtiment au-dessus)
//   - groupe (ménage) ........ occupant.membre
//   - exception .............. ... not occupe   (occupe = attribut vrai/faux)
//   - date de fin ............ un objet « mandat » avec un attribut fin + une « rule »
//   - attribut (marque) ...... marque.fabricant
// =====================================================================
const URL_PERMIFY = process.env.PERMIFY_URL || 'http://permify:3476';
const TENANT = 't1';

// Le schéma, dans la langue de Permify (affiché sur la page ET envoyé tel quel)
const SCHEMA = `entity utilisateur {}

// Un droit daté : qui (titulaire) et jusqu'à quand (fin, en secondes)
entity mandat {
    relation titulaire @utilisateur
    attribute fin double
    permission actif = titulaire and en_cours(fin)
}

rule en_cours(fin double) {
    context.data.maintenant < fin
}

entity menage {
    relation master @utilisateur
    relation invite @utilisateur
    permission membre = master or invite
}

entity marque {
    relation fabricant @utilisateur
}

entity batiment {
    relation proprietaire @utilisateur
    relation architecte @mandat
    relation building_admin @utilisateur
    relation facility_manager @utilisateur
    relation event_manager @mandat
    relation menage @menage

    permission gestion = proprietaire or facility_manager
    permission voir = proprietaire or architecte.actif or building_admin or facility_manager or event_manager.actif or menage.membre
    permission modifier_structure = proprietaire or architecte.actif
    permission gerer_menages = proprietaire or building_admin
    permission gerer_evenements = proprietaire or event_manager.actif
    permission deleguer = proprietaire
}

entity espace {
    relation parent @batiment
    relation occupant @menage
    attribute occupe boolean

    permission voir_mesures = occupant.membre or (parent.gestion not occupe)
    permission inviter = occupant.master
    permission pilotage = occupant.master or (parent.gestion not occupe)
}

entity machine {
    relation espace @espace
    relation marque @marque
    relation technicien @mandat

    permission voir_donnees = espace.voir_mesures or technicien.actif or marque.fabricant
    permission piloter = espace.pilotage or technicien.actif
}`;

let versionSchema = '';
let dernierJeton = ''; // « snap token » : garantit qu'on lit après la dernière écriture

async function appeler(chemin, corps) {
  const r = await fetch(`${URL_PERMIFY}/v1/tenants/${TENANT}${chemin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
  const texte = await r.text();
  if (!r.ok) throw new Error(`Permify ${r.status} : ${texte}`);
  return JSON.parse(texte);
}

const ref = (texte) => { const [type, id] = texte.split(':'); return { type, id }; };
const secondes = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const valeur = (type, data) => ({ '@type': `type.googleapis.com/base.v1.${type}`, data });
// Le nom du mandat pour un fait daté, par exemple « architecte-A-martin »
const idMandat = (f) => `${f.relation}-${ref(f.objet).id}-${ref(f.sujet).id}`;

// Un fait du scénario -> des tuples et des attributs Permify
function traduire(fait) {
  const tuples = [], attributs = [];
  if (fait.fin) {
    // droit daté : objet -> mandat -> utilisateur, et l'attribut fin sur le mandat
    const m = { type: 'mandat', id: idMandat(fait) };
    tuples.push({ entity: m, relation: 'titulaire', subject: ref(fait.sujet) });
    tuples.push({ entity: ref(fait.objet), relation: fait.relation, subject: m });
    attributs.push({ entity: m, attribute: 'fin', value: valeur('DoubleValue', secondes(fait.fin)) });
  } else {
    tuples.push({ entity: ref(fait.objet), relation: fait.relation, subject: ref(fait.sujet) });
  }
  // Chaque espace dit s'il est occupé ou non (attribut vrai/faux)
  if (fait.relation === 'parent') attributs.push({ entity: ref(fait.objet), attribute: 'occupe', value: valeur('BooleanValue', false) });
  if (fait.relation === 'occupant') attributs.push({ entity: ref(fait.objet), attribute: 'occupe', value: valeur('BooleanValue', true) });
  return { tuples, attributs };
}

async function ecrire(faits) {
  const t = faits.map(traduire);
  // les attributs « occupe = vrai » passent après « occupe = faux »
  const attributs = t.flatMap((x) => x.attributs).sort((a, b) => Number(a.value.data === true) - Number(b.value.data === true));
  const vus = new Map();
  for (const a of attributs) vus.set(`${a.entity.type}:${a.entity.id}$${a.attribute}`, a);
  const r = await appeler('/data/write', {
    metadata: { schema_version: versionSchema },
    tuples: t.flatMap((x) => x.tuples),
    attributes: [...vus.values()],
  });
  dernierJeton = r.snap_token;
}

module.exports = {
  nom: 'Permify',
  version: 'v1.7.5',
  explication: 'Moteur ReBAC (relations) avec attributs, racheté par FusionAuth fin 2025. Le schéma décrit les règles, les tuples et attributs décrivent qui est lié à quoi.',
  modele: SCHEMA,

  async demarrer(faits) {
    versionSchema = (await appeler('/schemas/write', { schema: SCHEMA })).schema_version;
    await ecrire(faits);
  },

  // La question : « utilisateur:martin a-t-il la permission modifier_structure sur batiment:A, maintenant ? »
  async verifier(utilisateur, action, objet, maintenant) {
    const r = await appeler('/permissions/check', {
      metadata: { snap_token: dernierJeton, schema_version: versionSchema, depth: 20 },
      entity: ref(objet),
      permission: action,
      subject: { type: 'utilisateur', id: utilisateur },
      context: { tuples: [], attributes: [], data: { maintenant: maintenant.getTime() / 1000 } },
    });
    return r.can === 'CHECK_RESULT_ALLOWED';
  },

  async ajouter(fait) { await ecrire([fait]); },

  async retirer(fait) {
    const sujet = fait.fin ? { type: 'mandat', ids: [idMandat(fait)] } : { type: ref(fait.sujet).type, ids: [ref(fait.sujet).id] };
    const r = await appeler('/relationships/delete', {
      filter: { entity: { type: ref(fait.objet).type, ids: [ref(fait.objet).id] }, relation: fait.relation, subject: sujet },
    });
    dernierJeton = r.snap_token;
  },

  async relations() {
    const lignes = [];
    for (const type of ['batiment', 'espace', 'machine', 'menage', 'marque', 'mandat']) {
      const r = await appeler('/data/relationships/read', {
        metadata: { snap_token: dernierJeton }, filter: { entity: { type, ids: [] } }, page_size: 100,
      });
      for (const t of r.tuples || []) lignes.push(`${t.entity.type}:${t.entity.id}#${t.relation}@${t.subject.type}:${t.subject.id}`);
      const a = await appeler('/data/attributes/read', {
        metadata: { snap_token: dernierJeton }, filter: { entity: { type, ids: [] } }, page_size: 100,
      });
      for (const x of a.attributes || []) {
        const v = x.attribute === 'fin' ? new Date(x.value.data * 1000).toISOString().slice(0, 10) : x.value.data;
        lignes.push(`${x.entity.type}:${x.entity.id}$${x.attribute} = ${v}`);
      }
    }
    return lignes.sort();
  },
};
