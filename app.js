// ============================================================
// Izytest4noob — fonctionnement de l’application (étapes A et B)
// Le code est organisé en 6 parties numérotées.
// ============================================================

// ---------- 1. Outils et noms des champs Airtable ----------
const C = window.CONFIG;
const $ = (sel) => document.querySelector(sel);
// esc() rend un texte « sûr » avant de l’afficher dans la page
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Ces noms doivent être IDENTIQUES à ceux de vos tables Airtable.
const LIEN_PROJET = "Identifiant du projet associé";
const LIEN_FONCTION = "Identifiant de la fonctionnalité";
const VALIDATION = "Statut de validation";
const ORIGINE = "Origine de la proposition";
const IA = "Générée par l'IA";
const EN_ATTENTE = "En attente";

let projetCourant = JSON.parse(localStorage.getItem('projetCourant') || 'null'); // {id, nom}
let modeSaisie = 'Texte collé';
let nomFichier = '';
let enEdition = null; // identifiant de la proposition en cours de modification

function afficher(texte, type = 'ok') {
  const m = $('#message');
  m.textContent = texte;
  m.className = 'message ' + type;
  m.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- 2. Communication avec n8n (ou mode démonstration) ----------
// Le front envoie à n8n : { action, table, id, champs }
//   action « lister »    -> n8n répond { enregistrements: [ { id, champs: {...} } ] }
//   action « creer »     -> n8n répond { id, champs }
//   action « modifier » / « supprimer » -> n8n répond { ok: true }
//   action « televerser » (capture d’écran) -> { table, id, champ, nomFichier, typeMime, base64 } ; n8n l’envoie à Airtable
async function donnees(action, params) {
  if (C.MODE_DEMO) return demo(action, params);
  if (!C.URL_N8N_DONNEES) throw new Error('L’adresse n8n « données » n’est pas renseignée dans config.js.');
  const r = await fetch(C.URL_N8N_DONNEES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params })
  });
  if (!r.ok) throw new Error('n8n a répondu par une erreur (code ' + r.status + ').');
  return r.json();
}

// Mode démonstration : une petite « fausse base » gardée dans le navigateur
function demo(action, p) {
  const vide = { Projets: [], Documents: [], 'Fonctionnalités': [], Tests: [] };
  const base = JSON.parse(localStorage.getItem('demoBase') || JSON.stringify(vide));
  let res = { ok: true };
  if (action === 'lister') res = { enregistrements: base[p.table] };
  if (action === 'creer') {
    res = { id: 'rec' + Date.now() + Math.floor(Math.random() * 1000), champs: p.champs };
    base[p.table].push(res);
  }
  if (action === 'modifier') Object.assign(base[p.table].find((e) => e.id === p.id).champs, p.champs);
  if (action === 'supprimer') base[p.table] = base[p.table].filter((e) => e.id !== p.id);
  localStorage.setItem('demoBase', JSON.stringify(base));
  return Promise.resolve(res);
}

// Analyse IA : on envoie le texte, n8n répond avec ce format :
// { statut: 'ok', fonctionnalites: [ { titre, description, exigenceSource, priorite, aVerifier,
//     tests: [ { titre, scenario, etapes, resultatAttendu } ] } ] }
// En cas de problème : { statut: 'erreur', message: '...' }
async function appelerAnalyse(texte) {
  if (C.MODE_DEMO) {
    await pause(1200);
    return { statut: 'ok', fonctionnalites: [
      { titre: 'Création d’un projet', description: 'L’utilisateur peut créer un projet avec un nom et une description.', exigenceSource: 'Je veux créer un projet afin de centraliser mes tests.', priorite: 'Haute', aVerifier: false,
        tests: [{ titre: 'Créer un projet avec un nom valide', scenario: 'Cas nominal', etapes: '1. Ouvrir la page Projets\n2. Saisir un nom\n3. Cliquer sur Enregistrer', resultatAttendu: 'Le projet apparaît dans la liste.' },
                { titre: 'Créer un projet sans nom', scenario: 'Erreur de saisie', etapes: '1. Laisser le nom vide\n2. Cliquer sur Enregistrer', resultatAttendu: 'Un message demande de saisir un nom.' }] },
      { titre: 'Import d’une capture d’écran', description: 'Une image peut être associée à un test.', exigenceSource: 'Passage peu précis sur les formats acceptés.', priorite: 'Moyenne', aVerifier: true,
        tests: [{ titre: 'Importer une image PNG', scenario: 'Cas nominal', etapes: '1. Ouvrir un test\n2. Choisir une image PNG', resultatAttendu: 'L’image s’affiche dans le test.' }] }
    ] };
  }
  if (!C.URL_N8N_ANALYSE) throw new Error('L’adresse n8n « analyse IA » n’est pas renseignée dans config.js.');
  const r = await fetch(C.URL_N8N_ANALYSE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projetId: projetCourant.id, nomProjet: projetCourant.nom, texte })
  });
  if (!r.ok) throw new Error('n8n a répondu par une erreur (code ' + r.status + ').');
  const rep = await r.json();
  if (rep.statut !== 'ok') throw new Error(rep.message || 'Réponse inattendue de l’analyse.');
  return rep;
}

// ---------- 3. Navigation ----------
function aller(vue) {
  document.querySelectorAll('.vue').forEach((v) => (v.hidden = v.id !== 'vue-' + vue));
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('actif', b.dataset.vue === vue));
  $('#message').hidden = true;
  if (vue === 'projets') afficherProjets();
  if (vue === 'cahier') ouvrirCahier();
  if (vue === 'tableau') afficherTableau();
  if (vue === 'fonctionnalites') afficherFonctionnalites();
  if (vue === 'tests') afficherTests();
}
$('#nav').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (b) aller(b.dataset.vue);
});

function majProjetCourant() {
  $('#projet-courant').textContent = projetCourant ? 'Projet ouvert : ' + projetCourant.nom : 'Aucun projet ouvert';
}

// ---------- 4. Page Projets ----------
async function afficherProjets() {
  try {
    const liste = (await donnees('lister', { table: 'Projets' })).enregistrements;
    $('#liste-projets').innerHTML = liste.length ? liste.map((p) => `
      <div class="carte">
        <h2>${esc(p.champs['Nom du projet'])} <span class="badge">${esc(p.champs['Statut général'])}</span></h2>
        <p>${esc(p.champs['Description'])}</p>
        <p class="discret">${esc(p.champs["URL de l'application à tester"])}</p>
        <div class="ligne">
          <button class="bouton petit" data-act="ouvrir" data-id="${esc(p.id)}">Ouvrir ce projet</button>
          <button class="bouton secondaire petit" data-act="modifier" data-id="${esc(p.id)}">Modifier</button>
        </div>
      </div>`).join('') : '<p class="vide">Aucun projet pour le moment. Créez votre premier projet ci-dessus.</p>';
    $('#liste-projets').projets = liste;
  } catch (e) { afficher(e.message, 'erreur'); }
}

$('#liste-projets').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const p = $('#liste-projets').projets.find((x) => x.id === b.dataset.id);
  if (b.dataset.act === 'ouvrir') {
    projetCourant = { id: p.id, nom: p.champs['Nom du projet'] };
    localStorage.setItem('projetCourant', JSON.stringify(projetCourant));
    majProjetCourant();
    aller('cahier');
  } else { // modifier : on remplit le formulaire avec les valeurs du projet
    $('#p-id').value = p.id;
    $('#p-nom').value = p.champs['Nom du projet'] || '';
    $('#p-desc').value = p.champs['Description'] || '';
    $('#p-url').value = p.champs["URL de l'application à tester"] || '';
    $('#p-statut').value = p.champs['Statut général'] || 'À démarrer';
    $('#titre-form-projet').textContent = 'Modifier le projet';
    $('#p-annuler').hidden = false;
    $('#p-supprimer').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

function reinitialiserFormProjet() {
  $('#form-projet').reset();
  $('#p-id').value = '';
  $('#titre-form-projet').textContent = 'Nouveau projet';
  $('#p-annuler').hidden = true;
  $('#p-supprimer').hidden = true;
}
$('#p-annuler').addEventListener('click', reinitialiserFormProjet);

$('#form-projet').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const champs = {
    'Nom du projet': $('#p-nom').value.trim(),
    'Description': $('#p-desc').value.trim(),
    "URL de l'application à tester": $('#p-url').value.trim(),
    'Statut général': $('#p-statut').value
  };
  try {
    if ($('#p-id').value) await donnees('modifier', { table: 'Projets', id: $('#p-id').value, champs });
    else await donnees('creer', { table: 'Projets', champs: { ...champs, 'Date de création': aujourdhui() } });
    reinitialiserFormProjet();
    afficher('Le projet est enregistré.');
    await afficherProjets();
  } catch (e) { afficher('Le projet n’a pas pu être enregistré : ' + e.message, 'erreur'); }
});

$('#p-supprimer').addEventListener('click', async () => {
  const id = $('#p-id').value;
  if (!id) return afficher('Sélectionnez un projet à supprimer.', 'erreur');
  if (!confirm('Voulez-vous vraiment supprimer définitivement le projet « ' + $('#p-nom').value + ' », toutes ses fonctionnalités et tous les tests associés ? Cette action est irréversible.')) return;

  const btn = $('#p-supprimer');
  btn.disabled = true;
  try {
    const fonctionnalites = (await donnees('lister', { table: 'Fonctionnalités' })).enregistrements
      .filter((f) => (f.champs[LIEN_PROJET] || []).includes(id));
    const idsFonctionnalites = fonctionnalites.map((f) => f.id);
    const tests = (await donnees('lister', { table: 'Tests' })).enregistrements
      .filter((t) => (t.champs[LIEN_FONCTION] || []).some((idFonctionnalite) => idsFonctionnalites.includes(idFonctionnalite)));

    for (const t of tests) await donnees('supprimer', { table: 'Tests', id: t.id });
    for (const f of fonctionnalites) await donnees('supprimer', { table: 'Fonctionnalités', id: f.id });
    await donnees('supprimer', { table: 'Projets', id });

    if (projetCourant && projetCourant.id === id) {
      projetCourant = null;
      localStorage.removeItem('projetCourant');
      majProjetCourant();
    }
    reinitialiserFormProjet();
    await afficherProjets();
    afficher('Le projet, ses fonctionnalités et ses tests ont été supprimés définitivement.');
  } catch (e) {
    afficher('La suppression du projet et de ses données associées a échoué : ' + e.message, 'erreur');
  } finally {
    btn.disabled = false;
  }
});

// ---------- 5. Page Cahier des charges ----------
async function ouvrirCahier() {
  $('#cahier-aucun-projet').hidden = !!projetCourant;
  $('#cahier-contenu').hidden = !projetCourant;
  if (!projetCourant) return;
  try { // on remet le dernier texte enregistré pour ce projet
    const docs = (await donnees('lister', { table: 'Documents' })).enregistrements
      .filter((d) => (d.champs[LIEN_PROJET] || []).includes(projetCourant.id));
    const dernier = docs[docs.length - 1];
    $('#texte-cdc').value = dernier ? dernier.champs['Texte source du cahier des charges'] || '' : '';
    nomFichier = dernier ? dernier.champs['Nom du fichier TXT'] || '' : '';
    $('#nom-fichier').textContent = nomFichier;
    await afficherPropositions();
  } catch (e) { afficher(e.message, 'erreur'); }
}

$('#texte-cdc').addEventListener('input', () => { modeSaisie = 'Texte collé'; nomFichier = ''; $('#nom-fichier').textContent = ''; });

$('#btn-passer-etape').addEventListener('click', () => aller('fonctionnalites'));

$('#fichier-txt').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  if (!f.name.toLowerCase().endsWith('.txt')) return afficher('Seuls les fichiers TXT sont acceptés. Pour un PDF ou un DOCX, copiez le texte puis collez-le dans le champ.', 'erreur');
  if (f.size > C.TAILLE_MAX_TXT_KO * 1024) return afficher('Ce fichier dépasse ' + C.TAILLE_MAX_TXT_KO + ' Ko. Raccourcissez-le ou collez seulement la partie utile.', 'erreur');
  const texte = await f.text();
  if (!texte.trim()) return afficher('Ce fichier est vide.', 'erreur');
  $('#texte-cdc').value = texte;
  modeSaisie = 'Fichier TXT'; nomFichier = f.name;
  $('#nom-fichier').textContent = f.name;
  $('#message').hidden = true;
});

// Enregistre le texte, lance l'analyse, puis enregistre les propositions « En attente »
$('#btn-analyser').addEventListener('click', async () => {
  const texte = $('#texte-cdc').value.trim();
  if (!texte) return afficher('Le champ est vide : collez un texte ou importez un fichier TXT.', 'erreur');
  const btn = $('#btn-analyser');
  btn.disabled = true; btn.textContent = 'Analyse en cours…';
  $('#message').hidden = true;
  let doc;
  try {
    doc = await donnees('creer', { table: 'Documents', champs: {
      [LIEN_PROJET]: [projetCourant.id], 'Nom du fichier TXT': nomFichier, "Mode d'entrée": modeSaisie,
      'Texte source du cahier des charges': texte, "Statut de l'analyse": 'En cours', "Date de saisie ou d'importation": aujourdhui() } });
    const rep = await appelerAnalyse(texte);
    await effacerAnciennesPropositions(); // évite les doublons si on relance l'analyse
    for (const f of rep.fonctionnalites) {
      const champs = { [LIEN_PROJET]: [projetCourant.id], 'Titre de la fonctionnalité': f.titre,
        'Description': (f.aVerifier ? '[À vérifier] ' : '') + (f.description || ''),
        'Exigence source': f.exigenceSource || '', [VALIDATION]: EN_ATTENTE, [ORIGINE]: IA };
      if (['Haute', 'Moyenne', 'Basse'].includes(f.priorite)) champs['Priorité'] = f.priorite;
      const nf = await donnees('creer', { table: 'Fonctionnalités', champs });
      for (const t of f.tests || []) {
        await donnees('creer', { table: 'Tests', champs: { [LIEN_FONCTION]: [nf.id], 'Titre du test': t.titre,
          'Scénario de test': t.scenario || '', 'Étapes à effectuer': t.etapes || '', 'Résultat attendu': t.resultatAttendu || '',
          Statut: 'À tester', [VALIDATION]: EN_ATTENTE, [ORIGINE]: IA } });
      }
    }
    await donnees('modifier', { table: 'Documents', id: doc.id, champs: { "Statut de l'analyse": 'Terminée' } });
    afficher('Analyse terminée : vérifiez les propositions ci-dessous avant de les accepter.');
  } catch (e) {
    if (doc) await donnees('modifier', { table: 'Documents', id: doc.id, champs: { "Statut de l'analyse": 'Échec' } }).catch(() => {});
    afficher('L’analyse a échoué : ' + e.message + ' Vous pouvez relancer l’analyse.', 'erreur');
  } finally {
    btn.disabled = false; btn.textContent = 'Analyser avec l’IA';
    await afficherPropositions();
  }
});

// ---------- 6. Propositions de l’IA : vérifier, modifier, accepter, supprimer ----------
async function propositionsEnAttente() {
  const feat = (await donnees('lister', { table: 'Fonctionnalités' })).enregistrements
    .filter((e) => (e.champs[LIEN_PROJET] || []).includes(projetCourant.id));
  const ids = feat.map((e) => e.id);
  const tests = (await donnees('lister', { table: 'Tests' })).enregistrements
    .filter((e) => (e.champs[LIEN_FONCTION] || []).some((i) => ids.includes(i)));
  return { feat, tests };
}
const enAttente = (e) => e.champs[VALIDATION] === EN_ATTENTE && e.champs[ORIGINE] === IA;

async function effacerAnciennesPropositions() {
  const { feat, tests } = await propositionsEnAttente();
  for (const t of tests.filter(enAttente)) await donnees('supprimer', { table: 'Tests', id: t.id });
  for (const f of feat.filter(enAttente)) await donnees('supprimer', { table: 'Fonctionnalités', id: f.id });
}

// Un champ modifiable (le nom Airtable est gardé dans data-champ)
const saisie = (label, champ, val, zone) => `<label>${label}` + (zone
  ? `<textarea rows="3" data-champ="${esc(champ)}">${esc(val)}</textarea>`
  : `<input data-champ="${esc(champ)}" value="${esc(val)}">`) + '</label>';

function boutons(table, id) {
  return enEdition === id
    ? `<div class="ligne"><button class="bouton petit" data-act="enregistrer" data-table="${table}" data-id="${esc(id)}">Enregistrer</button>
       <button class="bouton secondaire petit" data-act="annuler">Annuler</button></div>`
    : `<div class="ligne"><button class="bouton valider petit" data-act="accepter" data-table="${table}" data-id="${esc(id)}">Accepter</button>
       <button class="bouton secondaire petit" data-act="modifier" data-table="${table}" data-id="${esc(id)}">Modifier</button>
       <button class="bouton danger petit" data-act="supprimer" data-table="${table}" data-id="${esc(id)}">Supprimer</button></div>`;
}

function blocFonctionnalite(f) {
  const c = f.champs, verif = (c['Description'] || '').startsWith('[À vérifier]');
  const corps = enEdition === f.id
    ? saisie('Titre', 'Titre de la fonctionnalité', c['Titre de la fonctionnalité']) + saisie('Description', 'Description', c['Description'], true)
    : `<h2>${esc(c['Titre de la fonctionnalité'])} <span class="badge">Priorité : ${esc(c['Priorité'] || 'non précisée')}</span>
       ${verif ? '<span class="badge verif">À vérifier</span>' : ''}</h2>
       <p>${esc(c['Description'])}</p><p class="discret">Passage du cahier des charges : ${esc(c['Exigence source'])}</p>`;
  return `<div class="bloc">${corps}${boutons('Fonctionnalités', f.id)}</div>`;
}

function blocTest(t) {
  const c = t.champs;
  const corps = enEdition === t.id
    ? saisie('Titre du test', 'Titre du test', c['Titre du test']) + saisie('Étapes à effectuer', 'Étapes à effectuer', c['Étapes à effectuer'], true)
      + saisie('Résultat attendu', 'Résultat attendu', c['Résultat attendu'], true)
    : `<p><strong>${esc(c['Titre du test'])}</strong> <span class="badge">${esc(c['Scénario de test'])}</span></p>
       <p style="white-space:pre-line">${esc(c['Étapes à effectuer'])}</p><p><em>Résultat attendu :</em> ${esc(c['Résultat attendu'])}</p>`;
  return `<div class="bloc test">${corps}${boutons('Tests', t.id)}</div>`;
}

async function afficherPropositions() {
  if (!projetCourant) return;
  try {
    const { feat, tests } = await propositionsEnAttente();
    const fa = feat.filter(enAttente), ta = tests.filter(enAttente);
    const nbOk = feat.filter((f) => f.champs[VALIDATION] === 'Accepté').length;
    $('#propositions').innerHTML = (fa.length || ta.length) ? `
      <h2>Propositions de l’IA à vérifier</h2>
      <p class="discret">Rien n’est validé tant que vous ne cliquez pas sur « Accepter ». Fonctionnalités déjà acceptées : ${nbOk}.</p>
      <div class="ligne"><button class="bouton valider" data-act="tout-accepter">Tout accepter</button></div>`
      + fa.map((f) => `<article class="carte-prop">${blocFonctionnalite(f)}<div class="tests">`
        + ta.filter((t) => t.champs[LIEN_FONCTION].includes(f.id)).map(blocTest).join('') + '</div></article>').join('')
      : (nbOk ? `<p class="vide">Toutes les propositions ont été traitées (${nbOk} fonctionnalité(s) acceptée(s)).</p>` : '');
  } catch (e) { afficher(e.message, 'erreur'); }
}

$('#propositions').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const { act, table, id } = b.dataset;
  try {
    if (act === 'modifier') enEdition = id;
    if (act === 'annuler') enEdition = null;
    if (act === 'accepter') await donnees('modifier', { table, id, champs: { [VALIDATION]: 'Accepté' } });
    if (act === 'enregistrer') {
      const champs = {};
      b.closest('.bloc').querySelectorAll('[data-champ]').forEach((i) => (champs[i.dataset.champ] = i.value));
      await donnees('modifier', { table, id, champs });
      enEdition = null;
    }
    if (act === 'supprimer') {
      if (!confirm('Supprimer cette proposition ?')) return;
      if (table === 'Fonctionnalités') { // on supprime aussi ses tests
        for (const t of (await propositionsEnAttente()).tests.filter((t) => t.champs[LIEN_FONCTION].includes(id)))
          await donnees('supprimer', { table: 'Tests', id: t.id });
      }
      await donnees('supprimer', { table, id });
    }
    if (act === 'tout-accepter') {
      const { feat, tests } = await propositionsEnAttente();
      for (const f of feat.filter(enAttente)) await donnees('modifier', { table: 'Fonctionnalités', id: f.id, champs: { [VALIDATION]: 'Accepté' } });
      for (const t of tests.filter(enAttente)) await donnees('modifier', { table: 'Tests', id: t.id, champs: { [VALIDATION]: 'Accepté' } });
    }
    await afficherPropositions();
  } catch (e) { afficher('Action impossible : ' + e.message, 'erreur'); }
});

// ---------- 7. Fonctionnalités ----------
const MANUEL = "Ajoutée manuellement";
const STATUTS = ['À tester', 'En cours', 'Réussi', 'Échoué', 'Bloqué'];
const COULEUR = { 'À tester': 'gris', 'En cours': 'indigo', 'Réussi': 'vert', 'Échoué': 'rouge', 'Bloqué': 'orange' };
const valide = (e) => e.champs[VALIDATION] === 'Accepté'; // seuls les éléments acceptés comptent
const liensDe = (t) => t.champs[LIEN_FONCTION] || [];
let filtreFonct = '';  // fonctionnalité sélectionnée dans la page des tests
let testOuvert = null; // test actuellement ouvert pour être exécuté

async function afficherFonctionnalites() {
  $('#fonct-aucun').hidden = !!projetCourant;
  $('#zone-fonct').hidden = !projetCourant;
  if (!projetCourant) return;
  try {
    const { feat, tests } = await propositionsEnAttente();
    const q = $('#f-recherche').value.trim().toLowerCase(), o = $('#f-origine').value;
    const liste = feat.filter(valide).filter((f) => (f.champs['Titre de la fonctionnalité'] || '').toLowerCase().includes(q) && (!o || f.champs[ORIGINE] === o));
    $('#liste-fonct').liste = liste;
    $('#liste-fonct').innerHTML = liste.length ? liste.map((f) => {
      const c = f.champs, n = tests.filter((t) => valide(t) && liensDe(t).includes(f.id)).length;
      return `<div class="carte">
        <h2>${esc(c['Titre de la fonctionnalité'])} <span class="badge">Priorité : ${esc(c['Priorité'] || 'non précisée')}</span> <span class="badge">${esc(c[ORIGINE])}</span></h2>
        <p>${esc(c['Description'])}</p>
        <p class="discret">Exigence associée : ${esc(c['Exigence source'] || 'aucune')}</p>
        <p class="discret">Tests liés : ${n}</p>
        <div class="ligne">
          <button class="bouton petit" data-act="voir-tests" data-id="${esc(f.id)}">Voir ses tests</button>
          <button class="bouton secondaire petit" data-act="ajouter-test" data-id="${esc(f.id)}">Ajouter un test</button>
          <button class="bouton secondaire petit" data-act="modifier" data-id="${esc(f.id)}">Modifier</button>
          <button class="bouton danger petit" data-act="supprimer" data-id="${esc(f.id)}">Supprimer</button>
        </div></div>`;
    }).join('') : '<p class="vide">Aucune fonctionnalité acceptée pour le moment. Ajoutez-en une, ou acceptez des propositions de l’IA dans « Cahier des charges ».</p>';
  } catch (e) { afficher(e.message, 'erreur'); }
}
$('#f-recherche').addEventListener('input', afficherFonctionnalites);
$('#f-origine').addEventListener('change', afficherFonctionnalites);

$('#liste-fonct').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const id = b.dataset.id;
  try {
    if (b.dataset.act === 'voir-tests' || b.dataset.act === 'ajouter-test') {
      filtreFonct = id; $('#t-statut').value = '';
      $('#details-test').open = b.dataset.act === 'ajouter-test';
      return aller('tests');
    }
    if (b.dataset.act === 'modifier') { // on remplit le formulaire avec la fonctionnalité choisie
      const c = $('#liste-fonct').liste.find((f) => f.id === id).champs;
      $('#f-id').value = id; $('#f-titre').value = c['Titre de la fonctionnalité'] || '';
      $('#f-prio').value = c['Priorité'] || 'Moyenne'; $('#f-desc').value = c['Description'] || ''; $('#f-exig').value = c['Exigence source'] || '';
      $('#details-fonct').open = true;
      return window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (!confirm('Supprimer cette fonctionnalité et tous ses tests ?')) return;
    for (const t of (await propositionsEnAttente()).tests.filter((t) => liensDe(t).includes(id))) await donnees('supprimer', { table: 'Tests', id: t.id });
    await donnees('supprimer', { table: 'Fonctionnalités', id });
    await afficherFonctionnalites();
  } catch (e) { afficher('Action impossible : ' + e.message, 'erreur'); }
});

function fermerFormFonct() { $('#form-fonct').reset(); $('#f-id').value = ''; $('#details-fonct').open = false; }
$('#f-annuler').addEventListener('click', fermerFormFonct);
$('#form-fonct').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const champs = { 'Titre de la fonctionnalité': $('#f-titre').value.trim(), 'Description': $('#f-desc').value.trim(),
    'Exigence source': $('#f-exig').value.trim(), 'Priorité': $('#f-prio').value };
  try {
    if ($('#f-id').value) await donnees('modifier', { table: 'Fonctionnalités', id: $('#f-id').value, champs });
    else await donnees('creer', { table: 'Fonctionnalités', champs: { ...champs, [LIEN_PROJET]: [projetCourant.id], [VALIDATION]: 'Accepté', [ORIGINE]: MANUEL } });
    fermerFormFonct();
    afficher('La fonctionnalité est enregistrée.');
    await afficherFonctionnalites();
  } catch (e) { afficher('Enregistrement impossible : ' + e.message, 'erreur'); }
});

// ---------- 8. Scénarios de test : création, exécution, résultat, capture d’écran ----------
const champ = (l, n, v, zone) => zone
  ? `<label class="large">${l}<textarea rows="3" data-champ="${esc(n)}">${esc(v)}</textarea></label>`
  : `<label>${l}<input data-champ="${esc(n)}" value="${esc(v)}"></label>`;

function carteTest(t, feat) {
  const c = t.champs, id = esc(t.id), cap = (c["Capture d'écran"] || [])[0];
  const f = feat.find((x) => x.id === liensDe(t)[0]);
  const entete = `<h2>${esc(c['Titre du test'])} <span class="badge ${COULEUR[c.Statut] || 'gris'}">${esc(c.Statut)}</span></h2>
    <p class="discret">Fonctionnalité : ${esc(f ? f.champs['Titre de la fonctionnalité'] : '')}</p>`;
  if (testOuvert !== t.id) return `<div class="carte test-carte">${entete}
    <div class="ligne"><button class="bouton petit" data-act="ouvrir-test" data-id="${id}">Ouvrir et exécuter</button>
    <button class="bouton danger petit" data-act="supprimer-test" data-id="${id}">Supprimer</button></div></div>`;
  return `<div class="carte test-carte ouvert" data-id="${id}">${entete}<div class="grille">
    ${champ('Titre du test', 'Titre du test', c['Titre du test'])}
    <label>Statut<select data-champ="Statut">${STATUTS.map((s) => `<option${s === c.Statut ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
    ${champ('Scénario', 'Scénario de test', c['Scénario de test'])}
    <p class="discret">Dernière exécution : ${esc(c['Date de la dernière exécution'] || 'jamais')}</p>
    ${champ('Étapes à effectuer', 'Étapes à effectuer', c['Étapes à effectuer'], 1)}
    ${champ('Résultat attendu', 'Résultat attendu', c['Résultat attendu'], 1)}
    ${champ('Résultat constaté', 'Résultat constaté', c['Résultat constaté'], 1)}
    ${champ('Écart entre résultat attendu et résultat constaté', 'Écart entre résultat attendu et résultat constaté', c['Écart entre résultat attendu et résultat constaté'], 1)}
    ${champ('Action à mettre en œuvre', 'Action à mettre en œuvre', c['Action à mettre en œuvre'], 1)}
    <div class="large"><strong>Capture d’écran</strong>
      ${cap ? `<div><img class="capture" src="${esc(cap.url)}" alt="Capture d’écran du test"></div>` : '<p class="discret">Aucune capture pour ce test.</p>'}
      <div class="ligne"><label class="bouton secondaire petit">${cap ? 'Remplacer la capture' : 'Ajouter une capture'}
        <input type="file" accept="image/png,image/jpeg" data-id="${id}" hidden></label>
        ${cap ? `<button class="bouton danger petit" data-act="suppr-capture" data-id="${id}">Supprimer la capture</button>` : ''}</div>
      <p class="discret">Formats PNG ou JPEG, 5 Mo maximum. Enregistrez vos modifications avant d’ajouter une capture.</p></div>
    <div class="ligne large"><button class="bouton" data-act="enregistrer-test" data-id="${id}">Enregistrer le résultat</button>
      <button class="bouton secondaire" data-act="fermer-test">Fermer</button></div></div></div>`;
}

async function afficherTests() {
  $('#tests-aucun').hidden = !!projetCourant;
  $('#zone-tests').hidden = !projetCourant;
  if (!projetCourant) return;
  try {
    const { feat, tests } = await propositionsEnAttente();
    const options = feat.filter(valide).map((f) => `<option value="${esc(f.id)}">${esc(f.champs['Titre de la fonctionnalité'])}</option>`).join('');
    $('#t-fonct').innerHTML = '<option value="">Toutes les fonctionnalités</option>' + options;
    $('#t-fonct').value = filtreFonct;
    $('#t-form-fonct').innerHTML = options || '<option value="">Aucune fonctionnalité : ajoutez-en d’abord une</option>';
    if (filtreFonct) $('#t-form-fonct').value = filtreFonct;
    const s = $('#t-statut').value;
    const liste = tests.filter(valide).filter((t) => (!filtreFonct || liensDe(t).includes(filtreFonct))
      && (!s || (s === 'attention' ? ['Échoué', 'Bloqué'].includes(t.champs.Statut) : t.champs.Statut === s)));
    $('#liste-tests').innerHTML = liste.length ? liste.map((t) => carteTest(t, feat)).join('') : '<p class="vide">Aucun test ne correspond à ces filtres.</p>';
  } catch (e) { afficher(e.message, 'erreur'); }
}
$('#t-statut').addEventListener('change', afficherTests);
$('#t-fonct').addEventListener('change', () => { filtreFonct = $('#t-fonct').value; afficherTests(); });

$('#form-test').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const fid = $('#t-form-fonct').value;
  if (!fid) return afficher('Ajoutez d’abord une fonctionnalité dans la page « Fonctionnalités ».', 'erreur');
  try {
    await donnees('creer', { table: 'Tests', champs: { [LIEN_FONCTION]: [fid], 'Titre du test': $('#t-titre').value.trim(),
      'Scénario de test': $('#t-scenario').value.trim(), 'Étapes à effectuer': $('#t-etapes').value.trim(), 'Résultat attendu': $('#t-attendu').value.trim(),
      Statut: 'À tester', [VALIDATION]: 'Accepté', [ORIGINE]: MANUEL } });
    $('#form-test').reset(); $('#details-test').open = false;
    afficher('Le test est créé avec le statut « À tester ».');
    await afficherTests();
  } catch (e) { afficher('Enregistrement impossible : ' + e.message, 'erreur'); }
});

$('#liste-tests').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  try {
    if (act === 'ouvrir-test') testOuvert = id;
    if (act === 'fermer-test') testOuvert = null;
    if (act === 'suppr-capture') {
      const carte = b.closest('.test-carte');
      const statut = carte.querySelector('[data-champ="Statut"]').value;
      await donnees('modifier', { table: 'Tests', id, champs: { Statut: statut, "Capture d'écran": [] } });
    }
    if (act === 'supprimer-test') {
      if (!confirm('Supprimer ce test ?')) return;
      await donnees('supprimer', { table: 'Tests', id });
    }
    if (act === 'enregistrer-test') {
      const champs = {};
      b.closest('.test-carte').querySelectorAll('[data-champ]').forEach((i) => (champs[i.dataset.champ] = i.value));
      if (champs.Statut !== 'À tester') champs['Date de la dernière exécution'] = aujourdhui();
      await donnees('modifier', { table: 'Tests', id, champs });
      afficher('Le résultat du test est enregistré.');
    }
    await afficherTests();
  } catch (e) { afficher('Action impossible : ' + e.message, 'erreur'); }
});

// Ajout ou remplacement d’une capture d’écran (PNG ou JPEG, 5 Mo maximum)
const lireFichier = (f) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => ko(new Error('Le fichier n’a pas pu être lu.'));
  r.readAsDataURL(f);
});
$('#liste-tests').addEventListener('change', async (ev) => {
  const inp = ev.target.closest('input[type=file]');
  if (!inp || !inp.files[0]) return;
  const f = inp.files[0], id = inp.dataset.id;
  inp.value = '';
  if (!['image/png', 'image/jpeg'].includes(f.type)) return afficher('Format refusé : choisissez une image PNG ou JPEG.', 'erreur');
  if (f.size > 5 * 1024 * 1024) return afficher('Cette image dépasse 5 Mo.', 'erreur');
  try {
    const url = await lireFichier(f);
    const carte = inp.closest('.test-carte');
    const nomsChampsResultat = [
      'Résultat constaté',
      'Écart entre résultat attendu et résultat constaté',
      'Action à mettre en œuvre'
    ];
    const champsResultat = {};
    champsResultat.Statut = carte.querySelector('[data-champ="Statut"]').value;
    const saisiesResultat = [...carte.querySelectorAll('[data-champ]')]
      .filter((saisie) => nomsChampsResultat.includes(saisie.dataset.champ));
    for (const saisie of saisiesResultat) {
      champsResultat[saisie.dataset.champ] = saisie.value;
      saisie.disabled = true;
    }
    try {
      if (C.MODE_DEMO) await donnees('modifier', { table: 'Tests', id, champs: { ...champsResultat, "Capture d'écran": [{ url, filename: f.name }] } });
      else {
        await donnees('modifier', { table: 'Tests', id, champs: { ...champsResultat, "Capture d'écran": [] } }); // remplacement : on vide d’abord
        await donnees('televerser', { table: 'Tests', id, champ: "Capture d'écran", nomFichier: f.name, typeMime: f.type, base64: url.split(',')[1] });
      }
      afficher('La capture est enregistrée.');
      await afficherTests();
    } finally {
      for (const saisie of saisiesResultat) saisie.disabled = false;
    }
  } catch (e) { afficher('La capture n’a pas pu être enregistrée : ' + e.message + (C.MODE_DEMO ? ' (en mode démonstration, essayez une image de moins de 2 Mo)' : ''), 'erreur'); }
});

// ---------- 9. Tableau de bord ----------
async function afficherTableau() {
  const zone = $('#contenu-tableau');
  if (!projetCourant) { zone.innerHTML = '<p class="vide">Ouvrez d’abord un projet dans la page « Projets ».</p>'; return; }
  try {
    const { feat, tests } = await propositionsEnAttente();
    const t = tests.filter(valide);                       // les propositions non acceptées ne sont pas comptées
    const [aTester, enCours, reussis, echoues, bloques] = STATUTS.map((s) => t.filter((x) => x.champs.Statut === s).length);
    const pExec = t.length ? Math.round(((reussis + echoues) / t.length) * 100) : null;
    const pReus = reussis + echoues ? Math.round((reussis / (reussis + echoues)) * 100) : null;
    const taux = (titre, p) => `<div class="carte"><h2>${titre}</h2><b>${p === null ? 'Non disponible' : p + ' %'}</b>
      <div class="barre"><i style="width:${p || 0}%"></i></div></div>`;
    const stat = (n, label, couleur) => `<div class="stat ${couleur}"><b>${n}</b>${label}</div>`;
    const attention = t.filter((x) => ['Échoué', 'Bloqué'].includes(x.champs.Statut));
    const enAtt = tests.filter(enAttente).length + feat.filter(enAttente).length;
    zone.innerHTML = `<div class="stats">${stat(t.length, 'Tests au total', '')}${stat(aTester, 'À tester', '')}${stat(enCours, 'En cours', 'indigo')}
        ${stat(reussis, 'Réussis', 'vert')}${stat(echoues, 'Échoués', 'rouge')}${stat(bloques, 'Bloqués', 'orange')}</div>
      <div class="taux">${taux('Taux d’exécution', pExec)}${taux('Taux de réussite des tests exécutés', pReus)}</div>
      <h2>Tests à corriger ou à débloquer</h2>`
      + (attention.length ? attention.map((x) => `<div class="carte"><strong>${esc(x.champs['Titre du test'])}</strong>
          <span class="badge ${COULEUR[x.champs.Statut]}">${esc(x.champs.Statut)}</span>
          <div class="ligne"><button class="bouton petit" data-act="voir-test" data-id="${esc(x.id)}">Ouvrir ce test</button></div></div>`).join('')
        : '<p class="vide">Aucun test échoué ou bloqué.</p>')
      + (enAtt ? `<p class="info">${enAtt} proposition(s) de l’IA attendent encore votre validation et ne sont pas comptées ici.</p>` : '');
  } catch (e) { afficher(e.message, 'erreur'); }
}
$('#contenu-tableau').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-act="voir-test"]');
  if (!b) return;
  testOuvert = b.dataset.id; filtreFonct = ''; $('#t-statut').value = 'attention';
  aller('tests');
});

// ---------- Démarrage ----------
$('#bandeau-demo').hidden = !C.MODE_DEMO;
majProjetCourant();
aller('projets');
