import { describe, expect, it } from 'vitest';
import { byPod, labels, latest, seriesLabel } from './metrics.js';
import { quantity, since, size, span, worst } from './units.js';

describe('units', () => {
    it('reads quantities as bytes, binary and decimal', () => {
        expect(quantity('10Gi')).toBe(10 * 1024 ** 3);
        expect(quantity('512Mi')).toBe(512 * 1024 ** 2);
        expect(quantity('1G')).toBe(1e9);
        expect(quantity('nonsense')).toBe(0);
        expect(quantity(undefined)).toBe(0);
    });

    it('writes sizes without trailing zeros', () => {
        expect(size(1024 ** 3)).toBe('1 Gi');
        expect(size(1.5 * 1024 ** 3)).toBe('1.5 Gi');
        expect(size(0)).toBe('0');
    });

    it('writes spans in at most two units', () => {
        expect(span(45_000)).toBe('45s');
        expect(span(12 * 60_000)).toBe('12m');
        expect(span(200 * 60_000)).toBe('3h 20m');
        expect(span(3 * 86_400_000 + 2 * 3_600_000)).toBe('3d 2h');
        expect(span(40 * 86_400_000)).toBe('5w');
        expect(span(Infinity)).toBe('—');
    });

    it('treats a missing timestamp as infinitely old', () => {
        expect(since(undefined, 0)).toBe(Infinity);
        expect(since('not a date', 0)).toBe(Infinity);
    });

    it('keeps the worse tone', () => {
        expect(worst('ok', 'warn')).toBe('warn');
        expect(worst('error', 'info')).toBe('error');
    });
});

describe('metrics', () => {
    it('reads a series name back into labels', () => {
        expect(labels('namespace=cnpg-demo, pod=shop-2')).toEqual({ namespace: 'cnpg-demo', pod: 'shop-2' });
        expect(seriesLabel('namespace=cnpg-demo, pod=shop-2')).toBe('cnpg-demo/shop-2');
        expect(seriesLabel('cluster=shop, namespace=cnpg-demo')).toBe('cnpg-demo/shop');
        expect(seriesLabel('')).toBe('all');
    });

    it('takes the last real value of a series', () => {
        expect(latest([{ t: 1, v: 3 }, { t: 2, v: Number.NaN }])).toBe(3);
        expect(latest([])).toBeUndefined();
    });

    it('files a chart s values by namespace and pod, and skips what it cannot place', () => {
        const chart = {
            pluginId: 'cnpg',
            pluginName: 'CloudNativePG',
            id: 'replication-lag',
            label: 'Replication lag',
            unit: 'seconds',
            description: '',
            error: '',
            series: [
                { name: 'namespace=a, pod=db-2', points: [{ t: 1, v: 12 }] },
                { name: 'pod=db-3', points: [{ t: 1, v: 5 }] },
            ],
        };
        expect([...byPod(chart)]).toEqual([['a/db-2', 12]]);
        expect(byPod(undefined).size).toBe(0);
    });
});
