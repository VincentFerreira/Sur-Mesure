import * as franceTravail from './franceTravail.js';
import * as arbeitnow from './arbeitnow.js';
import * as freehire from './freehire.js';
import * as claudeCli from './claudeCli.js';
import * as fake from './fake.js';

// SCRAPER_PROVIDER=fake means "go fully synthetic, no real network/CLI calls" — the
// same flag routes.scraper.js's useFakeAi() already uses to fake the expand-keywords/
// qualify AI steps. Real portals must respect it too: previously only the Vitest
// suite's NODE_ENV=test check disabled them, so a `SCRAPER_PROVIDER=fake` e2e run
// (Playwright's own webServer sets exactly this) would still dispatch real HTTP calls
// to France Travail/Arbeitnow/Freehire and a real `claude` CLI subprocess — surfaced by
// the first e2e test to actually click "Lancer un scrape" (POST /run was never
// exercised by e2e before that).
const useFakePortals = () => process.env.NODE_ENV === 'test' || process.env.SCRAPER_PROVIDER === 'fake';

// Registry of portal modules. Each exports `id` and `async search({ query, location })`.
// `usesLocation: false` means the portal ignores `location` entirely (e.g.
// france_travail — see the comment in franceTravail.js) — such a portal is called
// once per query, not once per (query, location) pair, so it isn't hit with N
// redundant, identical requests (which risks tripping its rate limit for no benefit;
// this is what caused an intermittent "Unexpected end of JSON input" mid-run before
// this was added). Defaults to true when omitted.
// - `france_travail`/`arbeitnow`/`freehire` are all disabled under useFakePortals() —
//   real network calls have no place in a synthetic run. `france_travail` also needs
//   real credentials; until configured it just fails per-portal in a real run (caught
//   in runScrape below) rather than blocking the others.
// - The `fake` portal itself is only added when explicitly requested, never in a real
//   run, so it can never mask a misconfigured real portal.
function buildRegistry() {
    const portals = [
        { id: franceTravail.id, enabled: !useFakePortals(), usesLocation: false, search: franceTravail.search },
        { id: arbeitnow.id, enabled: !useFakePortals(), usesLocation: true, search: arbeitnow.search },
        { id: freehire.id, enabled: !useFakePortals(), usesLocation: false, search: freehire.search },
    ];
    if (process.env.SCRAPER_PROVIDER === 'fake') {
        portals.push({ id: fake.id, enabled: true, usesLocation: true, search: fake.search });
    }
    return portals;
}

// Single-shot portals: called once per scrape run with the full jobTitles/locations
// arrays, not once per (query, location) pair like the portals above — invoking the
// `claude` CLI is its own multi-second-to-minutes subprocess, so looping it per query
// would be needlessly slow. Disabled under useFakePortals() for the same reason as the
// portals above — a synthetic run must never spawn a real CLI subprocess.
function buildSingleShotRegistry() {
    return [{ id: claudeCli.id, enabled: !useFakePortals(), run: claudeCli.searchAll }];
}

// Runs every enabled portal once per (jobTitle, location) pair — or once per jobTitle
// only, for a portal whose `usesLocation` is false — then runs every enabled
// single-shot portal once for the whole run. A portal throwing (bad credentials,
// network error, upstream outage, missing CLI binary) is caught and recorded in
// `portalReport` rather than aborting the others — mirrors ai-job-search's
// job-scraper/SKILL.md Step 1: "one portal fails, continue with the rest."
export async function runScrape({ jobTitles = [], locations = [] }) {
    const portals = buildRegistry().filter((p) => p.enabled);
    const queries = jobTitles.length > 0 ? jobTitles : [undefined];
    const locationList = locations.length > 0 ? locations : [undefined];

    const results = [];
    const portalReport = [];

    for (const portal of portals) {
        let count = 0;
        let error;
        const effectiveLocations = portal.usesLocation === false ? [undefined] : locationList;
        for (const query of queries) {
            for (const location of effectiveLocations) {
                try {
                    const found = await portal.search({ query, location });
                    for (const item of found) {
                        results.push({ ...item, portal: portal.id });
                    }
                    count += found.length;
                } catch (err) {
                    error = err.message;
                }
            }
        }
        portalReport.push({ portal: portal.id, count, ...(error ? { error } : {}) });
    }

    for (const portal of buildSingleShotRegistry().filter((p) => p.enabled)) {
        try {
            const found = await portal.run({ jobTitles, locations });
            for (const item of found) {
                results.push({ ...item, portal: portal.id });
            }
            portalReport.push({ portal: portal.id, count: found.length });
        } catch (err) {
            portalReport.push({ portal: portal.id, count: 0, error: err.message });
        }
    }

    return { results, portalReport };
}
