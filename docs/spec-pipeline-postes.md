# Sur-Mesure — Spec : CVthèque, postes et scores ATS

> Document de cadrage à donner à Claude Code en *plan mode*.
> Périmètre : passer Sur-Mesure d'un éditeur de CV mono-document à un **poste de pilotage de recherche d'emploi** : plusieurs CV, plusieurs postes, et le score ATS de chaque couple (CV × poste).

---

## 1. Objectif

Aujourd'hui Sur-Mesure répond à « je fabrique **un** CV ». La cible répond à trois questions supplémentaires :

1. **Où j'en suis ?** — statut de chaque poste, dernière activité, relance à faire.
2. **Quel CV pour quel poste ?** — quel CV a été envoyé, et est-ce le meilleur que j'avais ?
3. **Sur quoi je matche le mieux ?** — classement des postes par score ATS, et écart entre variantes de CV.

Contrainte forte : **ne pas casser l'existant**. L'éditeur, la preview, l'import PDF, les exports PDF/LaTeX/JSON et l'ATS Checker restent accessibles et fonctionnels à l'identique. On ajoute une couche au-dessus, on ne réécrit pas l'éditeur.

---

## 2. Vocabulaire (à respecter dans le code **et** dans l'UI)

| Concept | Code | UI (FR) | UI (EN) |
|---|---|---|---|
| Un CV, dans une langue, avec un intitulé | `Cv` | CV | Resume |
| Une offre / un poste ciblé | `Job` | Poste | Job |
| L'association d'un CV et d'un poste, porteuse du score | `Match` | Candidature *(si envoyée)* / Version testée | Application / Draft |
| Le résultat de l'analyse ATS | `AtsResult` | Score ATS | ATS score |

Un seul mot par concept, du modèle jusqu'au bouton. Pas de « offre » ici et « annonce » là.

---

## 3. Modèle de données

### 3.1 `Cv`

L'existant (`CVData` dans `types.ts`) devient le **contenu**, encapsulé dans une entité qui porte les métadonnées.

```ts
interface Cv {
  id: string;              // uuid
  label: string;           // "QA Lead FR — orienté IA/Evals"
  language: 'fr' | 'en';
  tags: string[];          // ["evals", "freelance", "startup"]
  data: CVData;            // structure actuelle, inchangée
  contentHash: string;     // sha256 de data — sert à invalider les scores
  createdAt: string;       // ISO
  updatedAt: string;
  archivedAt?: string;
}
```

`contentHash` est recalculé côté serveur à chaque écriture (jamais côté client) sur un JSON canonique (clés triées) de `data`.

### 3.2 `Job`

```ts
type JobStatus =
  | 'lead'        // repéré, pas encore décidé
  | 'to_apply'    // à postuler
  | 'applied'     // candidature envoyée
  | 'screening'   // échange RH en cours
  | 'interview'   // entretiens
  | 'offer'       // proposition reçue
  | 'rejected'    // refus (eux ou moi)
  | 'archived';   // classé sans suite

interface Job {
  id: string;
  company: string;
  title: string;
  status: JobStatus;
  priority: 1 | 2 | 3;             // 1 = haute
  location?: string;
  workMode?: 'onsite' | 'hybrid' | 'remote';
  contractType?: 'CDI' | 'CDD' | 'freelance' | 'internship';
  salaryRange?: string;
  url?: string;
  source?: string;                 // LinkedIn, WTTJ, cooptation, spontanée…
  contactName?: string;
  descriptionRaw: string;          // texte brut de l'offre — source du scoring ATS
  keywords: string[];              // extraits par IA, éditables à la main
  activeMatchId?: string;          // le CV réellement envoyé / retenu
  appliedAt?: string;
  nextActionAt?: string;           // date de relance
  nextActionLabel?: string;        // "relancer JB"
  notes?: string;                  // markdown libre
  events: JobEvent[];
  createdAt: string;
  updatedAt: string;
}

interface JobEvent {
  id: string;
  at: string;                                   // ISO
  type: 'status_change' | 'note' | 'follow_up' | 'interview' | 'match_submitted';
  from?: JobStatus;
  to?: JobStatus;
  comment?: string;
}
```

`events` est **append-only** : c'est la timeline du suivi, et la seule source de vérité de l'historique. Tout changement de statut génère automatiquement un `status_change`.

### 3.3 `Match` — la pièce centrale

```ts
interface Match {
  id: string;
  jobId: string;
  cvId: string;
  cvContentHash: string;    // hash du CV au moment du calcul
  ats?: AtsResult;
  computedAt?: string;
  submitted: boolean;       // ce CV a été effectivement envoyé
  submittedAt?: string;
  exportedPdfPath?: string; // trace du PDF envoyé
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface AtsResult {
  score: number;                          // 0–100
  breakdown: {
    keywords: number;                     // couverture des mots-clés de l'offre
    hardSkills: number;
    experience: number;                   // séniorité / durée / domaine
    formatting: number;                   // lisibilité machine
  };
  matchedKeywords: string[];
  missingKeywords: string[];
  suggestions: string[];                  // actions concrètes sur le CV
  provider: 'claude' | 'gemini';
  model: string;
  promptVersion: string;                  // ex. "ats-v2"
  jobDescriptionHash: string;
  rawResponse?: string;                   // audit / debug
}
```

**Pourquoi `promptVersion` + les hash :** un score n'est comparable qu'à prompt, modèle et entrées équivalents. C'est ce qui rend le classement « meilleurs matchs » honnête plutôt que décoratif, et ça permet de rejouer un lot de scorings quand le prompt change.

### 3.4 Règles métier

1. **Unicité** : un seul `Match` par couple (`jobId`, `cvId`). Recalculer écrase le résultat précédent.
2. **Score obsolète** : si `match.cvContentHash !== cv.contentHash` **ou** `ats.jobDescriptionHash !== hash(job.descriptionRaw)` **ou** `ats.promptVersion !== ATS_PROMPT_VERSION`, le score est marqué `stale`. L'UI l'affiche grisé avec un badge « à recalculer » — jamais supprimé silencieusement.
3. **`activeMatchId`** doit référencer un `Match` du même `Job`. Passer un poste en `applied` exige un `activeMatchId` (garde-fou : sinon on ne sait plus quel CV a été envoyé).
4. **Suppression d'un CV** : refusée si le CV est l'`activeMatch` d'un poste non archivé. Sinon → archivage logique (`archivedAt`), les `Match` sont conservés pour l'historique.
5. **Suppression d'un poste** : supprime ses `Match` en cascade, après confirmation nommant le nombre de scores perdus.
6. **Score de référence d'un poste** = score du `Match` actif s'il existe, sinon le meilleur score non-stale.

---

## 4. Persistance et API

### 4.1 Stockage

On reste sur du fichier (cohérent avec le montage Docker `-v $(pwd)/cvs:/yarb/cvs`), mais structuré :

```
data/
├── cvs/<cvId>.json        # migration de l'actuel dossier cvs/
├── jobs/<jobId>.json
└── matches.json           # un seul fichier, volume faible
```

Exigences côté serveur :
- écriture **atomique** (fichier temporaire + `rename`) ;
- sérialisation des écritures (mutex simple) pour éviter la corruption sur double onglet ;
- chemin racine configurable par `YARB_DATA_DIR` (défaut `./data`) — indispensable pour isoler les tests ;
- toute réponse d'erreur au format `{ error: { code, message } }`.

### 4.2 Endpoints

```
GET    /api/cvs                     → Cv[] (sans `data`, listing léger)
POST   /api/cvs                     → crée (option: ?duplicateOf=<cvId>)
GET    /api/cvs/:id                 → Cv complet
PUT    /api/cvs/:id                 → met à jour (recalcule contentHash)
DELETE /api/cvs/:id                 → archive ou 409 si règle 4

GET    /api/jobs?status=&q=&sort=   → Job[] + agrégats (bestScore, matchCount, isStale)
POST   /api/jobs
GET    /api/jobs/:id                → Job + ses Match hydratés
PATCH  /api/jobs/:id
DELETE /api/jobs/:id
POST   /api/jobs/:id/events         → ajoute une entrée de timeline
POST   /api/jobs/import             → { url? | rawText } → extraction IA d'un Job

GET    /api/matches?jobId=&cvId=
POST   /api/matches                 → { jobId, cvId } (idempotent, règle 1)
POST   /api/matches/:id/score       → lance l'analyse ATS, renvoie le Match à jour
PATCH  /api/matches/:id             → submitted, notes
DELETE /api/matches/:id
```

`POST /api/jobs/import` réutilise `services/aiService.ts` : même provider (Claude ou Gemini), un prompt dédié qui renvoie du JSON strict `{ company, title, location, workMode, contractType, salaryRange, keywords[] }`. Champs devinés → toujours éditables avant enregistrement, jamais de sauvegarde silencieuse.

---

## 5. Architecture front

### 5.1 Routing

Introduire `react-router-dom` (l'app n'en a pas). Le deep-link est nécessaire pour l'usage réel *et* pour les tests Playwright.

```
/                       → redirect /jobs
/jobs                   → Pipeline (table ou kanban)
/jobs/:jobId            → Détail poste (onglets Offre / CV & scores / Suivi)
/cvs                    → CVthèque
/cvs/:cvId              → Éditeur (l'app actuelle, avec ATS Checker)
/insights               → Matrice CV × postes + KPIs
```

### 5.2 État

Zustand (ou Context + reducer si on veut zéro dépendance) avec deux stores : `useJobsStore`, `useCvsStore`. Règles :
- aucune logique métier dans les composants — les règles de la §3.4 vivent dans le store ou le serveur ;
- une couche `services/apiClient.ts` typée, seule à connaître `fetch` ;
- optimistic update sur les changements de statut uniquement (drag & drop kanban), rollback sur erreur.

### 5.3 Fichiers touchés / créés

```
App.tsx                     → devient shell + routes (la logique éditeur part dans EditorPage)
components/
├── layout/AppShell.tsx     # nav latérale + header
├── jobs/JobsTable.tsx
├── jobs/JobsKanban.tsx
├── jobs/JobCard.tsx
├── jobs/JobForm.tsx
├── jobs/JobDetail.tsx      # onglets
├── jobs/JobTimeline.tsx
├── jobs/ImportJobDialog.tsx
├── matches/MatchList.tsx
├── matches/ScoreBadge.tsx
├── matches/AtsReport.tsx   # extrait de l'ATS Checker actuel, réutilisable
├── cvs/CvLibrary.tsx
├── cvs/CvCard.tsx
└── insights/MatchMatrix.tsx
pages/{JobsPage,JobDetailPage,CvsPage,EditorPage,InsightsPage}.tsx
services/{apiClient.ts,jobService.ts,matchService.ts}
store/{jobsStore.ts,cvsStore.ts}
server/{store.ts,routes.jobs.ts,routes.cvs.ts,routes.matches.ts,ats.ts}
```

`server.js` grossit trop pour rester un fichier : le découper en modules sous `server/` en gardant `server.js` comme point d'entrée.

---

## 6. UI

Le look actuel (Tailwind, fond clair, accent bleu, cartes à coins arrondis) est conservé : c'est un outil de travail, pas un site vitrine. L'effort de design porte sur la **densité d'information** et la lisibilité du statut, pas sur une nouvelle identité.

### 6.1 Navigation

Rail latéral gauche (≈ 200 px, collapsible) : **Postes · CVthèque · Analyse**. Le header garde le sélecteur FR/EN et les actions globales. L'éditeur actuel devient une page atteinte depuis un CV — il perd sa place de page d'accueil.

### 6.2 Écran « Postes » (`/jobs`)

Bandeau de KPIs (4 tuiles, cliquables = filtres) : **Postes actifs · Candidatures envoyées · Entretiens en cours · Relances dues**.

Bascule **Tableau ⇄ Kanban** (persistée en `localStorage`).

*Tableau* — colonnes triables : Priorité · Poste · Entreprise · Statut · CV actif · **Score ATS** · Écart avec le meilleur CV · Dernière activité · Prochaine action.
Filtres : statut (multi), source, mode de travail, texte libre, « score obsolète uniquement ».
Tri par défaut : `nextActionAt` croissant, puis priorité.

*Kanban* — une colonne par statut, drag & drop pour changer de statut. Carte : entreprise · titre · `ScoreBadge` · pastille du CV actif · date de dernière activité. Compteur en tête de colonne.

`ScoreBadge` : ≥ 80 vert, 60–79 ambre, < 60 gris-rouge, `stale` → même valeur en contour pointillé + icône de recalcul. Jamais un score seul sans son état de fraîcheur.

### 6.3 Détail poste (`/jobs/:jobId`)

Panneau latéral large (drawer) plutôt que page pleine, pour garder la liste en contexte. Trois onglets :

1. **Offre** — texte brut de l'annonce, mots-clés extraits (chips éditables, ajout/suppression), métadonnées éditables, lien vers l'annonce.
2. **CV & scores** — liste des `Match` triés par score. Par ligne : nom du CV, langue, score + breakdown en barres, mots-clés manquants (3 premiers + « voir tout »), actions : *Recalculer*, *Définir comme CV envoyé*, *Ouvrir dans l'éditeur*, *Dupliquer ce CV et l'adapter à cette offre*. Bouton principal : **Tester un autre CV** (sélecteur de CV → création du `Match` → scoring).
3. **Suivi** — timeline des `events`, ajout d'une note, champ prochaine action + date, bouton de changement de statut.

L'action **Dupliquer ce CV et l'adapter** est le cœur de la boucle : elle crée un CV `label = "<label source> — <entreprise>"`, l'ouvre dans l'éditeur avec le panneau des mots-clés manquants épinglé, et crée le `Match` correspondant à la sauvegarde.

### 6.4 CVthèque (`/cvs`)

Grille de cartes : label, langue, tags, date de MAJ, nombre de postes associés, meilleur score obtenu. Actions : Éditer · Dupliquer · Exporter PDF · Archiver. Bouton **Nouveau CV** avec trois entrées : vierge · depuis un PDF (import IA existant) · depuis un JSON.

### 6.5 Analyse (`/insights`)

**Matrice CV × postes** : lignes = CV, colonnes = postes actifs, cellule = score en heatmap, cellule vide = non testé (cliquable pour lancer le scoring). C'est la réponse directe à « sur quoi je matche le mieux » et à « est-ce que mon CV FR generaliste tient face au CV orienté evals ».
En complément : distribution des scores, top 5 des mots-clés les plus souvent manquants sur l'ensemble des offres (= ce qu'il faut vraiment ajouter au CV de base).

### 6.6 Écriture d'interface

- Verbes d'action, pas de « Soumettre » : le bouton dit **Calculer le score**, le toast dit **Score calculé**.
- États vides = invitations : sur `/jobs` vide → « Ajoutez un poste pour commencer à suivre vos candidatures. » + bouton **Coller une offre**.
- Erreurs explicites et actionnables : « Le calcul du score a échoué (quota Gemini atteint). Réessayez avec Claude. » Pas d'excuse, pas de vague.
- Toute chaîne passe par le mécanisme FR/EN existant.

---

## 7. Migration

Au démarrage, si `cvs/` contient des fichiers à l'ancien format :
- créer `data/cvs/<uuid>.json` pour chacun, `label` = nom de fichier, `language` déduite ou `fr` par défaut ;
- écrire un `data/.migrated` pour ne pas rejouer ;
- ne rien supprimer de l'ancien dossier ; logguer le rapport de migration.

Aucun `Job` ni `Match` à migrer : partie neuve.

---

## 8. Testabilité et tests

Le projet a déjà une CI, du coverage et une suite Playwright naissante. Cette évolution doit être testable **sans cliquer 15 fois pour arriver à l'état voulu**.

**Crochets de test (obligatoires, activés uniquement si `NODE_ENV === 'test'` ou `YARB_TEST_HOOKS=1`) :**
- `POST /api/__test__/reset` — vide `YARB_DATA_DIR` ;
- `POST /api/__test__/seed` — injecte un jeu de CV/jobs/matches fourni en body ;
- `ATS_PROVIDER=fake` — stub déterministe du scoring ATS (score dérivé du hash des entrées) : aucun test E2E ne doit dépendre d'un appel LLM réel.

**Conventions :** `data-testid` sur tout élément interactif, nommés `job-row-<id>`, `score-badge`, `status-select`, `match-row-<cvId>`, etc. Chaque écran a un testid racine.

**Scénarios E2E minimum :**
1. Créer un poste par collage de texte → il apparaît dans le tableau au statut `lead`.
2. Associer un CV → calculer le score → le badge affiche la valeur et le breakdown.
3. Modifier le CV dans l'éditeur → revenir au poste → le score est marqué obsolète → recalcul → il redevient frais.
4. Définir le CV envoyé + passer en `applied` → un `status_change` apparaît dans la timeline.
5. Passer un poste en `applied` sans CV actif → l'action est bloquée avec un message explicite.
6. Drag & drop kanban `applied` → `interview` → persistance après rechargement de page.
7. Supprimer un poste ayant 2 matches → confirmation nommant les 2 scores → suppression en cascade.
8. Filtrer sur « score obsolète uniquement » → seuls les postes concernés restent.

**Tests unitaires (Vitest) :** règles §3.4 (invalidation, garde-fous, unicité des matches), calcul du `contentHash` (stable à réordonnancement des clés), parsing de la réponse ATS (JSON malformé, score hors bornes, clés manquantes).

---

## 9. Découpage en lots

Chaque lot est mergeable seul et laisse l'app fonctionnelle.

| Lot | Contenu | Definition of Done |
|---|---|---|
| **0 — Socle serveur** | `server/` modulaire, store fichier atomique, `YARB_DATA_DIR`, migration `cvs/`, crochets de test | Tests unitaires du store verts ; l'app existante fonctionne à l'identique |
| **1 — Modèle & API** | Types partagés, CRUD `/api/cvs` `/api/jobs` `/api/matches`, règles §3.4 côté serveur | Tests d'API verts, y compris les cas 409 |
| **2 — Shell & routing** | react-router, `AppShell`, éditeur déplacé sous `/cvs/:cvId`, CVthèque | Navigation complète, aucune régression sur l'éditeur/export PDF |
| **3 — Pipeline** | Tableau, filtres, `JobForm`, drawer de détail, timeline | Scénarios E2E 1, 4, 5, 8 verts |
| **4 — Matches & ATS** | `MatchList`, refactor de l'ATS Checker en `AtsReport` réutilisable, scoring + invalidation, `ATS_PROVIDER=fake` | Scénarios E2E 2, 3, 7 verts |
| **5 — Kanban & analyse** | Kanban drag & drop, KPIs, matrice CV × postes | Scénario E2E 6 vert |
| **6 — Import IA & finitions** | `POST /api/jobs/import`, « dupliquer et adapter », i18n complet, README + captures | Import d'une offre réelle de bout en bout ; coverage ≥ niveau actuel |

---

## 10. Hors périmètre (v2 assumée)

- Scraping automatique d'annonces — **Decker** fait déjà ce travail ; prévoir seulement que `POST /api/jobs/import` accepte un tableau JSON, ce qui suffira à brancher Decker plus tard.
- Envoi d'emails / relances automatiques.
- Génération de lettre de motivation depuis l'offre + le CV *(candidat sérieux pour la v2 : toute la matière est déjà là)*.
- Multi-utilisateur, authentification, base de données.

---

## 11. Décisions à trancher avant de lancer le plan

1. **Kanban dès le lot 3 ou tableau seul ?** Le tableau porte mieux les scores et les tris ; le kanban est plus agréable pour le statut. La spec fait les deux, mais le kanban peut sauter si tu veux livrer vite.
2. **Un `Match` par CV testé, ou un seul CV par poste ?** La spec assume le multi-CV (c'est ce qui permet la matrice et l'écart de score). Simplifier en 1-1 diviserait le travail par deux mais tuerait la comparaison.
3. **Zustand ou Context/reducer ?** Une dépendance de plus contre un peu de boilerplate.
4. **Score ATS : Claude, Gemini, ou choix par calcul ?** Stocker le provider dans `AtsResult` permet de comparer, mais mélanger les providers dans un même classement fausse le tri — proposition : un provider par défaut configurable, et un avertissement dans l'UI si un classement mélange les sources.

---

## 12. Prompt de lancement pour Claude Code

```
Lis @docs/spec-pipeline-postes.md en entier avant toute chose.

Contexte : Sur-Mesure est un CV builder React 19 + TS + Vite + Tailwind avec un serveur
Express qui compile du LaTeX. Je veux y ajouter la gestion de postes et de scores
ATS par couple CV × poste, décrite dans cette spec.

Ne code rien pour l'instant. Produis un plan d'implémentation :
- confirme ou conteste le découpage en lots de la §9 au vu du code réel ;
- pour chaque lot : fichiers créés/modifiés, ordre des étapes, tests écrits, risques
  de régression sur l'existant (éditeur, export PDF, ATS Checker) ;
- signale tout point de la spec incompatible avec le code actuel, en proposant une
  alternative ;
- liste les questions qui bloquent le lot 0 et le lot 1.

Explore le code avant de répondre : types.ts, App.tsx, server.js, services/,
components/, et la suite Playwright existante.
```
