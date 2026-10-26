// =====================================================================
//  Branchement du moteur SpiceDB (ReBAC, inspiré de Google Zanzibar)
//  Tout ce qu'il faut écrire pour ce moteur est dans ce fichier.
//  On parle à SpiceDB par sa passerelle HTTP (port 8443 dans Docker),
//  avec une clé partagée (« preshared key ») comme mot de passe.
//
//  Comment chaque type de droit est écrit ici :
//   - rôle direct ............ relation architecte: utilisateur
//   - héritage ............... parent->gestion (le bâtiment au-dessus)
//   - groupe (ménage) ........ occupant->membre
//   - exception .............. ... - occupe   (le « moins » retire)
//   - date de fin ............ utilisateur with non_expire + un « caveat »
//   - attribut (marque) ...... marque->fabricant
// =====================================================================
const URL_SPICEDB = process.env.SPICEDB_URL || 'http://spicedb:8443';
const CLE = process.env.SPICEDB_CLE || 'cle-de-demo';

// Le schéma, dans la langue de SpiceDB (affiché sur la page ET envoyé tel quel)
const SCHEMA = `caveat non_expire(maintenant timestamp, fin timestamp) {
    maintenant < fin
}

definition utilisateur {}

definition menage {
    relation master: utilisateur
    relation invite: utilisateur
    permission membre = master + invite
}

definition marque {
    relation fabricant: utilisateur
}

definition batiment {
    relation proprietaire: utilisateur
    relation architecte: utilisateur with non_expire
    relation building_admin: utilisateur
    relation facility_manager: utilisateur
    relation event_manager: utilisateur with non_expire
    relation menage: menage

    permission gestion = proprietaire + facility_manager
    permission voir = proprietaire + architecte + building_admin + facility_manager + event_manager + menage->membre
    permission modifier_structure = proprietaire + architecte
    permission gerer_menages = proprietaire + building_admin
    permission gerer_evenements = proprietaire + event_manager
    permission deleguer = proprietaire
}

definition espace {
    relation parent: batiment
    relation occupant: menage
    relation occupe: utilisateur:*

    permission voir_mesures = occupant->membre + (parent->gestion - occupe)
    permission inviter = occupant->master
    permission pilotage = occupant->master + (parent->gestion - occupe)
}

definition machine {
    relation espace: espace
    relation marque: marque
    relation technicien: utilisateur with non_expire

    permission voir_donnees = espace->voir_mesures + technicien + marque->fabricant
    permission piloter = espace->pilotage + technicien
}`;

async function appeler(chemin, corps) {
  const r = await fetch(URL_SPICEDB + chemin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLE}` },
    body: JSON.stringify(corps),
  });
  const texte = await r.text();
  if (!r.ok) throw new Error(`SpiceDB ${r.status} : ${texte}`);
  return texte;
}

const objetRef = (texte) => { const [objectType, objectId] = texte.split(':'); return { objectType, objectId }; };

// Un fait du scénario -> une ou deux « relationships » SpiceDB
function relationships(fait) {
  const r = { resource: objetRef(fait.objet), relation: fait.relation, subject: { object: objetRef(fait.sujet) } };
  if (fait.fin) r.optionalCaveat = { caveatName: 'non_expire', context: { fin: fait.fin } };
  const liste = [r];
  // Un logement qui a un ménage occupant est marqué « occupé » pour tout le monde (utilisateur:*)
  if (fait.relation === 'occupant') {
    liste.push({ resource: objetRef(fait.objet), relation: 'occupe', subject: { object: { objectType: 'utilisateur', objectId: '*' } } });
  }
  return liste;
}
// TOUCH = créer (ou garder si elle existe), DELETE = supprimer
const ecrire = (operation, liste) => appeler('/v1/relationships/write', {
  updates: liste.map((relationship) => ({ operation, relationship })),
});
// « fullyConsistent » : on veut la réponse la plus fraîche (pas de cache), utile pour la démo
const COHERENCE = { fullyConsistent: true };

module.exports = {
  nom: 'SpiceDB',
  version: 'v1.57.0',
  explication: 'Moteur ReBAC (relations) de la société AuthZed. Le schéma décrit les règles, les relationships décrivent qui est lié à quoi.',
  modele: SCHEMA,

  async demarrer(faits) {
    await appeler('/v1/schema/write', { schema: SCHEMA });
    await ecrire('OPERATION_TOUCH', faits.flatMap(relationships));
  },

  // La question : « utilisateur:martin a-t-il la permission modifier_structure sur batiment:A, maintenant ? »
  async verifier(utilisateur, action, objet, maintenant) {
    const r = JSON.parse(await appeler('/v1/permissions/check', {
      consistency: COHERENCE,
      resource: objetRef(objet),
      permission: action,
      subject: { object: { objectType: 'utilisateur', objectId: utilisateur } },
      context: { maintenant: maintenant.toISOString() },
    }));
    // HAS_PERMISSION = oui ; NO_PERMISSION = non ; CONDITIONAL = il manquait une information (traité comme non)
    return r.permissionship === 'PERMISSIONSHIP_HAS_PERMISSION';
  },

  async ajouter(fait) { await ecrire('OPERATION_TOUCH', relationships(fait)); },

  async retirer(fait) {
    await ecrire('OPERATION_DELETE', relationships(fait).map(({ optionalCaveat, ...r }) => r));
  },

  async relations() {
    const lignes = [];
    for (const type of ['batiment', 'espace', 'machine', 'menage', 'marque']) {
      // La réponse arrive « en flux » : un objet JSON par ligne
      const texte = await appeler('/v1/relationships/read', { consistency: COHERENCE, relationshipFilter: { resourceType: type } });
      for (const l of texte.split('\n').filter((x) => x.trim())) {
        const r = JSON.parse(l).result.relationship;
        const cav = r.optionalCaveat ? `[${r.optionalCaveat.caveatName} : fin = ${String(r.optionalCaveat.context.fin).slice(0, 10)}]` : '';
        lignes.push(`${r.resource.objectType}:${r.resource.objectId}#${r.relation}@${r.subject.object.objectType}:${r.subject.object.objectId}${cav ? '  ' + cav : ''}`);
      }
    }
    return lignes.sort();
  },
};
