// In-memory live-progress feed for the currently-running (or most recently finished)
// scrape's search_all step. server/scrapers/claudeCli.js's searchAll pushes one event
// per WebSearch/WebFetch tool call as it streams from the `claude` CLI (see
// runClaudeStreaming), and the client polls GET /api/scraper/run/progress while
// POST /run is in flight — same "poll for what's new since I last checked" shape as
// observabilityStore.listCalls's sinceRowId, so a client never re-fetches events it
// already has.
//
// A single module-level buffer, not one per run/session: this app has exactly one
// concurrent scrape (single local user, no job queue, no auth), so there is never any
// ambiguity about whose progress a poll is asking for.

const MAX_EVENTS = 500;

let events = [];
let nextSeq = 1;
let active = false;

export function startRun() {
    events = [];
    nextSeq = 1;
    active = true;
}

export function endRun() {
    active = false;
}

// A pathological run (see the "be efficient" prompt guidance this pairs with) must
// still not grow this buffer without bound within one process lifetime — oldest
// events are dropped first, same trade-off as observabilityStore's retention pruning.
export function pushEvent(message, status = 'pending') {
    const event = { seq: nextSeq++, at: new Date().toISOString(), message, status };
    events.push(event);
    if (events.length > MAX_EVENTS) events.shift();
    return event;
}

export function getProgress(sinceSeq = 0) {
    return { active, events: events.filter((e) => e.seq > sinceSeq) };
}
