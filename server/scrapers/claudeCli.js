// Shells out to the `claude` CLI already installed on the user's machine (Claude
// Code) for every job-search AI step — instead of calling the Anthropic/Gemini APIs
// directly with a separate billed key. No separate rate limit or API key to manage:
// it uses whatever auth the CLI already has (subscription or otherwise). Used for:
// - searchAll: Claude Code's own built-in WebSearch/WebFetch tools, mirroring
//   ai-job-search's WebSearch fallback. Deliberately does NOT steer the search toward
//   any specific site — welcometothejungle.com/apec.fr were tried and dropped (see
//   buildSearchPrompt) because their pages 403/can't be fetched, making a forced
//   `site:` query on either pure wasted search+fetch budget by construction.
// - expandKeywords / qualifyAll: plain text-in/JSON-out calls (no tools needed) for
//   widening the search net and judging each candidate's fit — previously done via
//   services/aiService.ts's direct Gemini/Claude API calls (see git history), moved
//   here so the whole job-search pipeline rides on the one CLI mechanism.
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { createInterface } from 'readline';
import { randomUUID } from 'crypto';
import { fitFromScore } from './scraperFit.js';
import { insertCall } from '../observabilityStore.js';
import { pushEvent } from '../scraperProgress.js';

const execFileAsync = promisify(execFile);

export const id = 'claude_cli';

// Set once at server boot (server.js) so runClaude below can log every invocation to
// the Observability page's store — module-level rather than threaded through every
// exported function's signature, so searchAll/expandKeywords/qualifyAll keep the same
// public API existing callers (and __tests__/server/scrapers.claudeCli.test.ts) rely
// on. Left null in tests, which never call this — logging is skipped, not errored, in
// that case (see the `if (!observabilityDb) return` guard in logCall below).
let observabilityDb = null;
export function configureObservability(db) {
    observabilityDb = db;
}

// Never let a logging failure break the actual scrape/qualify/search flow — this is
// purely observational.
function logCall({ operation, model, startedAt, status, errorMessage, usage, costUsd, metadata }) {
    if (!observabilityDb) return;
    try {
        insertCall(observabilityDb, {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            provider: 'claude_cli',
            operation,
            model,
            durationMs: Date.now() - startedAt,
            status,
            errorMessage,
            promptTokens: usage?.input_tokens,
            completionTokens: usage?.output_tokens,
            totalTokens: usage ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) : undefined,
            costUsd,
            metadata,
        });
    } catch (err) {
        console.error('Failed to log claude CLI call to the observability store:', err);
    }
}

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
// Hard cost ceiling for searchAll specifically — found via live testing that an
// unbounded search (retrying dead-end WebFetch URLs, following stale search results)
// can spend well over $1 finding a single verified posting. `--max-budget-usd` makes
// the CLI itself stop once spent cost crosses this, instead of only the (much
// coarser) TIMEOUT_MS wall-clock cutoff below. Configurable since a real multi-title
// run's legitimate cost varies with how many job titles are searched at once.
const SEARCH_MAX_BUDGET_USD = Number(process.env.SCRAPER_SEARCH_MAX_BUDGET_USD ?? 3);
const MAX_PROGRESS_MESSAGE_LENGTH = 140;

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
async function runClaude(prompt, tools, operation, metadata) {
    const { ANTHROPIC_API_KEY: _unused1, ANTHROPIC_AUTH_TOKEN: _unused2, ...cliEnv } = process.env;
    const startedAt = Date.now();

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
        logCall({ operation, startedAt, status: 'error', errorMessage: `claude CLI invocation failed: ${err.message}`, metadata });
        throw new Error(`claude CLI invocation failed: ${err.message}`);
    }

    let payload;
    try {
        payload = JSON.parse(stdout);
    } catch {
        logCall({ operation, startedAt, status: 'error', errorMessage: 'claude CLI returned unparsable output', metadata });
        throw new Error('claude CLI returned unparsable output');
    }
    if (payload.is_error) {
        const errorMessage = payload.result ?? payload.subtype ?? 'unknown';
        logCall({ operation, startedAt, status: 'error', errorMessage: `claude CLI reported an error: ${errorMessage}`, model: payload.model, metadata });
        throw new Error(`claude CLI reported an error: ${errorMessage}`);
    }
    // `--output-format json`'s envelope carries more than `.result`/`.is_error` (the
    // only fields read above) — `usage`/`total_cost_usd`/`model` when the installed CLI
    // version reports them. Read defensively: a missing/renamed field must never break
    // the call, it just means that call's row has no token/cost figures.
    logCall({ operation, startedAt, status: 'success', model: payload.model, usage: payload.usage, costUsd: payload.total_cost_usd, metadata });
    return payload.result ?? '';
}

function truncate(text, maxLength) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

// Human-readable one-liner for a WebSearch/WebFetch tool call, pushed to
// scraperProgress.js as it happens — surfaced live in the UI (see
// store/scraperStore.ts) instead of a static spinner for what can take minutes.
function describeToolUse(name, input) {
    if (name === 'WebSearch') return truncate(`Recherche : ${input?.query ?? ''}`, MAX_PROGRESS_MESSAGE_LENGTH);
    if (name === 'WebFetch') {
        let host = input?.url ?? '';
        try {
            host = new URL(input.url).hostname;
        } catch {
            // Not a valid absolute URL — fall back to the raw string above.
        }
        return truncate(`Vérification : ${host}`, MAX_PROGRESS_MESSAGE_LENGTH);
    }
    return name;
}

// Best-effort text extraction from a `tool_result` content block, which is either a
// plain string or an array of {type:"text", text} blocks depending on the tool.
function toolResultText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map((block) => (block && typeof block.text === 'string' ? block.text : '')).join(' ');
}

// Matches the concrete failure modes seen in live testing (see buildSearchPrompt's
// "be efficient" guidance, added for exactly these): a blocked/nonexistent page, or a
// redirect WebFetch didn't resolve on its own — never a false positive on genuine
// posting content, which wouldn't contain these exact phrases.
const FETCH_FAILURE_PATTERN = /HTTP 4\d\d|HTTP 5\d\d|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|REDIRECT DETECTED/;

// Runs one `claude -p` turn in --output-format stream-json, parsing each NDJSON event
// as it arrives (rather than buffering the whole run like runClaude above) — the only
// way to get live progress out of a call that can run for several minutes. Used by
// searchAll only: it's the one operation with tool calls worth narrating (WebSearch/
// WebFetch) and long enough to need it; expandKeywords/qualifyAll stay on the simpler
// buffered runClaude.
function runClaudeStreaming(prompt, tools, operation, { maxBudgetUsd } = {}) {
    const { ANTHROPIC_API_KEY: _unused1, ANTHROPIC_AUTH_TOKEN: _unused2, ...cliEnv } = process.env;
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
        const child = spawn(
            CLAUDE_BIN,
            [
                '-p', prompt,
                '--output-format', 'stream-json',
                '--verbose',
                '--tools', tools,
                ...(tools ? ['--allowedTools', tools] : []),
                '--no-session-persistence',
                '--strict-mcp-config',
                ...(maxBudgetUsd ? ['--max-budget-usd', String(maxBudgetUsd)] : []),
            ],
            { timeout: TIMEOUT_MS, env: cliEnv }
        );

        let resultEvent = null;
        let webSearchCount = 0;
        let webFetchCount = 0;
        let webFetchFailures = 0;
        // Maps a tool_use's id to its human-readable label, so the later tool_result
        // event (which only carries the id) can be narrated with the same wording.
        const labelByToolUseId = new Map();
        let stderrText = '';

        child.stderr.on('data', (chunk) => {
            stderrText += chunk;
        });

        const lines = createInterface({ input: child.stdout });
        lines.on('line', (line) => {
            if (!line.trim()) return;
            let event;
            try {
                event = JSON.parse(line);
            } catch {
                return; // A stray non-JSON line must never abort an otherwise-healthy run.
            }

            if (event.type === 'assistant') {
                for (const block of event.message?.content ?? []) {
                    if (block.type !== 'tool_use' || (block.name !== 'WebSearch' && block.name !== 'WebFetch')) continue;
                    if (block.name === 'WebSearch') webSearchCount += 1;
                    else webFetchCount += 1;
                    const label = describeToolUse(block.name, block.input);
                    labelByToolUseId.set(block.id, label);
                    pushEvent(label, 'pending');
                }
            } else if (event.type === 'user') {
                for (const block of event.message?.content ?? []) {
                    if (block.type !== 'tool_result') continue;
                    const label = labelByToolUseId.get(block.tool_use_id);
                    if (!label) continue;
                    const failed = FETCH_FAILURE_PATTERN.test(toolResultText(block.content));
                    if (failed) webFetchFailures += 1;
                    pushEvent(label, failed ? 'failed' : 'done');
                }
            } else if (event.type === 'result') {
                resultEvent = event;
            }
        });

        child.on('error', (err) => {
            logCall({ operation, startedAt, status: 'error', errorMessage: `claude CLI invocation failed: ${err.message}` });
            reject(new Error(`claude CLI invocation failed: ${err.message}`));
        });

        child.on('close', (code) => {
            if (!resultEvent) {
                const message = stderrText.trim() || `claude CLI exited with code ${code} before returning a result`;
                logCall({ operation, startedAt, status: 'error', errorMessage: `claude CLI invocation failed: ${message}` });
                reject(new Error(`claude CLI invocation failed: ${message}`));
                return;
            }
            if (resultEvent.is_error) {
                const errorMessage = resultEvent.result ?? resultEvent.subtype ?? 'unknown';
                logCall({ operation, startedAt, status: 'error', errorMessage: `claude CLI reported an error: ${errorMessage}`, model: resultEvent.model });
                reject(new Error(`claude CLI reported an error: ${errorMessage}`));
                return;
            }
            // Richer than runClaude's logCall: num_turns/modelUsage/tool-call counts —
            // found via live testing that a single call can span multiple models
            // (WebSearch summarization on a cheap model, orchestration on a pricier one)
            // and dozens of turns, none of which the flat prompt/completion token count
            // captures. total_cost_usd already accounts for all of it; this metadata
            // explains *why* a call cost what it did.
            logCall({
                operation,
                startedAt,
                status: 'success',
                model: resultEvent.model,
                usage: resultEvent.usage,
                costUsd: resultEvent.total_cost_usd,
                metadata: {
                    numTurns: resultEvent.num_turns,
                    modelUsage: resultEvent.modelUsage,
                    webSearchCount,
                    webFetchCount,
                    webFetchFailures,
                },
            });
            resolve(resultEvent.result ?? '');
        });
    });
}

// ─── Web search (searchAll) ────────────────────────────────────────────────────

function buildSearchPrompt(jobTitles, locations) {
    return `You are helping a job seeker find current openings by searching the live web — the same way a human would manually check job boards that have no public API.

Target job titles: ${jobTitles.join(', ')}
Acceptable locations (if empty, no location constraint): ${locations.join(', ') || '(none)'}

For every promising result, fetch the actual posting page before including it — never report a posting you have not fetched and verified is real and current.

Be efficient — you are on a limited budget:
- If a fetch fails (HTTP 403/404, a DNS error, or a redirect you can't resolve), do NOT retry that same URL. Move on to a different search query or a different candidate result instead.
- Give up on a lead after at most 2 failed fetch attempts on it, rather than working through many stale links from the same search.
- Prefer sources you can actually fetch (company career pages, greenhouse.io, lever.co, francetravail.fr) over ones known to block automated fetches.

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

    const text = await runClaudeStreaming(buildSearchPrompt(jobTitles, locations), 'WebSearch,WebFetch', 'search_all', {
        maxBudgetUsd: SEARCH_MAX_BUDGET_USD,
    });

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
        text = await runClaude(buildExpandPrompt(jobTitles), '', 'expand_keywords');
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

// Appended (not part of QUALIFY_PROMPT_BASE) so the instruction only ever appears
// alongside the list it refers to — same reasoning as QUALIFY_PROMPT_WITH_CV_ADDENDUM
// only appearing alongside a real CV. `rejectionMemory` comes from
// server/scraperCandidatesStore.js's listRejectionReasons: postings this same job
// seeker has already dismissed, with their own short explanation why — captured via
// PATCH /candidates/:id's dismissReason at dismiss time.
function buildRejectionMemorySection(rejectionMemory) {
    if (!rejectionMemory || rejectionMemory.length === 0) return '';
    const lines = rejectionMemory.map((r) => `- ${r.title} @ ${r.company}: ${r.reason}`).join('\n');
    return `\n\n== PREVIOUSLY REJECTED BY THIS JOB SEEKER (with their own reasons) ==\nUse these as negative examples, not a blocklist of exact titles/companies: if a candidate below shares the same underlying disqualifying pattern (e.g. same kind of structure, same stated dealbreaker), score it low and add a signal naming the match (e.g. {"label": "Comme rejet précédent", "polarity": "negative"}). Do not penalize a candidate that merely shares a job title with one of these if the actual reason given doesn't apply to it.\n${lines}`;
}

function buildQualifyPrompt(jobTitles, locations, cvText, workModes, rejectionMemory, batch) {
    const candidatesText = batch
        .map(
            (c) =>
                `- id: ${c.id}\n  title: ${c.title}\n  company: ${c.company}\n  location: ${c.location ?? ''}\n  description: ${(c.descriptionRaw ?? '').slice(0, DESCRIPTION_EXCERPT_LENGTH)}`
        )
        .join('\n');
    const locationsSection = locations.length > 0 ? `\n\n== ACCEPTABLE LOCATIONS ==\n${locations.join('\n')}` : '';
    const workModesSection = workModes.length > 0 ? `\n\n== ACCEPTABLE WORK MODES ==\n${workModes.join('\n')}` : '';
    const cvSection = cvText ? `\n\n== CANDIDATE'S CV ==\n${cvText}` : '';
    const rejectionMemorySection = buildRejectionMemorySection(rejectionMemory);
    const prompt = cvText ? QUALIFY_PROMPT_BASE + QUALIFY_PROMPT_WITH_CV_ADDENDUM : QUALIFY_PROMPT_BASE;
    return `${prompt}\n\n== TARGET JOB TITLES ==\n${jobTitles.join('\n')}${locationsSection}${workModesSection}${cvSection}${rejectionMemorySection}\n\n== CANDIDATES ==\n${candidatesText}`;
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

async function qualifyBatch(jobTitles, locations, cvText, workModes, rejectionMemory, batch) {
    const text = await runClaude(buildQualifyPrompt(jobTitles, locations, cvText, workModes, rejectionMemory, batch), '', 'qualify', {
        batchSize: batch.length,
    });
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
// `rejectionMemory` — {title, company, reason}[] from listRejectionReasons — is the
// same across every batch of one call, same as jobTitles/locations/cvText/workModes.
/** @returns {Promise<Record<string, {fit: string, score: number, signals: {label: string, polarity: string}[]}>>} */
export async function qualifyAll(candidates, jobTitles, locations, cvText, workModes = [], rejectionMemory = []) {
    if (!candidates || candidates.length === 0 || !jobTitles || jobTitles.length === 0) return {};

    const batches = [];
    for (let i = 0; i < candidates.length; i += QUALIFY_BATCH_SIZE) {
        batches.push(candidates.slice(i, i + QUALIFY_BATCH_SIZE));
    }

    const qualifyMap = {};
    for (const batch of batches) {
        try {
            Object.assign(qualifyMap, await qualifyBatch(jobTitles, locations, cvText, workModes, rejectionMemory, batch));
        } catch (err) {
            console.error(`Qualification batch failed via claude CLI (${batch.length} candidates left unfiltered):`, err);
        }
    }
    return qualifyMap;
}
