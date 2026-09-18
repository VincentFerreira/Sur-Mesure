# 📏 Sur-Mesure
### *AI Job Search Tool. One CV per Job. Measured, then tailored.*

[![CI](https://github.com/VincentFerreira/YARB-Resume-Builder/actions/workflows/ci.yml/badge.svg)](https://github.com/VincentFerreira/YARB-Resume-Builder/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/VincentFerreira/YARB-Resume-Builder/graph/badge.svg)](https://codecov.io/gh/VincentFerreira/YARB-Resume-Builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js ≥ 23](https://img.shields.io/badge/node-%E2%89%A523-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Built with Claude Code](https://img.shields.io/badge/Built_with-Claude_Code-D97757)](https://claude.com/claude-code)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

A web app that scrapes job postings from multiple sources, qualifies and scores each one against your actual CV, and tracks your search through a kanban pipeline — with ATS scoring, CV editing, and PDF export built in.

## How it works

1. **Import your CV** — drop an existing PDF and let AI extract the details, or build one from scratch in the visual editor.
2. **Set your search preferences** — job titles, locations, work mode, which sources to use, and a budget.
3. **Launch the search** — Sur-Mesure discovers postings across several sources, qualifies and scores each one against your CV, and hands you a ranked list to review.

## Features

### 🔎 Job discovery
- **Multi-source scraping** — France Travail's official job-search API (free credentials, entered directly in-app), Arbeitnow, and FreeHire's aggregator across ~50 ATS platforms (Greenhouse, Lever, etc.)
- **AI web search** — a fourth source fans out through Claude Code's own WebSearch/WebFetch tools for boards with no public API. There's no fixed site list: it searches and verifies postings the way a person would, favoring sources it can actually fetch (company career pages, Greenhouse, Lever, France Travail's own site)
- **Per-source control** — enable or disable each source independently from Preferences, with a short explanation of what each one does

### 📋 Kanban pipeline
- **8-stage pipeline** — Lead → To apply → Applied → Screening → Interview → Offer / Rejected / Archived
- **Table & kanban views** — browse as a filterable table or drag cards across status columns; your view choice is remembered
- **Priorities & follow-ups** — set a priority level and a next-action date per job
- **Staleness detection** — a job's ATS score is flagged out of date the moment its linked CV changes

### 🎯 Auto-qualification & scoring
- **Fit score & tier** — every discovered posting gets a 0-100 fit score and a high/medium/low tier, both computed automatically
- **Auto-labeled signals** — short tags explaining the score (e.g. "CV aligned," "Onsite only," "Staffing agency"), positive/negative/neutral
- **CV-aware** — when a CV is linked in preferences, qualification judges your actual skills and experience against the posting's stated requirements, not just title and location
- **Learns from your dismissals** — a reason you give when dismissing a posting downgrades similar future postings from that company
- **Configurable** — a budget cap on AI search spend and an auto-dismiss score threshold, both tunable in Preferences

### 📊 Insights dashboard
- Fit distribution and review-conversion rate across your discoveries
- Yield per source — which one actually finds you good jobs
- Geography & remote-work breakdown, with a nudge if your results skew remote but your preferences don't ask for it
- Recurring positive and negative signal themes across everything discovered
- ATS score delta (current vs. potential) and recurring formatting issues across your scored jobs, plus the keywords most often missing from your CV
- A conversion funnel with per-stage median time and drop-off

### ✅ ATS scoring & recommendations
- **Per-job scoring** — associate a CV with a job and get a 0-100 match score plus a projected score if the recommendations are applied
- **Keyword breakdown** — critical and important keywords with status and a one-line note each
- **Formatting checks** — contact info, dates, action verbs, measurable achievements, keyword stuffing, bullet usage
- **Concrete rewrites** — not just a score: actual before/after text suggestions for improving the fit
- **Stays fresh** — recalculates on demand and flags itself stale as soon as the linked CV changes

### 📝 CV builder & export
- Visual editor — no LaTeX knowledge required
- AI import — drop an existing PDF and let Gemini or Claude extract all the data
- Bilingual (FR / EN) CV content, switchable per field
- PDF export via a LaTeX template, or copy the raw `.tex` source
- CV Library — keep multiple named CVs and switch between them

### 🔬 Observability
Every AI and CLI call the app makes — provider, model, tokens, cost, duration, and the full prompt/response — is logged and browsable in near real time, with error diagnostics for anything that failed.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Job sources | France Travail API, Arbeitnow API, FreeHire API, Claude Code CLI (WebSearch/WebFetch) |
| AI | Google Gemini (`@google/genai`), Anthropic Claude (`@anthropic-ai/sdk`), Claude Code CLI (`claude`) |
| PDF compilation | Express server → `pdflatex` |

## Prerequisites

- **Node.js** ≥ 23
- **Claude Code CLI** (`claude`), installed and logged in — powers the AI web-search job source and *all* qualification/scoring of scraped jobs; there's no fallback for this path
- An **API key** for at least one AI provider, for CV import and standalone ATS scoring:
  - [Google AI Studio](https://aistudio.google.com/app/apikey) → Gemini
  - [Anthropic Console](https://console.anthropic.com/) → Claude
- *(Optional)* **LaTeX distribution** with `pdflatex` (e.g. [MacTeX](https://www.tug.org/mactex/), [TeX Live](https://tug.org/texlive/)) — only needed for PDF export from the CV builder.
  The server expects `pdflatex` at `/Library/TeX/texbin/pdflatex` (macOS default). Override with the `PDFLATEX_PATH` environment variable for other systems.
- *(Optional)* Free **France Travail API credentials** ([francetravail.io](https://francetravail.io)) — entered directly in Preferences, not an env var.

## Getting started

```bash
# 1. Clone
git clone https://github.com/VincentFerreira/YARB-Resume-Builder.git
cd YARB-Resume-Builder

# 2. Install dependencies
npm install

# 3. Configure API keys
cp .env.local.example .env.local
# Edit .env.local and fill in your keys

# 4. Start both servers (Vite on :3000, API/PDF compiler on :3001)
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

Create a `.env.local` file at the root (already gitignored):

```env
GEMINI_API_KEY=your_gemini_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

Both keys are optional — you only need the one(s) for the AI provider(s) you want to use for CV import and ATS scoring. France Travail credentials go in the app itself (Preferences), not here. The `claude` CLI authenticates separately via its own login, outside the app.

Setting `VITE_ATS_PROVIDER=fake` exposes an offline, deterministic "🧪 Fake" provider option (job/CV extraction and ATS scoring, no network call) alongside Gemini/Claude — used by the e2e test suite, and useful for trying the app without API keys.

## Usage

### Searching for a job

1. Go to **Preferences** and set your job titles, locations, work modes, which sources to use, and (optionally) link a CV so qualification can judge actual fit, not just title/location
2. Go to **Discovery** and launch a search — new postings arrive scored and tagged with signals explaining why
3. Review the list: import a promising one straight into your pipeline, or dismiss it (optionally with a reason, which sharpens future qualification)
4. Check **Insights** for fit distribution, source yield, recurring themes, and a conversion funnel across your whole search

### Tracking the pipeline

1. Go to **Jobs** and browse as a table or a drag-and-drop **kanban** board — the view is remembered
2. Move a job through the pipeline, set a priority and a follow-up date
3. Assign a CV and **Compute score** for an ATS match — keyword breakdown, formatting checks, and concrete rewrite suggestions
4. If you edit that CV later, the score is marked stale — **Recalculate**, or duplicate the CV to tailor a copy for that specific posting

### Building a CV

1. Fill in your details in the visual editor, or **import** an existing PDF resume via AI
2. Switch language with FR / EN to edit the translated version
3. **Download PDF** to compile and save the result, or **Export LaTeX** for the raw `.tex` source
4. **Save** it to your **CV Library** to reuse later or attach to a job

## Project structure

```
├── App.tsx                    # Root component — router shell
├── pages/                     # Route-level screens (JobSearchPage, JobsPage, InsightsPage,
│                               #   ObservabilityPage, PreferencesPage, CvsPage, EditorPage, ...)
├── components/
│   ├── Editor.tsx, Preview.tsx, LatexViewer.tsx   # CV form editor, live preview, LaTeX/PDF panel
│   ├── jobs/                  # Pipeline UI — table, kanban, detail, import dialog, status/priority meta
│   ├── scraper/                # Discovery UI — scraped job rows, score gauge, signal chips
│   ├── insights/                # Insights dashboard cards (fit, funnel, geography, signals, ...)
│   ├── observability/           # AI/CLI call detail panel
│   ├── matches/                 # Shared ATS scoring UI (AtsReport, ScoreBadge)
│   └── layout/                  # App shell (nav, header)
├── store/                     # Zustand stores (jobsStore, cvsStore, scraperStore, preferencesStore,
│                               #   observabilityStore, ...)
├── lib/
│   ├── insights*.ts             # Insights dashboard metrics (discovery, ATS, signals, funnel)
│   ├── jobStale.ts              # ATS-score staleness detection
│   └── i18n.ts                 # Bilingual CV content (FR/EN)
├── services/
│   ├── aiService.ts             # Gemini + Claude PDF/job extraction, ATS scoring
│   ├── scraperService.ts        # Job-search API client
│   ├── observabilityService.ts  # AI/CLI call log client
│   ├── latexService.ts          # LaTeX template generation
│   └── pdfService.ts, cvStorageService.ts, jobService.ts
├── server.js, server/
│   ├── scrapers/                # Portal registry, per-source clients (France Travail, Arbeitnow,
│   │                             #   FreeHire), the Claude CLI search/qualification integration
│   ├── observabilityStore.js    # AI/CLI call log (SQLite)
│   └── routes.*.js              # Express routes — jobs, CVs, scraper, preferences, observability
├── types.ts                   # TypeScript interfaces (CVData, Job, ScrapedJob, AtsResult, ...)
└── constants.ts               # Default CV data
```

Jobs, CVs, and scraped candidates persist as flat JSON/SQLite files under `data/` (`YARB_DATA_DIR` to override) — no external database.

## Running with Docker

If you don't want to install Node.js or a LaTeX distribution locally, Docker handles everything except the `claude` CLI — the published image doesn't include it, so the AI web-search job source and all job qualification/scoring won't work out of the box in a container unless you install and authenticate it inside one yourself. The three API-based sources (France Travail, Arbeitnow, FreeHire) and CV import/ATS scoring via Gemini/Claude still work normally.

### Option A — `docker compose` (recommended for development, live-reload)

`docker build`'s `COPY . .` only snapshots your code at build time — restarting a container from that image won't pick up later edits. `docker-compose.yml` instead bind-mounts the project directory into the container, so the Vite dev server (already running in the image via `npm start`) picks up file changes immediately, same as running `npm run dev` locally.

```bash
docker compose up --build
```

- First run (or after changing `package.json`), use `--build` to rebuild the image; subsequent runs can just be `docker compose up`.
- Your local files are mounted read-write into the container; `node_modules` stays the one installed inside the image (see the anonymous volume in `docker-compose.yml`) so it doesn't get shadowed by your host's.
- Requires a `.env.local` file (see [Getting started](#getting-started)) — `docker-compose.yml` reads it via `env_file`.
- By default `data/` (jobs, CVs, scraped candidates — see above) lives inside the repo, gitignored — a fresh clone always starts empty. To keep your data outside the repo entirely (e.g. so a `git clean`/repo wipe can't touch it), create a `.env` file (gitignored, separate from `.env.local`) at the repo root with `YARB_DATA_HOST_DIR=/absolute/path/on/your/host`; `docker-compose.yml` mounts that folder in instead.

### Option B — plain `docker run` (one-off, no live-reload)

Rebuild the image (`docker build -t yarb .`) after every code change — there's no volume, so the container only ever sees the code that was copied in at build time.

```bash
# Build the image once
docker build -t yarb .
```

If you already have a `.env.local` file configured, you can use it directly:

```bash
docker run --rm -it -p 3000:3000 -p 3001:3001 --env-file .env.local yarb
```

Otherwise, you can pass `ANTHROPIC_API_KEY` and/or `GEMINI_API_KEY`:

```bash
docker run --rm -it -p 3000:3000 -p 3001:3001 \
  -e ANTHROPIC_API_KEY=your_anthropic_api_key \
  -e GEMINI_API_KEY=your_gemini_api_key \
  yarb
```

To persist data between runs, mount the `data` directory:

```bash
docker run --rm -it -p 3000:3000 -p 3001:3001 --env-file .env.local -v "$(pwd)/data:/yarb/data" yarb
```

### Open the application

Open [http://localhost:3000](http://localhost:3000).

## Contributing

Pull requests are welcome. For larger changes, open an issue first to discuss what you'd like to change.

## License

[MIT](LICENSE)
