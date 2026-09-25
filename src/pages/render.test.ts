// @vitest-environment happy-dom
//
// Does each page actually draw?
//
// The model tests say the Postgres knowledge is right; this says the pages
// that use it put it on the screen, against objects shaped the way
// CloudNativePG really writes them. It runs each page module against a stub
// of the bridge, with no cluster and no app, and reads the text that comes
// out. It is here rather than in a browser because the thing worth catching
// is a page that throws on a shape the cluster produces and this machine
// does not: a hibernated cluster with no pods, a Pooler with no phase, a
// cluster without Prometheus.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backups, charts, clusters, nodes, pods, poolers, pvcs, scheduledBackups, services, shop } from '../fixtures.js';

type Lists = Record<string, unknown[]>;

let opened: unknown[] = [];
let ran: { id: string; ref: unknown }[] = [];
let patched: unknown[] = [];

const FULL: Lists = {
    'crd:clusters.postgresql.cnpg.io': clusters,
    'crd:backups.postgresql.cnpg.io': backups,
    'crd:scheduledbackups.postgresql.cnpg.io': scheduledBackups,
    'crd:poolers.postgresql.cnpg.io': poolers,
    pods,
    persistentvolumeclaims: pvcs,
    services,
    nodes,
};

function bridge(lists: Lists, object: unknown = null, options: { charts?: unknown; installed?: boolean; write?: boolean; hash?: string } = {}) {
    const inNs = (list: unknown[], namespace?: string) => (namespace ? list.filter((o) => (o as { metadata: { namespace?: string } }).metadata.namespace === namespace) : list);
    return {
        ready: async () => ({
            pluginId: 'cnpg',
            viewId: '',
            sectionId: '',
            object: null,
            contextId: 'test',
            contextName: 'test-cluster',
            readable: [],
            write: options.write ?? true,
            actions: [],
            theme: { id: 'k8sdockside-dark', base: 'dark' as const, tokens: {} },
        }),
        object: async () => object,
        list: async ({ kind, namespace }: { kind: string; namespace?: string }) => {
            if (!(kind in lists)) throw new Error(`the cluster does not serve ${kind}`);
            return inNs(lists[kind]!, namespace);
        },
        get: async ({ kind, name }: { kind: string; name: string }) => (lists[kind] ?? []).find((o) => (o as { metadata: { name: string } }).metadata.name === name),
        open: async (ref: unknown) => void opened.push(ref),
        openView: async () => null,
        openUrl: async () => null,
        summary: async () => ({ pluginId: 'cnpg', installed: options.installed ?? true, checked: true, requirements: [], cards: [], error: '' }),
        storage: { get: async () => null, set: async () => null, remove: async () => null, keys: async () => [] },
        actions: async () => [],
        run: async (id: string, ref: unknown) => {
            ran.push({ id, ref });
            return { created: 'shop-manual-abcde' };
        },
        resize: async () => null,
        watch: () => () => {},
        namespaces: async () => [],
        charts: async () => options.charts ?? { attached: true, range: 60, source: { available: false, error: '', describe: '' }, charts: [] },
        patch: async (request: unknown) => void patched.push(request),
        create: async () => ({ name: 'x' }),
        edit: async () => null,
        logs: async () => null,
        on: () => () => {},
    };
}

const PAGE = '<div id="page"><div id="head"></div><p id="first"></p><div id="body"></div></div>';
const PANEL = '<div id="panel"></div>';

/** Runs a page module fresh, then lets its promises settle. */
async function run(module: string, html: string): Promise<string> {
    document.body.innerHTML = html;
    vi.resetModules();
    await import(module);
    for (let i = 0; i < 40; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    return document.body.textContent ?? '';
}

beforeEach(() => {
    opened = [];
    ran = [];
    patched = [];
    location.hash = '';
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('the dashboard', () => {
    it('draws a card per cluster, the attention list and the charts', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL, null, { charts }));
        const text = await run('./overview.js', PAGE);
        for (const name of ['shop', 'analytics', 'orders', 'archive', 'ledger', 'billing']) expect(text).toContain(name);
        expect(document.querySelectorAll('.card')).toHaveLength(6);
        expect(document.querySelectorAll('.card svg.glyph')).toHaveLength(6);
        expect(text).toContain('Hibernated');
        expect(text).toContain('Failing over');
        expect(text).toContain('orders: the last 2 backups failed');
        expect(text).toContain('ledger: ledger-3 is lagging');
        expect(text).toContain('Replication lag');
        expect(text).toContain('finance/ledger-3');
    });

    it('says so when there is no Prometheus, and draws the rest', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL));
        const text = await run('./overview.js', PAGE);
        expect(text).toContain('No Prometheus was found');
        expect(document.querySelectorAll('.card')).toHaveLength(6);
    });

    it('says CloudNativePG is not installed rather than drawing an empty dashboard', async () => {
        vi.stubGlobal('k8sdockside', bridge({}, null, { installed: false }));
        const text = await run('./overview.js', PAGE);
        expect(text).toContain('CloudNativePG is not installed here');
    });

    // The one place cluster data is hostile: a name is text, never markup.
    it('puts names on the page as text', async () => {
        const evil = { ...shop, metadata: { ...shop.metadata, name: '<img src=x onerror=alert(1)>' } };
        vi.stubGlobal('k8sdockside', bridge({ ...FULL, 'crd:clusters.postgresql.cnpg.io': [evil] }));
        const text = await run('./overview.js', PAGE);
        expect(text).toContain('<img src=x onerror=alert(1)>');
        expect(document.querySelector('img[src="x"]')).toBe(null);
    });
});

describe('the topology', () => {
    it('draws the focused cluster: primary, standbys, and the ways in', async () => {
        location.hash = 'namespace=cnpg-demo&name=shop';
        vi.stubGlobal('k8sdockside', bridge(FULL, null, { charts }));
        const text = await run('./topology.js', PAGE);
        expect(document.querySelector('svg.map')).not.toBe(null);
        expect(text).toContain('PRIMARY');
        expect(text).toContain('shop-1');
        expect(text).toContain('shop-pooler-rw');
        expect(text).toContain('any 1 of 2 standbys must confirm each commit');
        expect(text).toContain('zone-b');
    });

    it('opens a pod when its instance is clicked', async () => {
        location.hash = 'namespace=cnpg-demo&name=shop';
        vi.stubGlobal('k8sdockside', bridge(FULL));
        await run('./topology.js', PAGE);
        (document.querySelector('g.instance-primary') as SVGElement).dispatchEvent(new Event('click'));
        expect(opened).toContainEqual({ kind: 'pods', namespace: 'cnpg-demo', name: 'shop-1' });
    });

    it('draws a hibernated cluster from its volumes, with Wake up and no backup', async () => {
        location.hash = 'namespace=cnpg-demo&name=archive';
        vi.stubGlobal('k8sdockside', bridge(FULL));
        const text = await run('./topology.js', PAGE);
        expect(text).toContain('archive-1');
        expect(text).toContain('Wake up');
        const backup = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Back up now') as HTMLButtonElement;
        expect(backup.disabled).toBe(true);
    });

    it('asks for a restart with a fresh restartedAt annotation', async () => {
        location.hash = 'namespace=cnpg-demo&name=shop';
        vi.stubGlobal('k8sdockside', bridge(FULL));
        await run('./topology.js', PAGE);
        ([...document.querySelectorAll('button')].find((b) => b.textContent === 'Restart') as HTMLButtonElement).click();
        await Promise.resolve();
        expect(patched).toHaveLength(1);
        expect(JSON.stringify(patched[0])).toContain('kubectl.kubernetes.io/restartedAt');
    });

    it('runs the manifest s backup action for an object-store cluster', async () => {
        location.hash = 'namespace=cnpg-demo&name=shop';
        vi.stubGlobal('k8sdockside', bridge(FULL));
        await run('./topology.js', PAGE);
        ([...document.querySelectorAll('button')].find((b) => b.textContent === 'Back up now') as HTMLButtonElement).click();
        await Promise.resolve();
        expect(ran).toEqual([{ id: 'backup-now', ref: { namespace: 'cnpg-demo', name: 'shop' } }]);
    });

    it('draws no buttons when the plugin may not write', async () => {
        location.hash = 'namespace=cnpg-demo&name=shop';
        vi.stubGlobal('k8sdockside', bridge(FULL, null, { write: false }));
        await run('./topology.js', PAGE);
        expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Hibernate')).toBe(false);
    });
});

describe('the backups', () => {
    it('draws a timeline per cluster, the schedules in words and the errors in full', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL));
        const text = await run('./backups.js', PAGE);
        expect(document.querySelectorAll('svg.timeline').length).toBeGreaterThanOrEqual(4);
        expect(text).toContain('every 10 minutes');
        expect(text).toContain('daily at 02:00 UTC');
        expect(text).toContain('The Access Key Id you provided does not exist in our records.');
        expect(text).toContain('analytics has no backup section');
    });
});

describe('the panels', () => {
    it('sums up a Cluster', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL, shop));
        const text = await run('./cluster.js', PANEL);
        expect(text).toContain('shop-1 on kind-worker');
        expect(text).toContain('7m ago');
    });

    it('says what a pod is to its cluster', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL, pods.find((p) => p.metadata.name === 'shop-2')));
        const text = await run('./pod.js', PANEL);
        expect(text).toContain('Standby');
        expect(text).toContain('synchronous candidate');
    });

    it('says nothing much about a pod CloudNativePG did not make', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL, { metadata: { name: 'nginx', namespace: 'web', labels: { app: 'nginx' } } }));
        const text = await run('./pod.js', PANEL);
        expect(text).toContain('not part of a CloudNativePG cluster');
    });

    it('says whose data a volume holds', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL, pvcs.find((p) => p.metadata.name === 'shop-1-wal')));
        const text = await run('./pvc.js', PANEL);
        expect(text).toContain('write-ahead log');
        expect(text).toContain('primary');
    });
});
