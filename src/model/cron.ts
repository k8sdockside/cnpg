// A ScheduledBackup's schedule: when it runs next, how often, and in words.
//
// CloudNativePG parses `spec.schedule` with robfig/cron v1.2.0's `cron.Parse`
// (internal/controller/scheduledbackup_controller.go), and that parser is not
// a Kubernetes CronJob's. It takes SIX fields, seconds first:
//
//     second minute hour day-of-month month [day-of-week]
//
// with the day of the week optional -- so a five-field "0 2 * * *", which a
// CronJob reads as 02:00 every day, is here second 0 of minute 2 of every
// hour. Getting that wrong is the most common ScheduledBackup mistake there
// is, which is why this is written out rather than borrowed from a crontab
// library that would agree with the mistake.
//
// Also understood, as robfig/cron v1.2.0 does: `*` and `?`, lists, ranges,
// steps (`N/step` meaning `N-max/step`), month and weekday names, and the
// descriptors @yearly @annually @monthly @weekly @daily @midnight @hourly and
// `@every <duration>`. When both day fields are restricted, a day matches if
// either does -- cron's old rule, which robfig keeps.
//
// Times are UTC: the operator evaluates the schedule in its own time zone,
// which is UTC in the image CloudNativePG ships. The operator's own
// `status.nextScheduleTime` is preferred wherever it is there; this is for
// the words, the interval, and a next run when the status has none yet.

import { DAY, HOUR, MINUTE, SECOND } from './units.js';

interface Field {
    min: number;
    max: number;
    names?: Record<string, number>;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const FIELDS: Field[] = [
    { min: 0, max: 59 }, // second
    { min: 0, max: 59 }, // minute
    { min: 0, max: 23 }, // hour
    { min: 1, max: 31 }, // day of month
    { min: 1, max: 12, names: MONTHS }, // month
    { min: 0, max: 6, names: WEEKDAYS }, // day of week
];

/** One parsed field: the values it allows, and whether it was a star. */
interface Set {
    values: boolean[];
    star: boolean;
    raw: string;
}

export type Schedule =
    | { kind: 'spec'; fields: Set[]; source: string }
    | { kind: 'every'; every: number; source: string };

export type Parsed = { ok: true; schedule: Schedule } | { ok: false; error: string };

/** Parses a schedule the way the operator does, or says why it would refuse it. */
export function parse(source: string | undefined): Parsed {
    const spec = (source ?? '').trim();
    if (!spec) return { ok: false, error: 'the schedule is empty' };
    if (spec.startsWith('@')) return descriptor(spec);

    const parts = spec.split(/\s+/);
    if (parts.length < 5 || parts.length > 6) {
        return { ok: false, error: `expected 5 or 6 fields (seconds first), found ${parts.length}` };
    }
    if (parts.length === 5) parts.push('*');

    const fields: Set[] = [];
    for (let i = 0; i < 6; i++) {
        const field = FIELDS[i]!;
        const parsed = parseField(parts[i]!, field);
        if (typeof parsed === 'string') return { ok: false, error: parsed };
        fields.push(parsed);
    }
    return { ok: true, schedule: { kind: 'spec', fields, source: spec } };
}

function descriptor(spec: string): Parsed {
    const fixed: Record<string, string> = {
        '@yearly': '0 0 0 1 1 *',
        '@annually': '0 0 0 1 1 *',
        '@monthly': '0 0 0 1 * *',
        '@weekly': '0 0 0 * * 0',
        '@daily': '0 0 0 * * *',
        '@midnight': '0 0 0 * * *',
        '@hourly': '0 0 * * * *',
    };
    const lower = spec.toLowerCase();
    if (fixed[lower]) {
        const parsed = parse(fixed[lower]);
        if (parsed.ok && parsed.schedule.kind === 'spec') parsed.schedule.source = spec;
        return parsed;
    }
    if (lower.startsWith('@every ')) {
        const every = goDuration(spec.slice(7).trim());
        if (every === undefined || every <= 0) return { ok: false, error: `cannot read the duration in "${spec}"` };
        return { ok: true, schedule: { kind: 'every', every, source: spec } };
    }
    return { ok: false, error: `unrecognised descriptor "${spec}"` };
}

function parseField(text: string, field: Field): Set | string {
    const values = new Array<boolean>(field.max + 1).fill(false);
    let star = false;
    for (const expr of text.split(',')) {
        const [range = '', stepText, extra] = expr.split('/');
        if (extra !== undefined) return `too many slashes in "${expr}"`;
        let start: number;
        let end: number;
        const bounds = range.split('-');
        if (range === '*' || range === '?') {
            start = field.min;
            end = field.max;
            star = true;
        } else {
            if (bounds.length > 2) return `too many hyphens in "${expr}"`;
            const low = value(bounds[0] ?? '', field);
            if (low === undefined) return `cannot read "${bounds[0]}" in "${text}"`;
            start = low;
            end = low;
            if (bounds.length === 2) {
                const high = value(bounds[1] ?? '', field);
                if (high === undefined) return `cannot read "${bounds[1]}" in "${text}"`;
                end = high;
            }
        }
        let step = 1;
        if (stepText !== undefined) {
            if (!/^\d+$/.test(stepText) || Number(stepText) === 0) return `bad step in "${expr}"`;
            step = Number(stepText);
            // robfig: "N/step" means "N-max/step".
            // A stepped star still counts as a star for the day-matching rule,
            // as it does in robfig's getRange.
            if (bounds.length === 1 && range !== '*' && range !== '?') end = field.max;
        }
        if (start < field.min || end > field.max || start > end) return `"${expr}" is out of range ${field.min}-${field.max}`;
        for (let v = start; v <= end; v += step) values[v] = true;
    }
    return { values, star, raw: text };
}

function value(text: string, field: Field): number | undefined {
    const named = field.names?.[text.toLowerCase()];
    if (named !== undefined) return named;
    return /^\d+$/.test(text) ? Number(text) : undefined;
}

/** A Go duration -- "1h30m", "90s", "2h", "500ms" -- in milliseconds. */
export function goDuration(text: string): number | undefined {
    const units: Record<string, number> = { h: HOUR, m: MINUTE, s: SECOND, ms: 1 };
    let total = 0;
    let rest = text;
    if (!rest) return undefined;
    while (rest) {
        const match = /^(\d+(?:\.\d+)?)(ms|h|m|s)/.exec(rest);
        if (!match) return undefined;
        total += Number(match[1]) * (units[match[2]!] ?? 0);
        rest = rest.slice(match[0].length);
    }
    return total;
}

/**
 * The first run strictly after `from`, in milliseconds, or undefined when
 * the schedule never runs (the 30th of February) within five years.
 */
export function next(schedule: Schedule, from: number): number | undefined {
    if (schedule.kind === 'every') {
        // robfig's ConstantDelaySchedule: whole seconds after `from`.
        return Math.floor((from + schedule.every) / SECOND) * SECOND;
    }
    const [sec, min, hour, dom, month, dow] = schedule.fields as [Set, Set, Set, Set, Set, Set];
    const d = new Date(Math.floor(from / SECOND) * SECOND + SECOND);
    const limit = from + 5 * 366 * DAY;

    while (d.getTime() <= limit) {
        if (!month.values[d.getUTCMonth() + 1]) {
            d.setUTCMonth(d.getUTCMonth() + 1, 1);
            d.setUTCHours(0, 0, 0, 0);
            continue;
        }
        if (!dayMatches(dom, dow, d)) {
            d.setUTCDate(d.getUTCDate() + 1);
            d.setUTCHours(0, 0, 0, 0);
            continue;
        }
        if (!hour.values[d.getUTCHours()]) {
            d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
            continue;
        }
        if (!min.values[d.getUTCMinutes()]) {
            d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0);
            continue;
        }
        if (!sec.values[d.getUTCSeconds()]) {
            d.setUTCSeconds(d.getUTCSeconds() + 1, 0);
            continue;
        }
        return d.getTime();
    }
    return undefined;
}

function dayMatches(dom: Set, dow: Set, d: Date): boolean {
    const domMatch = dom.values[d.getUTCDate()] === true;
    const dowMatch = dow.values[d.getUTCDay()] === true;
    return dom.star || dow.star ? domMatch && dowMatch : domMatch || dowMatch;
}

/**
 * How often it runs: the gap between the next two runs. Good enough for
 * "is the last backup older than it should be", which is all it is used for
 * -- an irregular schedule ("weekdays at 02:00") reads as its usual gap.
 */
export function interval(schedule: Schedule, from: number): number | undefined {
    if (schedule.kind === 'every') return schedule.every;
    const first = next(schedule, from);
    if (first === undefined) return undefined;
    const second = next(schedule, first);
    return second === undefined ? undefined : second - first;
}

const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/**
 * The schedule in words, for the common shapes: "every 10 minutes", "every
 * hour at :30", "daily at 02:00 UTC", "on Sundays at 03:00 UTC", "on day 1 of
 * every month at 00:00 UTC". Anything else reads as "on a custom schedule",
 * and the page shows the expression beside it.
 */
export function words(schedule: Schedule): string {
    if (schedule.kind === 'every') return `every ${everyWords(schedule.every)}`;
    const [sec, min, hour, dom, month, dow] = schedule.fields as [Set, Set, Set, Set, Set, Set];
    const single = (set: Set) => (/^\d+$/.test(set.raw) ? Number(set.raw) : undefined);
    const stepOf = (set: Set) => {
        const m = /^(?:\*|0)\/(\d+)$/.exec(set.raw);
        return m ? Number(m[1]) : undefined;
    };
    const any = (set: Set) => set.raw === '*' || set.raw === '?';
    const two = (n: number) => String(n).padStart(2, '0');
    const s = single(sec);
    const m = single(min);
    const h = single(hour);

    if (!any(month) || s === undefined) return 'on a custom schedule';

    const everyDay = any(dom) && any(dow);
    if (everyDay && any(hour)) {
        const minuteStep = stepOf(min);
        if (minuteStep !== undefined) return minuteStep === 1 ? 'every minute' : `every ${minuteStep} minutes`;
        if (m !== undefined) return `every hour at :${two(m)}`;
        if (min.raw === '*') return 'every minute';
    }
    if (everyDay && m !== undefined) {
        const hourStep = stepOf(hour);
        if (hourStep !== undefined) return `every ${hourStep} hours at :${two(m)}`;
    }
    if (m === undefined || h === undefined) return 'on a custom schedule';
    const at = `at ${two(h)}:${two(m)} UTC`;
    if (everyDay) return `daily ${at}`;
    if (any(dom)) {
        const days = DAY_NAMES.filter((_, i) => dow.values[i]);
        if (days.length === 5 && !dow.values[0] && !dow.values[6]) return `on weekdays ${at}`;
        if (days.length > 0 && days.length <= 3) return `on ${days.join(', ')} ${at}`;
    }
    const day = single(dom);
    if (any(dow) && day !== undefined) return `on day ${day} of every month ${at}`;
    return 'on a custom schedule';
}

function everyWords(ms: number): string {
    if (ms % HOUR === 0) return ms === HOUR ? 'hour' : `${ms / HOUR} hours`;
    if (ms % MINUTE === 0) return ms === MINUTE ? 'minute' : `${ms / MINUTE} minutes`;
    return `${Math.round(ms / SECOND)} seconds`;
}

/** Everything the pages want from a schedule, in one go. */
export function cronFor(source: string, now: number): { words: string; error: string; next: number | undefined; every: number | undefined } {
    const parsed = parse(source);
    if (!parsed.ok) return { words: 'a schedule the operator cannot read', error: parsed.error, next: undefined, every: undefined };
    return { words: words(parsed.schedule), error: '', next: next(parsed.schedule, now), every: interval(parsed.schedule, now) };
}
