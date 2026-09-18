## Architecture at a glance

- Two separate processes, both needed for local dev: Vite dev server (`:3000`)
  and the Express API/PDF server (`server.js`, `:3001`). `npm start` runs both
  via `concurrently`. `services/apiClient.ts` derives the host from
  `window.location.hostname` but hardcodes port `3001`; `services/pdfService.ts`
  hardcodes the full `http://localhost:3001/compile` (host included, not just
  port). Neither is a relative path — both need edits to work behind a proxy or
  a different port.
- Directory map: `components/` (UI, incl. `jobs/` kanban board, `matches/` ATS
  scoring UI), `pages/` (routed containers), `store/` (Zustand: `cvsStore`,
  `jobsStore`, optimistic updates with rollback on API failure), `services/`
  (client-side business logic, including all AI calls), `server/` (Express
  routes + JSON file persistence), `lib/` (pure utils: i18n, template engine,
  fonts), `templates/cv.mustache` (the one LaTeX template).
- Data persistence is flat JSON files under `data/` (no database), via
  `server/store.js`. Gitignored; overridable with `YARB_DATA_DIR` /
  `YARB_DATA_HOST_DIR` (Docker).
- Domain vocabulary is deliberate — use these terms, not synonyms (full spec:
  `docs/spec-pipeline-postes.md`, in French): `Cv`, `Job` (status pipeline
  `lead → to_apply → applied → screening → interview → offer/rejected/archived`),
  `Match` (Cv×Job pairing), `AtsResult`. `CVData` fields are bilingual
  (`MultiLangString` = `Partial<Record<Language, string>>`) — don't assume a
  plain string.

## AI / ATS integration (services/aiService.ts)

- Three providers behind one interface: `gemini`, `claude`, `fake`
  (deterministic — used by e2e tests via `VITE_ATS_PROVIDER=fake`, never hits a
  real API). `atsProviderModel()` selects.
- Gemini responses must be branched on `finishReason`, not just checked for
  truncation: `RECITATION` (model echoed job-description text verbatim and got
  cut by the safety filter) is a distinct failure mode from `MAX_TOKENS`, and
  conflating them was a real, previously-shipped bug. If touching ATS analysis,
  preserve the retry-with-`ATS_ANTI_RECITATION_REMINDER` pattern and keep
  `RECITATION` / `SAFETY` / `MAX_TOKENS` handled separately.
- `GEMINI_MODEL` (`gemini-3.1-flash-lite`) is pinned deliberately for cost —
  don't bump it without checking the new model's token limits (see
  `ATS_CLAUDE_MAX_TOKENS` / `ATS_CLAUDE_RETRY_MAX_TOKENS` for the equivalent
  Claude-side retry budget).
- All AI calls happen **client-side** in `aiService.ts`, not proxied through
  `server.js` — API keys are injected into the browser bundle via Vite
  `define` (`vite.config.ts`). Relevant if asked to add a new AI feature or to
  reason about key exposure.
- `contentHash` (`server/hash.js` `sha256Json`) links a `Job.cvContentHash` to
  the `Cv` it was scored against, to detect staleness. CVs created before this
  field existed are lazily backfilled on read in `server/routes.cvs.js` — don't
  assume every stored CV already has one.

## Playwright: MCP vs test suite

Two distinct tools, two distinct purposes — don't conflate them.

- **Playwright MCP** (`.mcp.json`) is for interactive work in a real browser:
  exploring the app, finding the right selector for a new test, reproducing a
  reported bug step by step, or visually checking a change you just made.
  It is not a source of truth — nothing about correctness is established just
  because an MCP session looked right once.
- **`npx playwright test`** (`tests/e2e/`) is the source of truth for
  non-regression. It's what CI runs, and it's what determines whether a
  change broke the import → preview → export flow.

If an MCP session uncovers an interesting behavior — a bug, an edge case, a
selector that turns out to be flaky — turn it into a spec under `tests/e2e/`
before moving on. An interesting finding that only lived in an MCP session is
lost the moment the session ends.

## Testing

- Commands: `npm run test` / `test:watch` / `test:coverage` (Vitest, unit —
  `__tests__/` mirrors `lib/`, `services/`, `server/`); `npm run test:e2e` /
  `test:e2e:report` (Playwright, `tests/e2e/`).
- `tests/fixtures/*.json` is a fixture-per-edge-case set, not one "kitchen
  sink" fixture: `cv-complet.json` (deliberate 1-pager),
  `cv-page-break-edge.json` (page-break regressions), plus
  `cv-accents.json` / `cv-champs-manquants.json` / `cv-invalide.json` /
  `cv-minimal.json` / `cv-vide.json` for encoding / missing-field / invalid /
  empty cases. Pick the matching fixture (or extend it) rather than writing a
  new one-off.
- Playwright spawns an isolated `data/` dir per run and sets
  `VITE_ATS_PROVIDER=fake` + `YARB_TEST_HOOKS=1` automatically when it starts
  its own server — e2e tests never hit real Gemini/Claude APIs.

## Debugging templates/cv.mustache (LaTeX/PDF layout)

- `templates/cv.mustache` is rendered by a **custom** engine
  (`lib/templateEngine.ts`), not the `mustache` package's default syntax:
  delimiters are `[[ ]]`, not `{{ }}`, specifically to avoid colliding with
  LaTeX's own `{ }` brace syntax. Don't "fix" a `[[foo]]` tag by rewriting it
  to `{{foo}}` — that silently breaks rendering.
- A custom template saved to `localStorage` (`cv-latex-template`, see
  `services/templateStorageService.ts`) overrides `templates/cv.mustache`
  for real exports too. If a fix doesn't show up in the app, reset it via
  the LaTeX panel's Template tab first.
- Don't "clean up" an inconsistent-looking `\vspace` without compiling —
  it may be an empirical compensation (`itemize` needs more negative space
  than `tabularx` to match visually, regardless of `topsep`).
- Verify layout changes by compiling: throwaway Vitest test calling
  `generateLatex()` on a real fixture → `pdflatex` → `pdftoppm` to inspect.
- `pdf-parse` only gives text, not positions — use `readPdfTextPositions`
  (`tests/helpers/pdf.ts`, via `pdfjs-dist`) for alignment/page-break checks.
- `cv-complet.json` is a deliberate 1-pager; use/extend
  `tests/fixtures/cv-page-break-edge.json` for page-break regressions.
- `PDFLATEX_PATH` defaults to a macOS MacTeX path in `server.js`; Linux/Docker
  must override it (the Docker image sets `/usr/bin/pdflatex`). If PDF export
  fails locally on Linux, check this env var before assuming a code bug.
