import { describe, it, expect, beforeEach } from 'vitest';
import { startRun, endRun, pushEvent, getProgress } from '../../server/scraperProgress.js';

describe('scraperProgress', () => {
    beforeEach(() => {
        // Reset module-level state deterministically between tests without relying on
        // startRun() alone (it's part of what's under test).
        startRun();
        endRun();
    });

    it('reports inactive with no events before any run has started', () => {
        expect(getProgress()).toEqual({ active: false, events: [] });
    });

    it('becomes active on startRun and inactive again on endRun', () => {
        startRun();
        expect(getProgress().active).toBe(true);
        endRun();
        expect(getProgress().active).toBe(false);
    });

    it('clears previous events on a new startRun', () => {
        startRun();
        pushEvent('Recherche : QA Engineer');
        expect(getProgress().events).toHaveLength(1);

        startRun();
        expect(getProgress().events).toHaveLength(0);
    });

    it('assigns increasing seq numbers and returns them in getProgress', () => {
        startRun();
        const e1 = pushEvent('Recherche : QA Engineer');
        const e2 = pushEvent('Vérification : example.test', 'done');
        expect(e2.seq).toBeGreaterThan(e1.seq);
        expect(getProgress().events.map((e) => e.seq)).toEqual([e1.seq, e2.seq]);
    });

    it('only returns events after sinceSeq, for incremental polling', () => {
        startRun();
        const e1 = pushEvent('a');
        pushEvent('b');
        const e3 = pushEvent('c');
        expect(getProgress(e1.seq).events.map((e) => e.message)).toEqual(['b', 'c']);
        expect(getProgress(e3.seq).events).toHaveLength(0);
    });

    it('defaults a pushed event to status "pending" unless overridden', () => {
        startRun();
        pushEvent('Recherche : QA Engineer');
        pushEvent('Vérification : example.test', 'failed');
        const [first, second] = getProgress().events;
        expect(first.status).toBe('pending');
        expect(second.status).toBe('failed');
    });

    it('caps the buffer so a pathological run cannot grow it unbounded', () => {
        startRun();
        for (let i = 0; i < 550; i++) pushEvent(`event ${i}`);
        const { events: kept } = getProgress();
        expect(kept.length).toBeLessThanOrEqual(500);
        // Oldest events are dropped first — the most recent one must survive.
        expect(kept[kept.length - 1].message).toBe('event 549');
    });
});
