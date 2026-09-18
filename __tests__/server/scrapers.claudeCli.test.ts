import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openObservabilityDb, listCalls, getCallDetail } from '../../server/observabilityStore.js';
import { getProgress, startRun } from '../../server/scraperProgress.js';

const mockExecFile = vi.fn();
const mockSpawn = vi.fn();

// child_process.execFile is wrapped with util.promisify in claudeCli.js — promisify
// reads the `util.promisify.custom` symbol or falls back to treating the last
// argument as a (err, ...results) callback. Mocking the callback form here keeps this
// test decoupled from Node's internal promisify implementation details. Used by
// expandKeywords/qualifyAll only — searchAll uses spawn (mocked below) so it can stream
// progress instead of waiting for the whole call to finish.
vi.mock('child_process', () => ({
    execFile: (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void
    ) => {
        mockExecFile(_file, _args, _options)
            .then((result: { stdout: string }) => callback(null, { stdout: result.stdout, stderr: '' }))
            .catch((err: Error) => callback(err));
    },
    spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const { searchAll, expandKeywords, qualifyAll, configureObservability } = await import('../../server/scrapers/claudeCli.js');

function cliJsonResult(result: string, overrides: Record<string, unknown> = {}) {
    return JSON.stringify({ is_error: false, subtype: 'success', result, ...overrides });
}

// A minimal stand-in for Node's ChildProcess as returned by `spawn` — real Readable
// streams for stdout/stderr (readline.createInterface in claudeCli.js needs a genuine
// stream, not just an event emitter), emitting `lines` asynchronously to mimic actual
// streaming rather than delivering everything before the test can even register its
// 'line' listener.
function makeFakeChild(lines: object[], { exitCode = 0, emitError }: { exitCode?: number; emitError?: Error } = {}) {
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable };
    child.stdout = stdout;
    child.stderr = stderr;

    queueMicrotask(async () => {
        if (emitError) {
            child.emit('error', emitError);
            return;
        }
        for (const line of lines) {
            stdout.push(`${JSON.stringify(line)}\n`);
            await new Promise((r) => setImmediate(r));
        }
        stdout.push(null);
        stderr.push(null);
        child.emit('close', exitCode);
    });

    return child;
}

// A stream-json "result" event carrying the same fields claudeCli.js's
// runClaudeStreaming reads off it.
function resultEvent(result: string, overrides: Record<string, unknown> = {}) {
    return { type: 'result', is_error: false, subtype: 'success', result, num_turns: 1, ...overrides };
}

function toolUseEvent(id: string, name: string, input: Record<string, unknown>) {
    return { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } };
}

function toolResultEvent(toolUseId: string, text: string) {
    return { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text }] }] } };
}

beforeEach(() => {
    mockExecFile.mockReset();
    mockSpawn.mockReset();
});

describe('searchAll (claudeCli)', () => {
    it('never invokes the CLI when no job titles are given', async () => {
        expect(await searchAll({ jobTitles: [], locations: [] })).toEqual([]);
        expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('invokes claude with -p, --output-format stream-json, and a restricted, pre-approved WebSearch/WebFetch toolset', async () => {
        mockSpawn.mockReturnValue(makeFakeChild([resultEvent('[]')]));

        await searchAll({ jobTitles: ['QA Engineer'], locations: ['Paris'] });

        const [bin, args] = mockSpawn.mock.calls[0];
        expect(bin).toBe('claude');
        expect(args).toContain('-p');
        expect(args).toContain('--output-format');
        expect(args).toContain('stream-json');
        const toolsIndex = args.indexOf('--tools');
        expect(args[toolsIndex + 1]).toBe('WebSearch,WebFetch');
        const allowedToolsIndex = args.indexOf('--allowedTools');
        expect(args[allowedToolsIndex + 1]).toBe('WebSearch,WebFetch');
        // Never a permission-bypass mode — Claude Code refuses those when running as
        // root (this app's container has no USER directive).
        expect(args).not.toContain('--permission-mode');
        expect(args).not.toContain('--dangerously-skip-permissions');
    });

    it('passes a --max-budget-usd cost ceiling', async () => {
        mockSpawn.mockReturnValue(makeFakeChild([resultEvent('[]')]));
        await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        const [, args] = mockSpawn.mock.calls[0];
        const budgetIndex = args.indexOf('--max-budget-usd');
        expect(budgetIndex).toBeGreaterThan(-1);
        expect(Number(args[budgetIndex + 1])).toBeGreaterThan(0);
    });

    it('uses a custom maxBudgetUsd when the caller provides one, instead of the env-derived default', async () => {
        mockSpawn.mockReturnValue(makeFakeChild([resultEvent('[]')]));
        await searchAll({ jobTitles: ['QA Engineer'], locations: [], maxBudgetUsd: 0.75 });
        const [, args] = mockSpawn.mock.calls[0];
        const budgetIndex = args.indexOf('--max-budget-usd');
        expect(args[budgetIndex + 1]).toBe('0.75');
    });

    it('never steers the search toward a site known to block automated fetches (found via live testing: welcometothejungle.com/apec.fr both fail to fetch)', async () => {
        mockSpawn.mockReturnValue(makeFakeChild([resultEvent('[]')]));
        await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        const [, args] = mockSpawn.mock.calls[0];
        const prompt = args[1] as string;
        expect(prompt).not.toContain('welcometothejungle.com');
        expect(prompt).not.toContain('apec.fr');
    });

    it('tells the model to stop retrying a failing URL rather than exhausting stale search results', async () => {
        mockSpawn.mockReturnValue(makeFakeChild([resultEvent('[]')]));
        await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        const [, args] = mockSpawn.mock.calls[0];
        const prompt = args[1] as string;
        expect(prompt).toContain('do NOT retry that same URL');
    });

    it('strips ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN from the child env so the CLI uses the mounted OAuth session, not this app\'s own API key', async () => {
        const originalApiKey = process.env.ANTHROPIC_API_KEY;
        const originalAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
        process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-be-forwarded';
        process.env.ANTHROPIC_AUTH_TOKEN = 'token-should-not-be-forwarded';
        try {
            mockSpawn.mockReturnValue(makeFakeChild([resultEvent('[]')]));
            await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
            const [, , options] = mockSpawn.mock.calls[0];
            expect((options as { env: Record<string, string> }).env).not.toHaveProperty('ANTHROPIC_API_KEY');
            expect((options as { env: Record<string, string> }).env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
        } finally {
            if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
            else process.env.ANTHROPIC_API_KEY = originalApiKey;
            if (originalAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
            else process.env.ANTHROPIC_AUTH_TOKEN = originalAuthToken;
        }
    });

    it('parses the final result event\'s .result field into normalized candidates', async () => {
        const postings = [
            {
                title: 'QA Engineer',
                company: 'Acme',
                location: 'Paris',
                url: 'https://example.test/jobs/1',
                postedDate: '2026-01-02',
                descriptionRaw: 'Great QA role.',
                contractType: 'CDI',
                salaryRange: '45k-55k',
            },
        ];
        mockSpawn.mockReturnValue(makeFakeChild([resultEvent(JSON.stringify(postings))]));

        const results = await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        expect(results).toEqual([
            {
                title: 'QA Engineer',
                company: 'Acme',
                location: 'Paris',
                url: 'https://example.test/jobs/1',
                postedDate: '2026-01-02',
                descriptionRaw: 'Great QA role.',
                contractType: 'CDI',
                salaryRange: '45k-55k',
            },
        ]);
    });

    it('drops an invalid contractType rather than passing it through', async () => {
        mockSpawn.mockReturnValue(
            makeFakeChild([resultEvent(JSON.stringify([{ title: 'QA', company: 'Acme', url: 'https://x/1', contractType: 'bogus' }]))])
        );
        const results = await searchAll({ jobTitles: ['QA'], locations: [] });
        expect(results[0].contractType).toBeUndefined();
    });

    it('strips a ```json code fence from .result before parsing', async () => {
        mockSpawn.mockReturnValue(
            makeFakeChild([resultEvent('```json\n[{"title":"QA","company":"Acme","url":"https://x/1"}]\n```')])
        );
        const results = await searchAll({ jobTitles: ['QA'], locations: [] });
        expect(results).toHaveLength(1);
    });

    it('drops entries missing a title, company, or url', async () => {
        mockSpawn.mockReturnValue(
            makeFakeChild([
                resultEvent(
                    JSON.stringify([
                        { title: 'QA Engineer', company: 'Acme', url: 'https://x/1' },
                        { title: '', company: 'Acme', url: 'https://x/2' },
                        { title: 'QA Engineer', company: '', url: 'https://x/3' },
                        { title: 'QA Engineer', company: 'Acme', url: '' },
                    ])
                ),
            ])
        );
        const results = await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        expect(results).toHaveLength(1);
        expect(results[0].url).toBe('https://x/1');
    });

    it('returns [] when .result is not valid JSON, rather than throwing', async () => {
        mockSpawn.mockReturnValue(makeFakeChild([resultEvent('Sorry, nothing structured to report.')]));
        await expect(searchAll({ jobTitles: ['QA Engineer'], locations: [] })).resolves.toEqual([]);
    });

    it('throws when the CLI envelope itself reports is_error: true', async () => {
        mockSpawn.mockReturnValue(makeFakeChild([{ type: 'result', is_error: true, subtype: 'error_max_turns', result: null }]));
        await expect(searchAll({ jobTitles: ['QA Engineer'], locations: [] })).rejects.toThrow('claude CLI reported an error');
    });

    it('throws a descriptive error when the subprocess itself fails (e.g. binary not found)', async () => {
        mockSpawn.mockReturnValue(makeFakeChild([], { emitError: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) }));
        await expect(searchAll({ jobTitles: ['QA Engineer'], locations: [] })).rejects.toThrow('claude CLI invocation failed');
    });

    it('throws when the process exits without ever emitting a result event', async () => {
        mockSpawn.mockReturnValue(makeFakeChild([]));
        await expect(searchAll({ jobTitles: ['QA Engineer'], locations: [] })).rejects.toThrow('claude CLI invocation failed');
    });

    it('ignores a stray non-JSON line instead of aborting the run', async () => {
        const stdout = new Readable({ read() {} });
        const stderr = new Readable({ read() {} });
        const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable };
        child.stdout = stdout;
        child.stderr = stderr;
        mockSpawn.mockReturnValue(child);

        queueMicrotask(async () => {
            stdout.push('not json at all\n');
            await new Promise((r) => setImmediate(r));
            stdout.push(`${JSON.stringify(resultEvent('[]'))}\n`);
            stdout.push(null);
            stderr.push(null);
            child.emit('close', 0);
        });

        await expect(searchAll({ jobTitles: ['QA Engineer'], locations: [] })).resolves.toEqual([]);
    });
});

describe('searchAll live progress (claudeCli)', () => {
    beforeEach(() => startRun());

    it('pushes a pending event for a WebSearch tool call, describing the query', async () => {
        mockSpawn.mockReturnValue(makeFakeChild([toolUseEvent('t1', 'WebSearch', { query: 'QA Engineer Paris' }), resultEvent('[]')]));
        await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        const { events } = getProgress();
        expect(events[0]).toMatchObject({ message: 'Searching: QA Engineer Paris', status: 'pending' });
    });

    // The "done" line is deliberately worded differently from the "pending" line for
    // the same call — found via live testing (a user report) that identical text for
    // both reads as a literal duplicate call once you strip the icon (e.g. a plain
    // copy-paste of the feed), when it's actually one call shown at two points in time.
    it('pushes a "done" event for a WebFetch that succeeds, worded differently from the pending line', async () => {
        mockSpawn.mockReturnValue(
            makeFakeChild([
                toolUseEvent('t1', 'WebFetch', { url: 'https://example.test/jobs/1' }),
                toolResultEvent('t1', 'Job Title: QA Engineer at Acme.'),
                resultEvent('[]'),
            ])
        );
        await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        const { events } = getProgress();
        expect(events[0]).toMatchObject({ message: 'Checking: example.test', status: 'pending' });
        expect(events[1]).toMatchObject({ message: 'Page checked: example.test', status: 'done' });
        expect(events[1].message).not.toBe(events[0].message);
    });

    it('pushes a "failed" event for a WebFetch that 403s, naming the HTTP status', async () => {
        mockSpawn.mockReturnValue(
            makeFakeChild([
                toolUseEvent('t1', 'WebFetch', { url: 'https://www.welcometothejungle.com/jobs/1' }),
                toolResultEvent('t1', 'The server returned HTTP 403 Forbidden.'),
                resultEvent('[]'),
            ])
        );
        await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        const { events } = getProgress();
        expect(events[1]).toMatchObject({ message: 'Failed (HTTP 403): www.welcometothejungle.com', status: 'failed' });
    });

    it('pushes a "done" event for a WebSearch that succeeds, naming the result count instead of repeating the query', async () => {
        mockSpawn.mockReturnValue(
            makeFakeChild([
                toolUseEvent('t1', 'WebSearch', { query: 'QA Engineer Paris' }),
                toolResultEvent('t1', 'Web search results: [{"url":"https://a"},{"url":"https://b"}]'),
                resultEvent('[]'),
            ])
        );
        await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        const { events } = getProgress();
        expect(events[0]).toMatchObject({ message: 'Searching: QA Engineer Paris', status: 'pending' });
        expect(events[1]).toMatchObject({ message: '→ 2 results for: QA Engineer Paris', status: 'done' });
    });
});

describe('expandKeywords (claudeCli)', () => {
    it('never invokes the CLI when no job titles are given', async () => {
        expect(await expandKeywords([])).toEqual([]);
        expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('invokes claude with no tools loaded (plain text-processing call)', async () => {
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult(JSON.stringify({ keywords: [] })) });
        await expandKeywords(['QA Engineer']);
        const [, args] = mockExecFile.mock.calls[0];
        const toolsIndex = args.indexOf('--tools');
        expect(args[toolsIndex + 1]).toBe('');
        expect(args).not.toContain('--allowedTools');
    });

    it('returns the combined, deduped list of originals plus expansion', async () => {
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult(JSON.stringify({ keywords: ['SDET', 'QA Engineer'] })) });
        const result = await expandKeywords(['QA Engineer']);
        expect(result).toEqual(['QA Engineer', 'SDET']);
    });

    it('falls back to the original titles when the CLI invocation fails', async () => {
        mockExecFile.mockRejectedValue(new Error('spawn claude ENOENT'));
        const result = await expandKeywords(['QA Engineer']);
        expect(result).toEqual(['QA Engineer']);
    });

    it('falls back to the original titles when the CLI output is unparsable', async () => {
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult('not json') });
        const result = await expandKeywords(['QA Engineer']);
        expect(result).toEqual(['QA Engineer']);
    });
});

describe('qualifyAll (claudeCli)', () => {
    it('returns an empty map when there are no candidates or no target job titles', async () => {
        expect(await qualifyAll([], ['QA Engineer'], [], undefined)).toEqual({});
        expect(await qualifyAll([{ id: '1', title: 'QA', company: 'Acme' }], [], [], undefined)).toEqual({});
        expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('invokes claude with no tools loaded and maps ids to fit/score/signals', async () => {
        mockExecFile.mockResolvedValue({
            stdout: cliJsonResult(
                JSON.stringify({ results: [{ id: '1', score: 92, signals: [{ label: 'Playwright', polarity: 'positive' }] }] })
            ),
        });
        const result = await qualifyAll([{ id: '1', title: 'QA Engineer', company: 'Acme' }], ['QA Engineer'], [], undefined);
        expect(result).toEqual({ '1': { fit: 'high', score: 92, signals: [{ label: 'Playwright', polarity: 'positive' }] } });
        const [, args] = mockExecFile.mock.calls[0];
        const toolsIndex = args.indexOf('--tools');
        expect(args[toolsIndex + 1]).toBe('');
    });

    it('respects a custom mediumThreshold (SearchPreferences.autoDismissBelowScore) instead of the default 45', async () => {
        mockExecFile.mockResolvedValue({
            stdout: cliJsonResult(JSON.stringify({ results: [{ id: '1', score: 60, signals: [] }] })),
        });
        const defaultResult = await qualifyAll([{ id: '1', title: 'QA Engineer', company: 'Acme' }], ['QA Engineer'], [], undefined);
        expect(defaultResult['1'].fit).toBe('medium'); // 60 >= default 45

        const raisedResult = await qualifyAll(
            [{ id: '1', title: 'QA Engineer', company: 'Acme' }],
            ['QA Engineer'],
            [],
            undefined,
            [],
            [],
            65
        );
        expect(raisedResult['1'].fit).toBe('low'); // 60 < custom 65
    });

    it('includes an ACCEPTABLE WORK MODES section in the prompt when work modes are given', async () => {
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult(JSON.stringify({ results: [{ id: '1', score: 80, signals: [] }] })) });
        await qualifyAll([{ id: '1', title: 'QA Engineer', company: 'Acme' }], ['QA Engineer'], [], undefined, ['hybrid', 'remote']);
        const [, args] = mockExecFile.mock.calls[0];
        const prompt = args[1];
        expect(prompt).toContain('== ACCEPTABLE WORK MODES ==\nhybrid\nremote');
    });

    it('omits the work modes section when none are given', async () => {
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult(JSON.stringify({ results: [{ id: '1', score: 80, signals: [] }] })) });
        await qualifyAll([{ id: '1', title: 'QA Engineer', company: 'Acme' }], ['QA Engineer'], [], undefined);
        const [, args] = mockExecFile.mock.calls[0];
        expect(args[1]).not.toContain('ACCEPTABLE WORK MODES');
    });

    it('includes a PREVIOUSLY REJECTED section listing each past reason when rejection memory is given', async () => {
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult(JSON.stringify({ results: [{ id: '1', score: 80, signals: [] }] })) });
        await qualifyAll(
            [{ id: '1', title: 'QA Engineer', company: 'Acme' }],
            ['QA Engineer'],
            [],
            undefined,
            [],
            [
                { title: 'QA Engineer', company: 'Old Co', reason: 'ESN / régie' },
                { title: 'SDET', company: 'Other Co', reason: 'Salaire trop bas' },
            ]
        );
        const [, args] = mockExecFile.mock.calls[0];
        const prompt = args[1];
        expect(prompt).toContain('== PREVIOUSLY REJECTED BY THIS JOB SEEKER (with their own reasons) ==');
        expect(prompt).toContain('- QA Engineer @ Old Co: ESN / régie');
        expect(prompt).toContain('- SDET @ Other Co: Salaire trop bas');
    });

    it('omits the PREVIOUSLY REJECTED section when there is no rejection memory', async () => {
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult(JSON.stringify({ results: [{ id: '1', score: 80, signals: [] }] })) });
        await qualifyAll([{ id: '1', title: 'QA Engineer', company: 'Acme' }], ['QA Engineer'], [], undefined);
        const [, args] = mockExecFile.mock.calls[0];
        expect(args[1]).not.toContain('PREVIOUSLY REJECTED');
    });

    it('clamps an out-of-range score and drops malformed signals', async () => {
        mockExecFile.mockResolvedValue({
            stdout: cliJsonResult(
                JSON.stringify({
                    results: [
                        {
                            id: '1',
                            score: 142.6,
                            signals: [
                                { label: 'Nantes', polarity: 'neutral' },
                                { label: '', polarity: 'positive' }, // dropped: empty label
                                { label: 'Bogus', polarity: 'sideways' }, // dropped: invalid polarity
                            ],
                        },
                    ],
                })
            ),
        });
        const result = await qualifyAll([{ id: '1', title: 'QA Engineer', company: 'Acme' }], ['QA Engineer'], [], undefined);
        expect(result['1']).toEqual({ fit: 'high', score: 100, signals: [{ label: 'Nantes', polarity: 'neutral' }] });
    });

    // Found via live testing: on a large run (many candidates -> many batches), one
    // batch's CLI call failing partway through used to silently discard every earlier
    // batch's already-computed results, leaving the whole run unqualified instead of
    // "most of it qualified". Batches must be isolated (mirrors the per-portal
    // isolation in server/scrapers/index.js's runScrape).
    it("keeps an earlier batch's results when a later batch's CLI call rejects", async () => {
        const batch1 = Array.from({ length: 25 }, (_, i) => ({ id: `a${i}`, title: 'QA Engineer', company: 'Acme' }));
        const batch2 = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, title: 'QA Engineer', company: 'Acme' }));

        mockExecFile
            .mockResolvedValueOnce({ stdout: cliJsonResult(JSON.stringify({ results: batch1.map((c) => ({ id: c.id, score: 90, signals: [] })) })) })
            .mockRejectedValueOnce(new Error('claude CLI timed out'));

        const result = await qualifyAll([...batch1, ...batch2], ['QA Engineer'], [], undefined);

        expect(mockExecFile).toHaveBeenCalledTimes(2);
        for (const c of batch1) expect(result[c.id].fit).toBe('high');
        for (const c of batch2) expect(result[c.id]).toBeUndefined();
    });
});

describe('observability logging (claudeCli)', () => {
    let tempDir: string;
    let observabilityDb: ReturnType<typeof openObservabilityDb>;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-claudecli-obs-test-'));
        observabilityDb = openObservabilityDb(path.join(tempDir, 'observability.sqlite'));
        configureObservability(observabilityDb);
    });

    afterEach(() => {
        configureObservability(null);
        observabilityDb.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('logs a successful search_all call with provider claude_cli', async () => {
        mockSpawn.mockReturnValue(makeFakeChild([resultEvent('[]')]));
        await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        const [row] = listCalls(observabilityDb);
        expect(row).toMatchObject({ provider: 'claude_cli', operation: 'search_all', status: 'success' });
        expect(row.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('logs a failed expand_keywords call with an error message, without throwing to the caller', async () => {
        mockExecFile.mockRejectedValue(new Error('spawn claude ENOENT'));
        await expandKeywords(['QA Engineer']);
        const [row] = listCalls(observabilityDb);
        expect(row).toMatchObject({ provider: 'claude_cli', operation: 'expand_keywords', status: 'error' });
        expect(row.errorMessage).toContain('claude CLI invocation failed');
    });

    it('logs one row per qualify batch', async () => {
        const batch1 = Array.from({ length: 25 }, (_, i) => ({ id: `a${i}`, title: 'QA Engineer', company: 'Acme' }));
        const batch2 = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, title: 'QA Engineer', company: 'Acme' }));
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult(JSON.stringify({ results: [] })) });

        await qualifyAll([...batch1, ...batch2], ['QA Engineer'], [], undefined);

        const rows = listCalls(observabilityDb);
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.operation === 'qualify' && r.status === 'success')).toBe(true);
    });

    it('reads usage/cost fields from the final result event when present', async () => {
        mockSpawn.mockReturnValue(
            makeFakeChild([resultEvent('[]', { usage: { input_tokens: 120, output_tokens: 40 }, total_cost_usd: 0.002, model: 'claude-sonnet-4-6' })])
        );
        await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        const [row] = listCalls(observabilityDb);
        expect(row.promptTokens).toBe(120);
        expect(row.completionTokens).toBe(40);
        expect(row.totalTokens).toBe(160);
        expect(row.costUsd).toBe(0.002);
    });

    // Found via live testing: a real search_all run can span multiple models (a cheap
    // one executing WebSearch, a pricier one orchestrating) and dozens of turns, none
    // of which the flat prompt/completion token count above captures — this metadata
    // is what actually explains a call's real cost.
    it('logs num_turns, per-model usage, and WebSearch/WebFetch tool-call counts in metadata', async () => {
        mockSpawn.mockReturnValue(
            makeFakeChild([
                toolUseEvent('t1', 'WebSearch', { query: 'QA Engineer' }),
                toolResultEvent('t1', 'Web search results...'),
                toolUseEvent('t2', 'WebFetch', { url: 'https://example.test/1' }),
                toolResultEvent('t2', 'The server returned HTTP 404 Not Found.'),
                resultEvent('[]', {
                    num_turns: 7,
                    modelUsage: { 'claude-haiku-4-5': { inputTokens: 100, outputTokens: 10, webSearchRequests: 1, costUSD: 0.01 } },
                }),
            ])
        );
        await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        const [row] = listCalls(observabilityDb);
        expect(row.metadata).toMatchObject({
            numTurns: 7,
            webSearchCount: 1,
            webFetchCount: 1,
            webFetchFailures: 1,
            modelUsage: { 'claude-haiku-4-5': { inputTokens: 100, outputTokens: 10, webSearchRequests: 1, costUSD: 0.01 } },
        });
    });

    it('does not throw and does not log when no observability db is configured', async () => {
        configureObservability(null);
        mockSpawn.mockReturnValue(makeFakeChild([resultEvent('[]')]));
        await expect(searchAll({ jobTitles: ['QA Engineer'], locations: [] })).resolves.toEqual([]);
    });
});

describe('observability full prompt/response/error/step-trace capture (claudeCli)', () => {
    let tempDir: string;
    let observabilityDb: ReturnType<typeof openObservabilityDb>;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarb-claudecli-detail-test-'));
        observabilityDb = openObservabilityDb(path.join(tempDir, 'observability.sqlite'));
        configureObservability(observabilityDb);
    });

    afterEach(() => {
        configureObservability(null);
        observabilityDb.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('runClaude (buffered) success logs the full prompt and responseText', async () => {
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult(JSON.stringify({ keywords: ['SDET'] })) });
        await expandKeywords(['QA Engineer']);
        const [row] = listCalls(observabilityDb);
        const detail = getCallDetail(observabilityDb, row.id)!;
        expect(detail.prompt).toContain('QA Engineer');
        expect(detail.responseText).toBe(JSON.stringify({ keywords: ['SDET'] }));
    });

    it('runClaude logs the raw unparsable stdout as errorDetail', async () => {
        mockExecFile.mockResolvedValue({ stdout: 'not json at all' });
        await expandKeywords(['QA Engineer']);
        const [row] = listCalls(observabilityDb);
        const detail = getCallDetail(observabilityDb, row.id)!;
        expect(detail.errorDetail).toBe('not json at all');
    });

    it('runClaude logs the full JSON error envelope as errorDetail when the CLI reports is_error', async () => {
        mockExecFile.mockResolvedValue({ stdout: JSON.stringify({ is_error: true, subtype: 'error_max_turns', result: null }) });
        await expandKeywords(['QA Engineer']);
        const [row] = listCalls(observabilityDb);
        const detail = getCallDetail(observabilityDb, row.id)!;
        expect(JSON.parse(detail.errorDetail)).toMatchObject({ is_error: true, subtype: 'error_max_turns' });
    });

    it('runClaude captures .stdout/.stderr from an exec error into errorDetail', async () => {
        mockExecFile.mockRejectedValue(Object.assign(new Error('Command failed'), { stdout: 'partial output', stderr: 'some warning' }));
        await expandKeywords(['QA Engineer']);
        const [row] = listCalls(observabilityDb);
        const detail = getCallDetail(observabilityDb, row.id)!;
        expect(detail.errorDetail).toContain('partial output');
        expect(detail.errorDetail).toContain('some warning');
    });

    it('runClaudeStreaming success persists an ordered stepTrace as its own field, not inside metadata', async () => {
        mockSpawn.mockReturnValue(
            makeFakeChild([
                toolUseEvent('t1', 'WebSearch', { query: 'QA Engineer Paris' }),
                toolResultEvent('t1', 'Web search results: [{"url":"https://a"}]'),
                toolUseEvent('t2', 'WebFetch', { url: 'https://example.test/1' }),
                toolResultEvent('t2', 'The server returned HTTP 404 Not Found.'),
                resultEvent('[]'),
            ])
        );
        await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        const [row] = listCalls(observabilityDb);
        const detail = getCallDetail(observabilityDb, row.id)!;
        expect(detail.metadata).not.toHaveProperty('steps');
        expect(detail.metadata).not.toHaveProperty('stepTrace');
        expect(detail.stepTrace).toEqual([
            { seq: 1, at: expect.any(String), tool: 'WebSearch', input: { query: 'QA Engineer Paris' }, status: 'done', resultSnippet: expect.stringContaining('https://a') },
            { seq: 2, at: expect.any(String), tool: 'WebFetch', input: { url: 'https://example.test/1' }, status: 'failed', resultSnippet: expect.stringContaining('HTTP 404') },
        ]);
        expect(detail.prompt).toContain('QA Engineer');
        expect(detail.responseText).toBe('[]');
    });

    it('runClaudeStreaming close-without-resultEvent logs the full stderr as errorDetail and the steps that ran before it died', async () => {
        const stdout = new Readable({ read() {} });
        const stderr = new Readable({ read() {} });
        const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable };
        child.stdout = stdout;
        child.stderr = stderr;
        mockSpawn.mockReturnValue(child);

        queueMicrotask(async () => {
            stdout.push(`${JSON.stringify(toolUseEvent('t1', 'WebSearch', { query: 'QA Engineer' }))}\n`);
            await new Promise((r) => setImmediate(r));
            stderr.push('budget exceeded after 14 tool calls\n');
            stdout.push(null);
            stderr.push(null);
            child.emit('close', 1);
        });

        await expect(searchAll({ jobTitles: ['QA Engineer'], locations: [] })).rejects.toThrow('claude CLI invocation failed');
        const [row] = listCalls(observabilityDb);
        const detail = getCallDetail(observabilityDb, row.id)!;
        expect(detail.errorDetail).toContain('budget exceeded after 14 tool calls');
        expect(detail.stepTrace).toHaveLength(1);
        expect(detail.stepTrace[0]).toMatchObject({ tool: 'WebSearch', status: 'pending' });
    });

    it('runClaudeStreaming resultEvent.is_error logs the full envelope as errorDetail', async () => {
        mockSpawn.mockReturnValue(makeFakeChild([{ type: 'result', is_error: true, subtype: 'error_max_turns', result: null }]));
        await expect(searchAll({ jobTitles: ['QA Engineer'], locations: [] })).rejects.toThrow('claude CLI reported an error');
        const [row] = listCalls(observabilityDb);
        const detail = getCallDetail(observabilityDb, row.id)!;
        expect(JSON.parse(detail.errorDetail)).toMatchObject({ is_error: true, subtype: 'error_max_turns' });
    });
});
