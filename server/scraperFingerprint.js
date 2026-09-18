import { slugify } from './scraperDedupe.js';
import { sha256Json } from './hash.js';

// Stable identity for a scraped posting across repeated scrapes — used to decide "have
// we seen this exact posting before" at ingest time (see scraperCandidatesStore.js's
// upsertSeenCandidate). Replaces dedupeKey's role for that decision; dedupeKey itself
// stays in the schema, vestigial, only to satisfy its pre-existing NOT NULL UNIQUE
// column constraint.
//
// Two branches:
// - `${portal}:${externalId}` when the portal's own API exposes a stable per-posting id
//   (France Travail's offre.id, Arbeitnow's job.slug) — the most precise option, and
//   survives a title/company edit on the source site.
// - otherwise, a hash of slug(company) + slug(title) + department code. Deliberately
//   NOT the URL, which portals routinely rotate, redirect, or append tracking params
//   to. Deliberately no portal in the hash: the same posting cross-listed on two
//   portals with identical company/title/department already collapses under the
//   pre-existing dedupeKey scheme (which also excludes portal) — this preserves that
//   behavior rather than introducing a new one.
// The `hash:`/`${portal}:` prefixes make the two branches impossible to collide with
// each other by construction (no real portal is named "hash").
/**
 * @param {{ portal?: string, externalId?: string, company?: string, title?: string, department?: string }} input
 * @returns {string}
 */
export function makeFingerprint({ portal, externalId, company, title, department }) {
    if (externalId) return `${portal}:${externalId}`;
    return `hash:${sha256Json([slugify(company ?? ''), slugify(title ?? ''), department ?? ''])}`;
}
