// Shells out to the `claude` CLI already installed on the user's machine (Claude
// Code) for every job-search AI step — instead of calling the Anthropic/Gemini APIs
// directly with a separate billed key. No separate rate limit or API key to manage:
// it uses whatever auth the CLI already has (subscription or otherwise). Used for:
// - searchAll: Claude Code's own built-in WebSearch/WebFetch tools, exactly mirroring
//   ai-job-search's WebSearch fallback (welcometothejungle.com, apec.fr).
// - expandKeywords / qualifyAll: plain text-in/JSON-out calls (no tools needed) for
//   widening the search net and judging each candidate's fit — previously done via
//   services/aiService.ts's direct Gemini/Claude API calls (see git history), moved
//   here so the whole job-search pipeline rides on the one CLI mechanism.
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fitFromScore } from './scraperFit.js';

const execFileAsync = promisify(execFile);

export const id = 'claude_cli';

const CLAUDE_BIN = process.env.CLAUDE_CLI_PATH || 'claude';
// A `claude -p` turn with WebSearch/WebFetch can run several searches/fetches
// sequentially — this is a subprocess call, not an HTTP request, so a generous
// timeout is cheap; it only protects against a genuinely hung process. Plain
// text-in/JSON-out calls (expand/qualify) are much faster but reuse the same budget.
const TIMEOUT_MS = 6 * 60 * 1000;
const MAX_BUFFER = 20 * 1024 * 1024;
const CONTRACT_TYPES = ['CDI', 'CDD', 'freelance', 'internship'];
const MAX_EXPANDED_KEYWORDS = 10;
const QUALIFY_BATCH_SIZE = 25;
const DESCRIPTION_EXCERPT_LENGTH = 400;

function stripCodeFence(text) {
    const trimmed = (text ?? '').trim();
    if (trimmed.startsWith('```json')) return trimmed.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    if (trimmed.startsWith('```')) return trimmed.replace(/^```\s*/, '').replace(/\s*```$/, '');
    return trimmed;
}

// Runs one `claude -p` turn and returns its final text answer (`.result`).
// `tools` is a comma-separated allowlist ("" disables every tool — used for the
// plain text-processing calls below, which need no tool access at all).
//
// `--allowedTools` pre-approves exactly the same list instead of bypassing
// permissions broadly — deliberately NOT `--permission-mode bypassPermissions` (or
// `--dangerously-skip-permissions`): both are hard-refused by Claude Code when the
// process runs as root (this app's container has no USER directive), and `--tools`
// alone only restricts what's *loaded*, it doesn't pre-approve calling it.
//
// ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN are stripped from the child's env: if either
// is set (e.g. this app's own container sets ANTHROPIC_API_KEY for
// services/aiService.ts's direct SDK calls, used by other features), the CLI prefers
// it over the mounted OAuth session (~/.claude, ~/.claude.json) — which is exactly the
// separate, billed-API-key path this module exists to avoid.
async function runClaude(prompt, tools) {
    const { ANTHROPIC_API_KEY: _unused1, ANTHROPIC_AUTH_TOKEN: _unused2, ...cliEnv } = process.env;

    let stdout;
    try {
        ({ stdout } = await execFileAsync(
            CLAUDE_BIN,
            [
                '-p', prompt,
                '--output-format', 'json',
                '--tools', tools,
                ...(tools ? ['--allowedTools', tools] : []),
                '--no-session-persistence',
                '--strict-mcp-config',
            ],
            { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: cliEnv }
        ));
    } catch (err) {
        throw new Error(`claude CLI invocation failed: ${err.message}`);
    }

    let payload;
    try {
        payload = JSON.parse(stdout);
    } catch {
        throw new Error('claude CLI returned unparsable output');
    }
    if (payload.is_error) {
        throw new Error(`claude CLI reported an error: ${payload.result ?? payload.subtype ?? 'unknown'}`);
    }
    return payload.result ?? '';
}

// ─── Web search (searchAll) ────────────────────────────────────────────────────

function buildSearchPrompt(jobTitles, locations) {
    return `You are helping a job seeker find current openings by searching the live web — the same way a human would manually check job boards that have no public API.

Search specifically on these French job boards using "site:" queries, in addition to general web search:
- site:welcometothejungle.com
- site:apec.fr

Target job titles: ${jobTitles.join(', ')}
Acceptable locations (if empty, no location constraint): ${locations.join(', ') || '(none)'}

For every promising result, fetch the actual posting page before including it — never report a posting you have not fetched and verified is real and current.

When done, respond with ONLY a JSON array (no markdown, no prose before or after) of the verified postings, using this exact shape per entry:
{"title": string, "company": string, "location": string, "url": string, "postedDate": string, "descriptionRaw": string, "contractType": string, "salaryRange": string}

Rules:
- "url" must be the exact posting URL you fetched, never a search-results or listing page.
- "postedDate" in YYYY-MM-DD format if known, else "".
- "contractType": "CDI", "CDD", "freelance" or "internship" only if explicitly stated, else "".
- Omit any posting you could not fetch and verify.
- Return [] if nothing relevant and verifiable was found — never invent a result.`;
}

function normalizeSearchResult(item) {
    return {
        title: item.title,
        company: item.company,
        location: item.location || undefined,
        url: item.url,
        postedDate: item.postedDate || undefined,
        descriptionRaw: item.descriptionRaw || undefined,
        contractType: CONTRACT_TYPES.includes(item.contractType) ? item.contractType : undefined,
        salaryRange: item.salaryRange || undefined,
    };
}

// Called once per scrape run with the full jobTitles/locations arrays (not once per
// query like the HTTP-API portals) — a `claude -p` invocation is its own multi-second
// process, so looping it per job title would be needlessly slow.
export async function searchAll({ jobTitles, locations }) {
    if (!jobTitles || jobTitles.length === 0) return [];

    const text = await runClaude(buildSearchPrompt(jobTitles, locations), 'WebSearch,WebFetch');

    let parsed;
    try {
        parsed = JSON.parse(stripCodeFence(text));
    } catch {
        return []; // Not parseable — degrade to "nothing found" rather than throw.
    }
    if (!Array.isArray(parsed)) return [];

    return parsed
        .filter((item) => item && typeof item.title === 'string' && item.title.trim() && typeof item.company === 'string' && item.company.trim() && typeof item.url === 'string' && item.url.trim())
        .map(normalizeSearchResult);
}

// ─── Keyword expansion ──────────────────────────────────────────────────────────

function buildExpandPrompt(jobTitles) {
    return `You help widen a job search net. Given the target job titles below (what a job seeker is actually looking for), generate closely related job titles/keywords that real job postings for the same kind of role commonly use — synonyms, common French/English variants, adjacent seniority levels. Stay strictly on-topic: never suggest a genuinely different job family.

Target job titles: ${jobTitles.join(', ')}

Return ONLY valid JSON, no markdown: {"keywords": string[]} — at most 10 additional keywords, do not repeat the originals.`;
}

// Returns the combined, deduped list (originals + expansion) ready to use directly as
// the run's search titles — not just the additions — so callers don't need to merge
// it themselves. Degrades to the unchanged input on any failure (unparsable output,
// CLI error) rather than losing the run.
export async function expandKeywords(jobTitles) {
    if (!jobTitles || jobTitles.length === 0) return [];

    let text;
    try {
        text = await runClaude(buildExpandPrompt(jobTitles), '');
    } catch (err) {
        console.error('Keyword expansion via claude CLI failed; using the configured titles only.', err);
        return jobTitles;
    }

    let parsed;
    try {
        parsed = JSON.parse(stripCodeFence(text));
    } catch {
        return jobTitles;
    }
    const additional = Array.isArray(parsed.keywords) ? parsed.keywords : [];
    const existing = new Set(jobTitles.map((t) => t.toLowerCase()));
    const deduped = additional
        .filter((k) => typeof k === 'string' && k.trim().length > 0 && !existing.has(k.toLowerCase()))
        .slice(0, MAX_EXPANDED_KEYWORDS);
    return [...jobTitles, ...deduped];
}

// ─── Candidate qualification ─────────────────────────────────────────────────────

// Location is judged here (not filtered server-side, for the HTTP-API portals): France
// Travail's own commune/departement/region params require numeric INSEE-style codes,
// not free-text place names like SearchPreferences.locations stores ("Paris", "Remote
// France") — sending one as a query param 400s (see franceTravail.js) — so an
// off-location result only gets caught at this qualification step instead.
//
// When the candidate's own CV is provided (see cvText below), CV-to-posting fit
// becomes the primary signal — title/location match alone isn't enough if the
// posting's actual requirements are a poor match for the candidate's background.
const QUALIFY_PROMPT_BASE = `You are screening scraped job postings against what a job seeker actually wants. For each candidate below, give it a fit score from 0 to 100 (100 = perfect match) based on how well it matches the target job titles and, when a list of acceptable locations is given, whether its location is compatible — treat any "Remote"/"Remote France"-style target as satisfied by any remote-friendly posting.

When a list of acceptable work modes (onsite/hybrid/remote) is given, also judge whether the posting's actual work arrangement — inferred from its location and description text — is compatible. Only judge this when the text gives a clear signal (an explicit "on-site only"/"présentiel"/"no remote" statement for onsite, "hybrid"/"hybride"/"X days remote" for hybrid, "full remote"/"100% remote"/"télétravail total" for remote) — never guess from silence. A clearly incompatible work mode (e.g. the posting is on-site only but "onsite" isn't in the acceptable list) counts against the score the same way an incompatible location does, and must produce its own negative signal naming the mismatch (e.g. {"label": "Sur site uniquement", "polarity": "negative"}).
- 90-100: clearly the same kind of role, in an acceptable location and work mode (or no such constraint given), with strong signals in the description
- 45-89: plausibly relevant/adjacent role, or a matching role in a location/work-mode that's a stretch but not clearly wrong, or missing information that would confirm a strong match
- 0-44: off-topic job family, or a genuinely wrong location or work mode for the role

Also return 2-4 short "signals" per candidate: brief (1-3 word) tags explaining the score, each tagged "positive" (a concrete reason it's a good match — a matched skill/keyword, seniority match, remote/location/work-mode match), "negative" (a concrete concern — missing eval/unclear seniority, undesirable structure like "ESN"/"régie", stale posting, incompatible work mode), or "neutral" (a factual note that's neither, e.g. a city name). Never invent a signal not supported by the posting text given.

Return ONLY valid JSON, no markdown: {"results": [{"id": string, "score": number, "signals": [{"label": string, "polarity": "positive"|"negative"|"neutral"}]}]} — exactly one entry per candidate id listed, in any order.`;

const QUALIFY_PROMPT_WITH_CV_ADDENDUM = `

The job seeker's own CV is provided below. Use it as the primary signal: judge how well their actual skills and experience match each posting's stated requirements, not just whether the title/location line up.
- A high score (90-100) now additionally requires a strong match between the CV and the posting's requirements
- A mid score (45-89) means a role/location match but only a partial or unclear fit with the CV, or vice versa
- A low score (0-44) now also covers a posting whose core requirements the CV clearly doesn't meet, even if the title matches
Include a signal reflecting the CV match specifically (e.g. {"label": "CV aligné", "polarity": "positive"} or {"label": "Écart CV", "polarity": "negative"}).`;

function buildQualifyPrompt(jobTitles, locations, cvText, workModes, batch) {
    const candidatesText = batch
        .map(
            (c) =>
                `- id: ${c.id}\n  title: ${c.title}\n  company: ${c.company}\n  location: ${c.location ?? ''}\n  description: ${(c.descriptionRaw ?? '').slice(0, DESCRIPTION_EXCERPT_LENGTH)}`
        )
        .join('\n');
    const locationsSection = locations.length > 0 ? `\n\n== ACCEPTABLE LOCATIONS ==\n${locations.join('\n')}` : '';
    const workModesSection = workModes.length > 0 ? `\n\n== ACCEPTABLE WORK MODES ==\n${workModes.join('\n')}` : '';
    const cvSection = cvText ? `\n\n== CANDIDATE'S CV ==\n${cvText}` : '';
    const prompt = cvText ? QUALIFY_PROMPT_BASE + QUALIFY_PROMPT_WITH_CV_ADDENDUM : QUALIFY_PROMPT_BASE;
    return `${prompt}\n\n== TARGET JOB TITLES ==\n${jobTitles.join('\n')}${locationsSection}${workModesSection}${cvSection}\n\n== CANDIDATES ==\n${candidatesText}`;
}

const MAX_SIGNALS = 4;
const MAX_SIGNAL_LABEL_LENGTH = 40;

/** @returns {Record<string, {fit: string, score: number, signals: {label: string, polarity: string}[]}>} */
function toQualifyMap(results) {
    const map = {};
    if (!Array.isArray(results)) return map;
    for (const r of results) {
        if (!r || typeof r.id !== 'string' || typeof r.score !== 'number' || Number.isNaN(r.score)) continue;
        const score = Math.max(0, Math.min(100, Math.round(r.score)));
        const signals = Array.isArray(r.signals)
            ? r.signals
                  .filter((s) => s && typeof s.label === 'string' && s.label.trim() && ['positive', 'negative', 'neutral'].includes(s.polarity))
                  .slice(0, MAX_SIGNALS)
                  .map((s) => ({ label: s.label.trim().slice(0, MAX_SIGNAL_LABEL_LENGTH), polarity: s.polarity }))
            : [];
        map[r.id] = { fit: fitFromScore(score), score, signals };
    }
    return map;
}

async function qualifyBatch(jobTitles, locations, cvText, workModes, batch) {
    const text = await runClaude(buildQualifyPrompt(jobTitles, locations, cvText, workModes, batch), '');
    let parsed;
    try {
        parsed = JSON.parse(stripCodeFence(text));
    } catch {
        return {};
    }
    return toQualifyMap(parsed.results);
}

// Judges each candidate against `jobTitles`/`locations`/`workModes` (pass the user's
// *original* configured preferences, not an AI-expanded keyword list — see
// expandKeywords above), and optionally against the job seeker's own CV (`cvText` —
// the client serializes it once via services/aiService.ts's serializeCVForATS and
// sends the resulting text) for a genuine CV-to-posting fit judgment instead of
// title/location/work-mode keyword matching alone.
//
// Processes in batches so each prompt/response stays a reasonable size regardless of
// how many candidates a scrape run returned. Each batch is an independent CLI call —
// if one fails partway through a large run, it must not discard every earlier batch's
// already-computed results, so failures are caught and logged per batch rather than
// aborting the whole pass (mirrors the per-portal isolation in this module's
// runScrape orchestrator).
/** @returns {Promise<Record<string, {fit: string, score: number, signals: {label: string, polarity: string}[]}>>} */
export async function qualifyAll(candidates, jobTitles, locations, cvText, workModes = []) {
    if (!candidates || candidates.length === 0 || !jobTitles || jobTitles.length === 0) return {};

    const batches = [];
    for (let i = 0; i < candidates.length; i += QUALIFY_BATCH_SIZE) {
        batches.push(candidates.slice(i, i + QUALIFY_BATCH_SIZE));
    }

    const qualifyMap = {};
    for (const batch of batches) {
        try {
            Object.assign(qualifyMap, await qualifyBatch(jobTitles, locations, cvText, workModes, batch));
        } catch (err) {
            console.error(`Qualification batch failed via claude CLI (${batch.length} candidates left unfiltered):`, err);
        }
    }
    return qualifyMap;
}
