import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const originalClientId = process.env.FRANCE_TRAVAIL_CLIENT_ID;
const originalClientSecret = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;

// franceTravail.js caches its OAuth token in module-level state — vi.resetModules()
// plus a fresh dynamic import gives each test its own instance so a cached token from
// an earlier test can't hide a bug in a later one (e.g. the missing-credentials test
// would otherwise silently pass on the previous test's still-cached token instead of
// exercising the credential check at all).
let search: typeof import('../../server/scrapers/franceTravail.js').search;

beforeEach(async () => {
    process.env.FRANCE_TRAVAIL_CLIENT_ID = 'test-id';
    process.env.FRANCE_TRAVAIL_CLIENT_SECRET = 'test-secret';
    vi.resetModules();
    ({ search } = await import('../../server/scrapers/franceTravail.js'));
});

afterEach(() => {
    vi.unstubAllGlobals();
    if (originalClientId === undefined) delete process.env.FRANCE_TRAVAIL_CLIENT_ID;
    else process.env.FRANCE_TRAVAIL_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
    else process.env.FRANCE_TRAVAIL_CLIENT_SECRET = originalClientSecret;
});

type MockResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
function mockTokenThenSearch(searchResponses: Array<Record<string, unknown> | (() => MockResponse)>) {
    const searchQueue = [...searchResponses];
    const fetchMock = vi.fn(async (url: string, _init?: { headers?: Record<string, string> }) => {
        if (url.includes('access_token')) {
            return { ok: true, status: 200, json: async () => ({ access_token: 'fake-token', expires_in: 1200 }) };
        }
        const next = searchQueue.shift();
        if (typeof next === 'function') return next();
        return { ok: true, status: 200, json: async () => next };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('search (franceTravail)', () => {
    it('never sends a `commune` query param (location is not passed to this portal)', async () => {
        const fetchMock = mockTokenThenSearch([{ resultats: [] }]);
        await search({ query: 'QA Engineer' });

        const searchCall = fetchMock.mock.calls.find((c) => (c[0] as string).includes('/offres/search'));
        expect(searchCall?.[0]).toContain('motsCles=QA');
        expect(searchCall?.[0]).not.toContain('commune');
    });

    it('maps a France Travail offer onto the shared normalized shape', async () => {
        mockTokenThenSearch([
            {
                resultats: [
                    {
                        intitule: 'QA Engineer',
                        entreprise: { nom: 'Acme' },
                        lieuTravail: { libelle: '75 - PARIS' },
                        origineOffre: { urlOrigine: 'https://candidat.francetravail.fr/offres/recherche/detail/123' },
                        dateCreation: '2026-01-02T10:00:00Z',
                        typeContrat: 'CDI',
                        salaire: { libelle: 'Annuel de 40000 Euros' },
                        description: 'Recherche QA Engineer.',
                    },
                ],
            },
        ]);

        const results = await search({ query: 'QA Engineer' });
        expect(results).toEqual([
            {
                title: 'QA Engineer',
                company: 'Acme',
                location: '75 - PARIS',
                url: 'https://candidat.francetravail.fr/offres/recherche/detail/123',
                postedDate: '2026-01-02',
                contractType: 'CDI',
                salaryRange: 'Annuel de 40000 Euros',
                descriptionRaw: 'Recherche QA Engineer.',
            },
        ]);
    });

    it('maps offre.id onto externalId when present', async () => {
        mockTokenThenSearch([
            {
                resultats: [
                    {
                        id: '203TXPY',
                        intitule: 'QA Engineer',
                        entreprise: { nom: 'Acme' },
                        origineOffre: { urlOrigine: 'https://candidat.francetravail.fr/offres/recherche/detail/123' },
                    },
                ],
            },
        ]);
        const results = await search({ query: 'QA Engineer' });
        expect(results[0].externalId).toBe('203TXPY');
    });

    it('treats a 204 (zero matches) as an empty result, not an error — the API\'s own way of reporting no matches for a query', async () => {
        const fetchMock = mockTokenThenSearch([() => ({ ok: true, status: 204, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } })]);

        await expect(search({ query: 'Software engineer in test' })).resolves.toEqual([]);
        const searchCalls = fetchMock.mock.calls.filter((c) => (c[0] as string).includes('/offres/search'));
        expect(searchCalls).toHaveLength(1); // no retry needed — 204 is handled before ever calling res.json()
    });

    it('retries once when the search response body is unparsable, and succeeds on the retry', async () => {
        const fetchMock = mockTokenThenSearch([
            () => ({
                ok: true,
                status: 200,
                json: async () => {
                    throw new SyntaxError('Unexpected end of JSON input');
                },
            }),
            { resultats: [] },
        ]);

        await expect(search({ query: 'QA Engineer' })).resolves.toEqual([]);
        const searchCalls = fetchMock.mock.calls.filter((c) => (c[0] as string).includes('/offres/search'));
        expect(searchCalls).toHaveLength(2);
    });

    it('propagates a second consecutive unparsable response as a real failure', async () => {
        mockTokenThenSearch([
            () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }),
            () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json again'); } }),
        ]);

        await expect(search({ query: 'QA Engineer' })).rejects.toThrow(SyntaxError);
    });

    it('throws a descriptive error when credentials are missing', async () => {
        delete process.env.FRANCE_TRAVAIL_CLIENT_ID;
        delete process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
        await expect(search({ query: 'QA Engineer' })).rejects.toThrow('FRANCE_TRAVAIL_CLIENT_ID');
    });

    it('sends a Range header requesting at most MAX_RESULTS offers', async () => {
        const fetchMock = mockTokenThenSearch([{ resultats: [] }]);
        await search({ query: 'QA Engineer' });

        const searchCall = fetchMock.mock.calls.find((c) => (c[0] as string).includes('/offres/search'));
        const headers = (searchCall?.[1] as { headers?: Record<string, string> })?.headers;
        expect(headers?.Range).toBe('offres=0-49');
    });

    it('hard-caps results to MAX_RESULTS even when the upstream API ignores the Range header and returns more', async () => {
        const resultats = Array.from({ length: 80 }, (_, i) => ({
            id: `offer-${i}`,
            intitule: `QA Engineer ${i}`,
            entreprise: { nom: 'Acme' },
            origineOffre: { urlOrigine: `https://candidat.francetravail.fr/offres/recherche/detail/${i}` },
        }));
        mockTokenThenSearch([{ resultats }]);

        const results = await search({ query: 'QA Engineer' });
        expect(results).toHaveLength(50);
    });
});
