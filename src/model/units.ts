// Sizes, spans of time, and the four words this plugin colours things by.
//
// Kept apart from the CloudNativePG types because the drawing helpers in
// src/ui need them and should not have to import a page's worth of Postgres
// knowledge to get a byte count or an age written.

/** The tones the app's theme has: '' is "no opinion", drawn in the faint colour. */
export type Tone = 'ok' | 'warn' | 'error' | 'info' | '';

/** How bad a tone is, for sorting worst first. */
export function severity(tone: Tone): number {
    return tone === 'error' ? 3 : tone === 'warn' ? 2 : tone === 'info' ? 1 : 0;
}

/** The worse of two tones. */
export function worst(a: Tone, b: Tone): Tone {
    return severity(b) > severity(a) ? b : a;
}

/** Bytes in the shorthand Kubernetes uses: 1.5 Gi, 940 Mi, 12 Ti. */
export function size(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0';
    const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi', 'Ei'];
    let n = value;
    let unit = 0;
    while (n >= 1024 && unit < units.length - 1) {
        n /= 1024;
        unit++;
    }
    const digits = n >= 100 || unit === 0 || Number.isInteger(n) ? 0 : n >= 10 ? 1 : 2;
    return `${Number(n.toFixed(digits))} ${units[unit]}`;
}

/**
 * A Kubernetes quantity -- "10Gi", "500M", "1.5Ti", "1000" -- as bytes.
 *
 * A cluster's storage and a PVC's capacity are written this way, and adding
 * up "10Gi" as 10 is the classic bug. Both the binary suffixes (Ki, Mi, Gi
 * ...) and the decimal ones (k, M, G ...) are understood, because Kubernetes
 * accepts both and people write both.
 */
export function quantity(value: string | number | undefined | null): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (!value) return 0;
    const match = /^\s*([0-9.]+)\s*([EPTGMk]i?|m)?\s*$/.exec(value);
    if (!match) return 0;
    const n = Number(match[1]);
    if (!Number.isFinite(n)) return 0;
    const suffix = match[2] ?? '';
    const binary: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6 };
    const decimal: Record<string, number> = { k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18, m: 1e-3 };
    return n * (binary[suffix] ?? decimal[suffix] ?? 1);
}

/** A number of things, with the noun made plural when it needs to be. */
export function count(n: number, noun: string, plural = `${noun}s`): string {
    return `${n} ${n === 1 ? noun : plural}`;
}

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * A span of time in at most two units, the way a person says it: "45s",
 * "12m", "3h 20m", "2d 4h", "5w". Infinity and NaN read as an em dash,
 * which is what "never" looks like in a table.
 */
export function span(ms: number): string {
    if (!Number.isFinite(ms)) return '—';
    const abs = Math.max(0, Math.round(ms / 1000));
    if (abs < 60) return `${abs}s`;
    const minutes = Math.floor(abs / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 14) return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
    return `${Math.floor(days / 7)}w`;
}

/** Milliseconds since an RFC 3339 timestamp, or Infinity when there is none. */
export function since(timestamp: string | undefined, now: number): number {
    const then = parseTime(timestamp);
    return then === undefined ? Infinity : Math.max(0, now - then);
}

/** An RFC 3339 timestamp as milliseconds, or undefined when absent or unparseable. */
export function parseTime(timestamp: string | undefined): number | undefined {
    if (!timestamp) return undefined;
    const then = Date.parse(timestamp);
    return Number.isNaN(then) ? undefined : then;
}

/** A fraction as a percentage, clamped to 0-100 and safe when the whole is zero. */
export function percent(part: number, whole: number): number {
    if (!(whole > 0)) return 0;
    return Math.max(0, Math.min(100, (part / whole) * 100));
}
