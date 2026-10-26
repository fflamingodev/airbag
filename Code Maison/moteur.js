// =====================================================================
//  « Code maison » : pas de moteur, une table SQL et notre propre code
//  Tout ce qu'il faut écrire est dans ce fichier.
//  Pour la démo : une petite base SQLite en mémoire, fournie avec Node.js.
//  Dans la vraie plateforme : cette table serait dans la base existante.
//
//  Chaque règle est une fonction JavaScript écrite à la main.
//  Simple à lire au début, mais chaque nouvelle règle = du code à écrire,
//  à tester et à maintenir ; pas d'outil d'audit ni d'historique fourni.
// =====================================================================
const { DatabaseSync } = require('node:sqlite');

const TABLE = `CREATE TABLE liens (
  sujet    TEXT NOT NULL,   -- utilisateur:martin, menage:dupont, batiment:A...
  relation TEXT NOT NULL,   -- architecte, parent, occupant, master...
  objet    TEXT NOT NULL,   -- batiment:A, espace:A1, machine:M1...
  fin      TEXT,            -- date de fin du droit (vide = sans fin)
  PRIMARY KEY (sujet, relation, objet)
);`;

let base = null;

// ----- Deux petites requêtes réutilisées partout -----
// a() : le sujet a-t-il cette relation directe avec cet objet, et le droit n'est-il pas expiré ?
function a(sujet, relation, objet, maintenant) {
  return base.prepare(`SELECT 1 FROM liens WHERE sujet = ? AND relation = ? AND objet = ?
    AND (fin IS NULL OR fin > ?) LIMIT 1`).get(sujet, relation, objet, maintenant) !== undefined;
}
// relie() : l'objet lié (le bâtiment parent d'un espace, l'espace d'une machine...) ou null
function relie(objet, relation) {
  return base.prepare('SELECT sujet FROM liens WHERE objet = ? AND relation = ? LIMIT 1').get(objet, relation)?.sujet ?? null;
}

// ----- Les règles, écrites en code -----
const membre = (u, menage, t) => a(u, 'master', menage, t) || a(u, 'invite', menage, t);
const gestion = (u, bat, t) => a(u, 'proprietaire', bat, t) || a(u, 'facility_manager', bat, t);
function voirMesures(u, espace, t) {
  const occupant = relie(espace, 'occupant');
  return (occupant && membre(u, occupant, t)) || (!occupant && gestion(u, relie(espace, 'parent'), t));
}
function pilotage(u, espace, t) {
  const occupant = relie(espace, 'occupant');
  return (occupant && a(u, 'master', occupant, t)) || (!occupant && gestion(u, relie(espace, 'parent'), t));
}
const REGLES = {
  batiment: {
    voir: (u, o, t) => ['proprietaire', 'architecte', 'building_admin', 'facility_manager', 'event_manager'].some((r) => a(u, r, o, t))
      || base.prepare("SELECT sujet FROM liens WHERE relation = 'menage' AND objet = ?").all(o).some((m) => membre(u, m.sujet, t)),
    modifier_structure: (u, o, t) => a(u, 'proprietaire', o, t) || a(u, 'architecte', o, t),
    gerer_menages: (u, o, t) => a(u, 'proprietaire', o, t) || a(u, 'building_admin', o, t),
    gerer_evenements: (u, o, t) => a(u, 'proprietaire', o, t) || a(u, 'event_manager', o, t),
    deleguer: (u, o, t) => a(u, 'proprietaire', o, t),
  },
  espace: {
    voir_mesures: voirMesures,
    inviter: (u, o, t) => { const m = relie(o, 'occupant'); return !!m && a(u, 'master', m, t); },
  },
  machine: {
    voir_donnees: (u, o, t) => voirMesures(u, relie(o, 'espace'), t) || a(u, 'technicien', o, t) || a(u, 'fabricant', relie(o, 'marque'), t),
    piloter: (u, o, t) => pilotage(u, relie(o, 'espace'), t) || a(u, 'technicien', o, t),
  },
};

module.exports = {
  nom: 'Code maison',
  version: 'SQL + JavaScript',
  explication: "Pas de moteur : une table SQL et des fonctions écrites par nous. Simple au début, mais chaque règle, l'audit et l'historique sont à coder soi-même.",
  modele: `${TABLE}\n\n-- Les règles sont des fonctions JavaScript (voir moteur.js),\n-- construites sur deux requêtes :\n` +
    '--   a(sujet, relation, objet, maintenant)\n--     SELECT 1 FROM liens WHERE sujet = ? AND relation = ? AND objet = ?\n--     AND (fin IS NULL OR fin > maintenant)\n' +
    "--   relie(objet, relation)\n--     SELECT sujet FROM liens WHERE objet = ? AND relation = ?\n\n" +
    '-- Exemple : piloter une machine =\n--   (Master du ménage occupant OU gestion du bâtiment si logement vide)\n--   OU technicien non expiré',

  async demarrer(faits) {
    base = new DatabaseSync(':memory:');
    base.exec(TABLE);
    for (const f of faits) this.ajouter(f);
  },

  async verifier(utilisateur, action, objet, maintenant) {
    const regle = REGLES[objet.split(':')[0]]?.[action];
    return regle ? !!regle(`utilisateur:${utilisateur}`, objet, maintenant.toISOString()) : false; // pas de règle = refus
  },

  async ajouter(f) {
    base.prepare('INSERT OR IGNORE INTO liens VALUES (?, ?, ?, ?)').run(f.sujet, f.relation, f.objet, f.fin ?? null);
  },

  async retirer(f) {
    base.prepare('DELETE FROM liens WHERE sujet = ? AND relation = ? AND objet = ?').run(f.sujet, f.relation, f.objet);
  },

  async relations() {
    return base.prepare('SELECT * FROM liens ORDER BY objet, relation').all()
      .map((l) => `${l.sujet} | ${l.relation} | ${l.objet}${l.fin ? ' | fin ' + l.fin.slice(0, 10) : ''}`);
  },
};
