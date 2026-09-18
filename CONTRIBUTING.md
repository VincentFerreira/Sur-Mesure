# Contributing

Thank you for your interest in Sur-Mesure!

## Prerequisites

- Node.js ≥ 23 (see `.nvmrc`)
- A LaTeX distribution with `pdflatex` (MacTeX on macOS, TeX Live on Linux/Windows)
- API keys for Gemini and/or Claude (see `.env.local.example`)

## Setup

```bash
git clone https://github.com/vincentferreira/latex-cv-builder.git
cd latex-cv-builder
npm install
cp .env.local.example .env.local
# Fill in your API keys in .env.local
npm start   # starts both Vite (port 3000) and the LaTeX server (port 3001)
```

## Workflow

1. Open an issue to discuss the change before starting significant work.
2. Create a branch: `git checkout -b feat/<short-description>`
3. Make small, focused commits using [Conventional Commits](https://www.conventionalcommits.org/):
   `fix:`, `feat:`, `chore:`, `docs:`, `refactor:`, `perf:`, `ci:`
4. Run `npx tsc --noEmit` before pushing — the project uses TypeScript strict mode.
5. Open a pull request with a clear description of what and why.

## Project structure

| Path | Role |
|---|---|
| `App.tsx` | Root component — toolbar actions, state |
| `components/Editor.tsx` | Left panel — form editor |
| `components/Preview.tsx` | Right panel — live CV preview |
| `components/ATSChecker.tsx` | ATS analysis UI |
| `components/AnalysisOverlay.tsx` | Import progress overlay |
| `services/aiService.ts` | Gemini + Claude API calls |
| `services/latexService.ts` | LaTeX template generation |
| `services/pdfService.ts` | PDF download via compilation server |
| `lib/i18n.ts` | Language config, translations, safe accessors |
| `server.js` | Express server — runs pdflatex |
| `types.ts` | TypeScript interfaces |
| `constants.ts` | Default CV data |

## Adding a language

1. Add the language code to `LANGUAGE_CODES` in `lib/i18n.ts`.
2. Add its metadata to `LANGUAGES`.
3. Add all keys to `UI_TRANSLATIONS` and `LATEX_TRANSLATIONS`.
4. TypeScript will report every missing key at compile time.
