// =====================================================================
//  Branchement de Casbin (bibliothèque, pas un serveur)
//  Tout ce qu'il faut écrire pour ce moteur est dans ce fichier.
//  Casbin tourne DANS l'API de la démo : pas de conteneur en plus.
//  Ici : la version Node.js (« node-casbin »), même logique que Casbin.NET.
//
//  Casbin sait faire nativement : des règles (lignes p) et un « matcher »
//  (une formule). Il ne sait PAS suivre seul un lien entre objets
//  (bâtiment -> espace -> machine), ni vérifier une date de fin, ni
//  réutiliser une permission dans une autre. Pour cela on lui ajoute
//  de petites fonctions JavaScript (voir FONCTIONS plus bas).
//
//  Comment chaque type de droit est écrit ici :
//   - rôle direct ............ a(r.sub, 'architecte', r.obj, r.t)
//   - héritage ............... gestion(r.sub, relie(r.obj, 'parent'), r.t)
//   - groupe (ménage) ........ membre(r.sub, relie(r.obj, 'occupant'), r.t)
//   - exception .............. ... && relie(r.obj, 'occupant') == ''
//   - date de fin ............ dans a() : la 4e colonne des lignes p2
//   - attribut (marque) ...... a(r.sub, 'fabricant', relie(r.obj, 'marque'), r.t)
// =====================================================================
const { newEnforcer, newModelFromString } = require('casbin');

// Le modèle Casbin. Chaque ligne « p » porte sa propre règle (eval).
// Les faits (qui est lié à quoi, jusqu'à quand) sont des lignes « p2 ».
const MODELE = `[request_definition]
r = sub, obj, act, t

[policy_definition]
p = typeobj, act, regle
p2 = sujet, relation, objet, fin

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = typeDe(r.obj) == p.typeobj && r.act == p.act && eval(p.regle)`;

// Les règles (lignes p) : type d'objet, action, formule
const MACHINE_ESPACE = "relie(r.obj, 'espace')";
const REGLES = [
  ['batiment', 'voir', "a(r.sub, 'proprietaire', r.obj, r.t) || a(r.sub, 'architecte', r.obj, r.t) || a(r.sub, 'building_admin', r.obj, r.t) || a(r.sub, 'facility_manager', r.obj, r.t) || a(r.sub, 'event_manager', r.obj, r.t) || membreDUnMenageDe(r.sub, r.obj, r.t)"],
  ['batiment', 'modifier_structure', "a(r.sub, 'proprietaire', r.obj, r.t) || a(r.sub, 'architecte', r.obj, r.t)"],
  ['batiment', 'gerer_menages', "a(r.sub, 'proprietaire', r.obj, r.t) || a(r.sub, 'building_admin', r.obj, r.t)"],
  ['batiment', 'gerer_evenements', "a(r.sub, 'proprietaire', r.obj, r.t) || a(r.sub, 'event_manager', r.obj, r.t)"],
  ['batiment', 'deleguer', "a(r.sub, 'proprietaire', r.obj, r.t)"],
  ['espace', 'voir_mesures', 'voirMesures(r.sub, r.obj, r.t)'],
  ['espace', 'inviter', "a(r.sub, 'master', relie(r.obj, 'occupant'), r.t)"],
  ['machine', 'voir_donnees', `voirMesures(r.sub, ${MACHINE_ESPACE}, r.t) || a(r.sub, 'technicien', r.obj, r.t) || a(r.sub, 'fabricant', relie(r.obj, 'marque'), r.t)`],
  ['machine', 'piloter', `pilotage(r.sub, ${MACHINE_ESPACE}, r.t) || a(r.sub, 'technicien', r.obj, r.t)`],
];

let moteur = null;

// ----- Les fonctions ajoutées à Casbin (lues dans ses propres lignes p2) -----
const lignesP2 = () => moteur.getModel().getPolicy('p', 'p2');
const FONCTIONS = {
  typeDe: (objet) => String(objet).split(':')[0],
  // a() : le sujet a-t-il cette relation directe avec cet objet, et le droit n'est-il pas expiré ?
  a: (sujet, relation, objet, t) => lignesP2().some(([s, r, o, fin]) =>
    s === sujet && r === relation && o === objet && (fin === '' || new Date(t) < new Date(fin))),
  // relie() : l'objet lié (le bâtiment parent d'un espace, l'espace d'une machine, etc.) ou ''
  relie: (objet, relation) => (lignesP2().find(([, r, o]) => r === relation && o === objet) || [''])[0],
  membre: (sujet, menage, t) => FONCTIONS.a(sujet, 'master', menage, t) || FONCTIONS.a(sujet, 'invite', menage, t),
  membreDUnMenageDe: (sujet, batiment, t) => lignesP2().some(([m, r, o]) => r === 'menage' && o === batiment && FONCTIONS.membre(sujet, m, t)),
  gestion: (sujet, batiment, t) => FONCTIONS.a(sujet, 'proprietaire', batiment, t) || FONCTIONS.a(sujet, 'facility_manager', batiment, t),
  // Casbin ne peut pas réutiliser une permission dans une autre : on l'écrit une fois ici
  voirMesures: (sujet, espace, t) => {
    const occupant = FONCTIONS.relie(espace, 'occupant');
    return FONCTIONS.membre(sujet, occupant, t) || (FONCTIONS.gestion(sujet, FONCTIONS.relie(espace, 'parent'), t) && occupant === '');
  },
  pilotage: (sujet, espace, t) => {
    const occupant = FONCTIONS.relie(espace, 'occupant');
    return FONCTIONS.a(sujet, 'master', occupant, t) || (FONCTIONS.gestion(sujet, FONCTIONS.relie(espace, 'parent'), t) && occupant === '');
  },
};

const ligne = (f) => [f.sujet, f.relation, f.objet, f.fin || ''];

module.exports = {
  nom: 'Casbin',
  version: 'node-casbin v5.51.1',
  explication: "Bibliothèque RBAC/ABAC, intégrée dans l'application. Le modèle décrit la formule, les lignes p les règles, les lignes p2 les faits.",
  modele: `${MODELE}\n\n# Règles (lignes p) :\n${REGLES.map((r) => `p, ${r[0]}, ${r[1]}, ${r[2]}`).join('\n')}\n\n` +
    '# + fonctions JavaScript : typeDe, a, relie, membre, membreDUnMenageDe, gestion, voirMesures, pilotage',

  async demarrer(faits) {
    moteur = await newEnforcer(newModelFromString(MODELE));
    moteur.enableAutoSave(false); // tout reste en mémoire pour la démo
    for (const [nom, fonction] of Object.entries(FONCTIONS)) await moteur.addFunction(nom, fonction);
    for (const r of REGLES) await moteur.addPolicy(...r);
    for (const f of faits) await moteur.addNamedPolicy('p2', ...ligne(f));
  },

  // La question : enforce(qui, quoi, action, quand)
  async verifier(utilisateur, action, objet, maintenant) {
    return moteur.enforce(`utilisateur:${utilisateur}`, objet, action, maintenant.toISOString());
  },

  async ajouter(fait) { await moteur.addNamedPolicy('p2', ...ligne(fait)); },
  async retirer(fait) { await moteur.removeNamedPolicy('p2', ...ligne(fait)); },

  async relations() {
    return (await moteur.getNamedPolicy('p2')).map(([s, r, o, fin]) => `p2, ${s}, ${r}, ${o}${fin ? ', ' + fin.slice(0, 10) : ''}`).sort();
  },
};
