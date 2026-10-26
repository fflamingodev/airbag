// =====================================================================
//  Le scénario commun aux 5 moteurs : les mêmes comptes, les mêmes faits,
//  les mêmes questions et les mêmes réponses attendues.
//  Chaque moteur.js traduit ces faits dans sa propre langue.
// =====================================================================

// ---------- Le bâtiment de test ----------
//  Bâtiment A (propriétaire : olivier)
//   ├── espace A-communs (parties communes) ── machine M2 (marque AirPlus)
//   ├── espace A1 (logement occupé par le ménage Dupont) ── machine M1 (marque ThermoX)
//   └── espace A2 (logement vide)
//  Bâtiment B (pas de propriétaire dans la démo)
//   └── espace B1 (logement occupé par le ménage Delille, dont olivier est le Master)
//  => olivier est PROPRIÉTAIRE du bâtiment A et LOCATAIRE dans le bâtiment B

const JOUR = 24 * 3600 * 1000;
// Les dates sont calculées au démarrage : « actif » = finit dans 90 jours, « termine » = fini il y a 7 jours
const ACTIF = new Date(Date.now() + 90 * JOUR).toISOString();
const TERMINE = new Date(Date.now() - 7 * JOUR).toISOString();

// ---------- Les faits (qui est lié à quoi) ----------
// sujet  relation  objet  [fin = date de fin du droit]
const FAITS = [
  // Les rôles donnés sur le bâtiment
  { sujet: 'utilisateur:olivier', relation: 'proprietaire', objet: 'batiment:A' },
  { sujet: 'utilisateur:martin', relation: 'architecte', objet: 'batiment:A', fin: ACTIF },
  { sujet: 'utilisateur:bea', relation: 'building_admin', objet: 'batiment:A' },
  { sujet: 'utilisateur:fanny', relation: 'facility_manager', objet: 'batiment:A' },
  { sujet: 'utilisateur:eva', relation: 'event_manager', objet: 'batiment:A', fin: ACTIF },
  // La structure : espaces dans le bâtiment, machines dans les espaces
  { sujet: 'batiment:A', relation: 'parent', objet: 'espace:A-communs' },
  { sujet: 'batiment:A', relation: 'parent', objet: 'espace:A1' },
  { sujet: 'batiment:A', relation: 'parent', objet: 'espace:A2' },
  { sujet: 'espace:A1', relation: 'espace', objet: 'machine:M1' },
  { sujet: 'espace:A-communs', relation: 'espace', objet: 'machine:M2' },
  // Le ménage Dupont : rattaché au bâtiment, occupe le logement A1
  { sujet: 'menage:dupont', relation: 'menage', objet: 'batiment:A' },
  { sujet: 'menage:dupont', relation: 'occupant', objet: 'espace:A1' },
  { sujet: 'utilisateur:sophie', relation: 'master', objet: 'menage:dupont' },
  { sujet: 'utilisateur:lucas', relation: 'invite', objet: 'menage:dupont' },
  // Les marques des machines et le fabricant
  { sujet: 'marque:thermox', relation: 'marque', objet: 'machine:M1' },
  { sujet: 'marque:airplus', relation: 'marque', objet: 'machine:M2' },
  { sujet: 'utilisateur:fabien', relation: 'fabricant', objet: 'marque:thermox' },
  // olivier est aussi locataire : Master du ménage Delille, qui occupe le logement B1 du bâtiment B
  { sujet: 'batiment:B', relation: 'parent', objet: 'espace:B1' },
  { sujet: 'menage:delille', relation: 'menage', objet: 'batiment:B' },
  { sujet: 'menage:delille', relation: 'occupant', objet: 'espace:B1' },
  { sujet: 'utilisateur:olivier', relation: 'master', objet: 'menage:delille' },
  // Le technicien : une intervention en cours (M2), une terminée (M1)
  { sujet: 'utilisateur:theo', relation: 'technicien', objet: 'machine:M2', fin: ACTIF },
  { sujet: 'utilisateur:theo', relation: 'technicien', objet: 'machine:M1', fin: TERMINE },
];

// ---------- Les règles, en français (chaque moteur les écrit dans sa langue) ----------
const REGLES = [
  'Bâtiment – voir : propriétaire, architecte, building administrator, facility manager, event manager, membres des ménages rattachés',
  'Bâtiment – modifier la structure : propriétaire, architecte',
  'Bâtiment – gérer les ménages : propriétaire, building administrator',
  'Bâtiment – gérer les événements : propriétaire, event manager',
  'Bâtiment – déléguer : propriétaire',
  "Espace – voir les mesures : membres du ménage occupant ; propriétaire et facility manager du bâtiment SAUF si le logement est occupé",
  'Espace – inviter : le Master du ménage occupant',
  "Machine – voir les données : ceux qui voient les mesures de l'espace ; technicien en intervention ; fabricant de la marque",
  "Machine – piloter : Master du ménage occupant ; propriétaire et facility manager SAUF logement occupé ; technicien en intervention",
  "Architecte, event manager, technicien : le droit s'arrête à la date de fin",
];

// ---------- Les questions posées pour chaque compte ----------
const CAS = [
  { id: 'c1', objet: 'batiment:A', action: 'voir' },
  { id: 'c2', objet: 'batiment:A', action: 'modifier_structure' },
  { id: 'c3', objet: 'batiment:A', action: 'gerer_menages' },
  { id: 'c4', objet: 'batiment:A', action: 'gerer_evenements' },
  { id: 'c5', objet: 'batiment:A', action: 'deleguer' },
  { id: 'c6', objet: 'batiment:B', action: 'voir' },
  { id: 'c7', objet: 'espace:A-communs', action: 'voir_mesures' },
  { id: 'c8', objet: 'espace:A1', action: 'voir_mesures' },
  { id: 'c9', objet: 'espace:A2', action: 'voir_mesures' },
  { id: 'c10', objet: 'espace:A1', action: 'inviter' },
  { id: 'c11', objet: 'machine:M1', action: 'voir_donnees' },
  { id: 'c12', objet: 'machine:M1', action: 'piloter' },
  { id: 'c13', objet: 'machine:M2', action: 'voir_donnees' },
  { id: 'c14', objet: 'machine:M2', action: 'piloter' },
  { id: 'c15', objet: 'batiment:B', action: 'modifier_structure' },
  { id: 'c16', objet: 'espace:B1', action: 'voir_mesures' },
  { id: 'c17', objet: 'espace:B1', action: 'inviter' },
];
const LIBELLES = {
  'batiment:A': 'Bâtiment A', 'batiment:B': 'Bâtiment B', 'espace:A-communs': 'Parties communes A',
  'espace:A1': 'Logement A1 (occupé)', 'espace:A2': 'Logement A2 (vide)',
  'espace:B1': 'Logement B1 (occupé, olivier)', 'machine:M1': 'Machine M1 (ThermoX, dans A1)', 'machine:M2': 'Machine M2 (AirPlus, communs)',
};

// ---------- Les comptes : rôle Keycloak, ce qu'ils illustrent, réponses attendues ----------
const COMPTES = [
  { nom: 'olivier', roleKeycloak: 'proprietaire, locataire', type: 'Propriétaire du bâtiment A (sauf l’intérieur d’un logement occupé) ET locataire dans le bâtiment B (Master de son ménage)',
    autorise: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c9', 'c13', 'c14', 'c16', 'c17'] },
  { nom: 'martin', roleKeycloak: 'architecte', type: 'Architecte : rôle direct sur le bâtiment, mission datée', autorise: ['c1', 'c2'] },
  { nom: 'bea', roleKeycloak: 'building-administrator', type: 'Building administrator : rôle direct (rattache les ménages)', autorise: ['c1', 'c3'] },
  { nom: 'fanny', roleKeycloak: 'facility-manager', type: 'Facility manager : hérite sur les espaces et machines, sauf logement occupé ; révocable',
    autorise: ['c1', 'c7', 'c9', 'c13', 'c14'] },
  { nom: 'eva', roleKeycloak: 'event-manager', type: 'Event manager : délégation datée', autorise: ['c1', 'c4'] },
  { nom: 'theo', roleKeycloak: 'technicien', type: 'Technicien : ses machines seulement, pendant l’intervention (M2 en cours, M1 terminée)', autorise: ['c13', 'c14'] },
  { nom: 'sophie', roleKeycloak: 'locataire', type: 'Locataire, Master du ménage : droits via le groupe « ménage », peut inviter',
    autorise: ['c1', 'c8', 'c10', 'c11', 'c12'] },
  { nom: 'lucas', roleKeycloak: 'locataire', type: 'Invité du ménage : voit, mais ne pilote pas et n’invite pas', autorise: ['c1', 'c8', 'c11'] },
  { nom: 'fabien', roleKeycloak: 'fabricant', type: 'Fabricant ThermoX : données des machines de sa marque uniquement', autorise: ['c11'] },
  { nom: 'admin', roleKeycloak: 'admin-plateforme', type: 'Admin plateforme : a un rôle Keycloak, mais aucun droit dans les bâtiments', autorise: [] },
  { nom: 'paul', roleKeycloak: null, type: 'Aucun rôle dans l’app : refusé par Keycloak (niveau 1)', autorise: [] },
];

// La délégation de démo : le propriétaire retire (ou rend) le rôle de facility manager à fanny
const DELEGATION = { sujet: 'utilisateur:fanny', relation: 'facility_manager', objet: 'batiment:A' };

// Réponse attendue, en tenant compte de la délégation retirée ou non
function attendu(nomCompte, idCas, fannyRetiree) {
  if (nomCompte === 'fanny' && fannyRetiree) return false;
  const c = COMPTES.find((x) => x.nom === nomCompte);
  return c ? c.autorise.includes(idCas) : false;
}

module.exports = { FAITS, REGLES, CAS, LIBELLES, COMPTES, DELEGATION, attendu, ACTIF, TERMINE };
