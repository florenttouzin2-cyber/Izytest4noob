// ============================================================
// RÉGLAGES — c’est le seul fichier à modifier pour brancher n8n.
// ============================================================
window.CONFIG = {
  // true  = mode démonstration (fausses données, sans n8n ni Airtable)
  // false = connexion réelle à n8n
  MODE_DEMO: false,

  // Adresses (URL de Webhook) de vos deux workflows n8n :
  URL_N8N_ANALYSE: 'https://n8n.jedha.co/webhook/izytest-analyse',  // workflow « analyse IA »
  URL_N8N_DONNEES: 'https://n8n.jedha.co/webhook/izytest-donnees',  // workflow « données Airtable »

  // Taille maximale d’un fichier TXT importé (en Ko)
  TAILLE_MAX_TXT_KO: 200
};
