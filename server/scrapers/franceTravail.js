// Portal module for France Travail's official "Offres d'emploi v2" API
// (https://francetravail.io) — OAuth2 client-credentials, plain JSON, no HTML
// parsing, no ToS risk. Requires an app registered on francetravail.io granting
// FRANCE_TRAVAIL_CLIENT_ID / FRANCE_TRAVAIL_CLIENT_SECRET (read from process.env only,
// server-side — never exposed to the browser bundle, unlike the AI provider keys in
// vite.config.ts's `define()`, since these are real OAuth secrets).
import { fetchWithBackoff } from './httpUtils.js';

export const id = 'france_travail';

const TOKEN_URL = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire';
const SEARCH_URL = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';
const SCOPE = 'api_offresdemploiv2 o2dsoffre';

// Module-level cache: a fresh token is cheap to fetch, so this only avoids
// re-authenticating on every single search call within one scrape run.
let cachedToken = null;

async function getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) {
        return cachedToken.accessToken;
    }

    const clientId = process.env.FRANCE_TRAVAIL_CLIENT_ID;
    const clientSecret = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error('FRANCE_TRAVAIL_CLIENT_ID / FRANCE_TRAVAIL_CLIENT_SECRET are not configured');
    }

    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: SCOPE,
    });

    const res = await fetchWithBackoff(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!res.ok) {
        throw new Error(`France Travail token request failed: ${res.status}`);
    }
    const data = await res.json();
    cachedToken = {
        accessToken: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 1200) * 1000,
    };
    return cachedToken.accessToken;
}

// France Travail's typeContrat codes only map cleanly onto our JobContractType enum
// for CDI/CDD — everything else (intérim, saisonnier, libéral, ...) has no equivalent,
// so it's left undefined rather than guessed.
function mapContractType(typeContrat) {
    if (typeContrat === 'CDI' || typeContrat === 'CDD') return typeContrat;
    return undefined;
}

function normalize(offre) {
    return {
        title: offre.intitule,
        company: offre.entreprise?.nom || 'Unknown company',
        location: offre.lieuTravail?.libelle,
        url: offre.origineOffre?.urlOrigine,
        postedDate: offre.dateCreation ? offre.dateCreation.slice(0, 10) : undefined,
        contractType: mapContractType(offre.typeContrat),
        salaryRange: offre.salaire?.libelle,
        descriptionRaw: offre.description,
    };
}

// Note: `location` is intentionally NOT sent as a query filter. France Travail's
// `commune`/`departement`/`region` params all expect a numeric INSEE/administrative
// code (see the API docs), not a free-text place name like "Paris" or "Remote
// France" as stored in SearchPreferences.locations — sending one as `commune`
// returns HTTP 400. Resolving city names to INSEE codes would need a second
// referential lookup API and isn't worth the complexity for this portal; the
// client-side AI qualification pass (services/aiService.ts qualifyScrapedJobs) is
// given the target locations too and can down-rank an off-location result instead.
async function fetchOnce(url, token) {
    const res = await fetchWithBackoff(url, { headers: { Authorization: `Bearer ${token}` } });
    // 204 ("no content") is how this API reports zero matches for a query — an empty
    // body, not an error. `res.ok` is true for it too, so it must be checked before
    // falling through to res.json(), which would otherwise throw on the empty body.
    if (res.status === 404 || res.status === 204) return [];
    if (!res.ok && res.status !== 206) {
        throw new Error(`France Travail search failed: ${res.status}`);
    }
    const data = await res.json();
    return Array.isArray(data.resultats) ? data.resultats : [];
}

export async function search({ query }) {
    const token = await getAccessToken();
    const params = new URLSearchParams();
    if (query) params.set('motsCles', query);
    const url = `${SEARCH_URL}?${params.toString()}`;

    let results;
    try {
        results = await fetchOnce(url, token);
    } catch (err) {
        if (err instanceof SyntaxError) {
            results = await fetchOnce(url, token); // one retry; a second failure propagates
        } else {
            throw err;
        }
    }

    return results.map(normalize).filter((r) => r.title && r.url);
}
