import { describe, expect, it } from 'vitest';
import { cronFor, goDuration, interval, next, parse, words, type Schedule } from './cron.js';

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number | undefined) => (ms === undefined ? undefined : new Date(ms).toISOString());

function schedule(spec: string): Schedule {
    const parsed = parse(spec);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.schedule;
}

describe('parse', () => {
    it('takes six fields, seconds first', () => {
        expect(parse('0 */10 * * * *').ok).toBe(true);
    });

    // The mistake everyone makes: a CronJob's five fields. robfig/cron's
    // default parser accepts five too -- with the weekday left out -- so the
    // operator runs it, just not when the author meant.
    it('reads five fields as seconds-first with no weekday, as the operator does', () => {
        const s = schedule('0 2 * * *');
        // second 0 of minute 2 of every hour -- not 02:00 daily.
        expect(iso(next(s, at('2026-09-25T10:00:00Z')))).toBe('2026-09-25T10:02:00.000Z');
    });

    it('refuses what the operator would refuse', () => {
        expect(parse('').ok).toBe(false);
        expect(parse('* * * *').ok).toBe(false);
        expect(parse('0 0 25 * * *').ok).toBe(false); // hour 25
        expect(parse('0 0 0 * 13 *').ok).toBe(false); // month 13
        expect(parse('0 0 0 * * 7').ok).toBe(false); // robfig's weekdays are 0-6
        expect(parse('0 0/0 * * * *').ok).toBe(false);
        expect(parse('@fortnightly').ok).toBe(false);
    });

    it('understands names, lists, ranges and ?', () => {
        expect(parse('0 30 3 ? JAN-MAR mon,wed,FRI').ok).toBe(true);
    });
});

describe('next', () => {
    const from = at('2026-09-25T10:03:17Z'); // a Friday

    it('every ten minutes', () => {
        expect(iso(next(schedule('0 */10 * * * *'), from))).toBe('2026-09-25T10:10:00.000Z');
    });

    it('daily at 02:00 rolls over to tomorrow', () => {
        expect(iso(next(schedule('0 0 2 * * *'), from))).toBe('2026-09-26T02:00:00.000Z');
    });

    it('is strictly after the moment given', () => {
        const s = schedule('0 0 2 * * *');
        expect(iso(next(s, at('2026-09-26T02:00:00Z')))).toBe('2026-09-27T02:00:00.000Z');
    });

    it('weekdays only skips the weekend', () => {
        expect(iso(next(schedule('0 0 2 * * 1-5'), at('2026-09-26T03:00:00Z')))).toBe('2026-09-28T02:00:00.000Z');
    });

    it('with both day fields restricted, either one matching is enough', () => {
        // The 1st of the month OR a Sunday: from Friday the 25th, Sunday the 27th comes first.
        expect(iso(next(schedule('0 0 0 1 * 0'), from))).toBe('2026-09-27T00:00:00.000Z');
    });

    it('N/step means N-max/step', () => {
        expect(iso(next(schedule('0 5/20 * * * *'), from))).toBe('2026-09-25T10:05:00.000Z');
        expect(iso(next(schedule('0 5/20 * * * *'), at('2026-09-25T10:45:01Z')))).toBe('2026-09-25T11:05:00.000Z');
    });

    it('crosses a month and a year', () => {
        expect(iso(next(schedule('@monthly'), at('2026-12-15T00:00:00Z')))).toBe('2027-01-01T00:00:00.000Z');
    });

    it('gives up on a date that never comes', () => {
        expect(next(schedule('0 0 0 30 2 *'), from)).toBeUndefined();
    });

    it('@every is a fixed delay', () => {
        expect(iso(next(schedule('@every 1h30m'), from))).toBe('2026-09-25T11:33:17.000Z');
    });
});

describe('interval', () => {
    it('is the gap between runs', () => {
        expect(interval(schedule('0 */10 * * * *'), 0)).toBe(10 * 60_000);
        expect(interval(schedule('@daily'), 0)).toBe(24 * 3_600_000);
        expect(interval(schedule('@every 45m'), 0)).toBe(45 * 60_000);
    });
});

describe('words', () => {
    it.each([
        ['0 */10 * * * *', 'every 10 minutes'],
        ['0 * * * * *', 'every minute'],
        ['0 30 * * * *', 'every hour at :30'],
        ['0 15 */6 * * *', 'every 6 hours at :15'],
        ['0 0 2 * * *', 'daily at 02:00 UTC'],
        ['@daily', 'daily at 00:00 UTC'],
        ['0 0 3 * * 0', 'on Sundays at 03:00 UTC'],
        ['0 0 3 * * 1-5', 'on weekdays at 03:00 UTC'],
        ['0 0 4 1 * *', 'on day 1 of every month at 04:00 UTC'],
        ['@every 2h', 'every 2 hours'],
        ['0 0 3 1-7 * 1', 'on a custom schedule'],
    ])('%s is "%s"', (spec, want) => {
        expect(words(schedule(spec))).toBe(want);
    });
});

describe('goDuration', () => {
    it('reads Go durations', () => {
        expect(goDuration('1h30m')).toBe(90 * 60_000);
        expect(goDuration('90s')).toBe(90_000);
        expect(goDuration('500ms')).toBe(500);
        expect(goDuration('1d')).toBeUndefined();
        expect(goDuration('')).toBeUndefined();
    });
});

describe('cronFor', () => {
    it('says why a schedule will not run', () => {
        const result = cronFor('every day', 0);
        expect(result.error).toMatch(/fields/);
        expect(result.next).toBeUndefined();
    });
});
