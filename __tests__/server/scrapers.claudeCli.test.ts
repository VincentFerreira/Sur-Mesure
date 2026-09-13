import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.fn();

// child_process.execFile is wrapped with util.promisify in claudeCli.js — promisify
// reads the `util.promisify.custom` symbol or falls back to treating the last
// argument as a (err, ...results) callback. Mocking the callback form here keeps this
// test decoupled from Node's internal promisify implementation details.
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
}));

const { searchAll, expandKeywords, qualifyAll } = await import('../../server/scrapers/claudeCli.js');

function cliJsonResult(result: string, overrides: Record<string, unknown> = {}) {
    return JSON.stringify({ is_error: false, subtype: 'success', result, ...overrides });
}

beforeEach(() => {
    mockExecFile.mockReset();
});

describe('searchAll (claudeCli)', () => {
    it('never invokes the CLI when no job titles are given', async () => {
        expect(await searchAll({ jobTitles: [], locations: [] })).toEqual([]);
        expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('invokes claude with -p, --output-format json, and a restricted, pre-approved WebSearch/WebFetch toolset', async () => {
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult('[]') });

        await searchAll({ jobTitles: ['QA Engineer'], locations: ['Paris'] });

        const [bin, args] = mockExecFile.mock.calls[0];
        expect(bin).toBe('claude');
        expect(args).toContain('-p');
        expect(args).toContain('--output-format');
        expect(args).toContain('json');
        const toolsIndex = args.indexOf('--tools');
        expect(args[toolsIndex + 1]).toBe('WebSearch,WebFetch');
        const allowedToolsIndex = args.indexOf('--allowedTools');
        expect(args[allowedToolsIndex + 1]).toBe('WebSearch,WebFetch');
        // Never a permission-bypass mode — Claude Code refuses those when running as
        // root (this app's container has no USER directive).
        expect(args).not.toContain('--permission-mode');
        expect(args).not.toContain('--dangerously-skip-permissions');
    });

    it('strips ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN from the child env so the CLI uses the mounted OAuth session, not this app\'s own API key', async () => {
        const originalApiKey = process.env.ANTHROPIC_API_KEY;
        const originalAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
        process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-be-forwarded';
        process.env.ANTHROPIC_AUTH_TOKEN = 'token-should-not-be-forwarded';
        try {
            mockExecFile.mockResolvedValue({ stdout: cliJsonResult('[]') });
            await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
            const [, , options] = mockExecFile.mock.calls[0];
            expect(options.env).not.toHaveProperty('ANTHROPIC_API_KEY');
            expect(options.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
        } finally {
            if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
            else process.env.ANTHROPIC_API_KEY = originalApiKey;
            if (originalAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
            else process.env.ANTHROPIC_AUTH_TOKEN = originalAuthToken;
        }
    });

    it('parses the CLI JSON envelope\'s .result field into normalized candidates', async () => {
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
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult(JSON.stringify(postings)) });

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
        mockExecFile.mockResolvedValue({
            stdout: cliJsonResult(JSON.stringify([{ title: 'QA', company: 'Acme', url: 'https://x/1', contractType: 'bogus' }])),
        });
        const results = await searchAll({ jobTitles: ['QA'], locations: [] });
        expect(results[0].contractType).toBeUndefined();
    });

    it('strips a ```json code fence from .result before parsing', async () => {
        mockExecFile.mockResolvedValue({
            stdout: cliJsonResult('```json\n[{"title":"QA","company":"Acme","url":"https://x/1"}]\n```'),
        });
        const results = await searchAll({ jobTitles: ['QA'], locations: [] });
        expect(results).toHaveLength(1);
    });

    it('drops entries missing a title, company, or url', async () => {
        mockExecFile.mockResolvedValue({
            stdout: cliJsonResult(
                JSON.stringify([
                    { title: 'QA Engineer', company: 'Acme', url: 'https://x/1' },
                    { title: '', company: 'Acme', url: 'https://x/2' },
                    { title: 'QA Engineer', company: '', url: 'https://x/3' },
                    { title: 'QA Engineer', company: 'Acme', url: '' },
                ])
            ),
        });
        const results = await searchAll({ jobTitles: ['QA Engineer'], locations: [] });
        expect(results).toHaveLength(1);
        expect(results[0].url).toBe('https://x/1');
    });

    it('returns [] when .result is not valid JSON, rather than throwing', async () => {
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult('Sorry, nothing structured to report.') });
        await expect(searchAll({ jobTitles: ['QA Engineer'], locations: [] })).resolves.toEqual([]);
    });

    it('throws when the CLI envelope itself reports is_error: true', async () => {
        mockExecFile.mockResolvedValue({ stdout: JSON.stringify({ is_error: true, subtype: 'error_max_turns', result: null }) });
        await expect(searchAll({ jobTitles: ['QA Engineer'], locations: [] })).rejects.toThrow('claude CLI reported an error');
    });

    it('throws a descriptive error when the subprocess itself fails (e.g. binary not found)', async () => {
        mockExecFile.mockRejectedValue(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
        await expect(searchAll({ jobTitles: ['QA Engineer'], locations: [] })).rejects.toThrow('claude CLI invocation failed');
    });

    it('throws when stdout is not valid JSON at all', async () => {
        mockExecFile.mockResolvedValue({ stdout: 'not json' });
        await expect(searchAll({ jobTitles: ['QA Engineer'], locations: [] })).rejects.toThrow('claude CLI returned unparsable output');
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

    it('invokes claude with no tools loaded and maps ids to fit', async () => {
        mockExecFile.mockResolvedValue({ stdout: cliJsonResult(JSON.stringify({ results: [{ id: '1', fit: 'high' }] })) });
        const result = await qualifyAll([{ id: '1', title: 'QA Engineer', company: 'Acme' }], ['QA Engineer'], [], undefined);
        expect(result).toEqual({ '1': 'high' });
        const [, args] = mockExecFile.mock.calls[0];
        const toolsIndex = args.indexOf('--tools');
        expect(args[toolsIndex + 1]).toBe('');
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
            .mockResolvedValueOnce({ stdout: cliJsonResult(JSON.stringify({ results: batch1.map((c) => ({ id: c.id, fit: 'high' })) })) })
            .mockRejectedValueOnce(new Error('claude CLI timed out'));

        const result = await qualifyAll([...batch1, ...batch2], ['QA Engineer'], [], undefined);

        expect(mockExecFile).toHaveBeenCalledTimes(2);
        for (const c of batch1) expect(result[c.id]).toBe('high');
        for (const c of batch2) expect(result[c.id]).toBeUndefined();
    });
});
