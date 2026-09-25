// Renders every page of the plugin to standalone HTML, with no cluster and no
// app: the same fixtures the render test uses, the plugin's real stylesheet,
// and the app's real theme tokens written onto :root the way the SDK does.
//
//   node scripts/preview.mjs [out-dir]
//
// It is a way to look at the pages, not a test -- the test is
// `npm run test`, which asserts on what this draws.
//
// The app's themes are read from a checkout of K8s Dockside beside this one
// (../k8sdockside); set K8SDOCKSIDE to point somewhere else.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? path.join(ROOT, 'preview');
const APP = process.env.K8SDOCKSIDE ?? path.resolve(ROOT, '../k8sdockside');

const PAGE = '<div id="page"><div id="head"></div><p id="first"></p><div id="body"></div></div>';
const PANEL = '<div id="panel"></div>';

// [file name, page module, title, tab or panel, address hash, the panel's object]
const PAGES = [
    ['overview', 'overview', 'Dashboard', 'page', ''],
    ['topology', 'topology', 'Topology: shop (healthy, poolers)', 'page', 'namespace=cnpg-demo&name=shop'],
    ['topology-billing', 'topology', 'Topology: billing (failing over)', 'page', 'namespace=finance&name=billing'],
    ['topology-ledger', 'topology', 'Topology: ledger (a lagging standby)', 'page', 'namespace=finance&name=ledger'],
    ['topology-archive', 'topology', 'Topology: archive (hibernated)', 'page', 'namespace=cnpg-demo&name=archive'],
    ['backups', 'backups', 'Backups', 'page', ''],
    ['cluster', 'cluster', 'Panel: Cluster shop', 'panel', '', (f) => f.shop],
    ['cluster-orders', 'cluster', 'Panel: Cluster orders (backups failing)', 'panel', '', (f) => f.orders],
    ['pod', 'pod', 'Panel: Pod shop-2 (a standby)', 'panel', '', (f) => f.pods.find((p) => p.metadata.name === 'shop-2')],
    ['pvc', 'pvc', 'Panel: PVC shop-1-wal', 'panel', '', (f) => f.pvcs.find((p) => p.metadata.name === 'shop-1-wal')],
];

/**
 * Bundles a TypeScript entry point and imports what it exports.
 *
 * The fragment on the end is not decoration: Node caches an ES module by its
 * URL, and a page is imported once per theme with byte-identical code. Import
 * it twice at the same URL and the second import returns the cached module
 * without running it again -- which draws the first theme and leaves every
 * page of the second blank.
 */
let imports = 0;
async function load(entry) {
    const built = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'browser', target: ['es2022'] });
    const code = built.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${imports++}`);
}

const themes = ['k8sdockside-light', 'k8sdockside-dark'].map((id) => JSON.parse(readFileSync(path.join(APP, 'internal/themes/builtin', `${id}.json`), 'utf8')));

// The same fixtures the render test asserts on.
const fixtures = await load(path.join(ROOT, 'src/fixtures.ts'));

const css = readFileSync(path.join(ROOT, 'ui/cnpg.css'), 'utf8');
const logo = readFileSync(path.join(ROOT, 'ui/logo.svg'), 'utf8');

const LISTS = {
    'crd:clusters.postgresql.cnpg.io': fixtures.clusters,
    'crd:backups.postgresql.cnpg.io': fixtures.backups,
    'crd:scheduledbackups.postgresql.cnpg.io': fixtures.scheduledBackups,
    'crd:poolers.postgresql.cnpg.io': fixtures.poolers,
    pods: fixtures.pods,
    persistentvolumeclaims: fixtures.pvcs,
    services: fixtures.services,
    nodes: fixtures.nodes,
};

// Dates the way the app writes them by default: ISO dates, 24-hour clock.
const pad = (n) => String(n).padStart(2, '0');
const format = {
    settings: () => ({ clock: '24h', dates: 'iso', zone: 'local', ages: 'relative' }),
    date: (w) => { const d = new Date(w); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },
    day: (w) => { const d = new Date(w); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },
    time: (w) => { const d = new Date(w); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; },
    dateTime: (w) => `${format.date(w)} ${format.time(w)}`,
    age: () => '',
    moment: (w) => ({ text: format.dateTime(w), title: '' }),
};

function stub(theme, object) {
    const namespaced = (list, namespace) => (namespace ? list.filter((o) => (o.metadata.namespace ?? '') === namespace) : list);
    return {
        ready: async () => ({
            pluginId: 'cnpg', viewId: '', sectionId: '', object: null,
            contextId: 'preview', contextName: 'kind-cnpg-dev', readable: [], write: true,
            actions: [], theme,
        }),
        object: async () => object,
        list: async ({ kind, namespace }) => { if (!(kind in LISTS)) throw new Error(`the cluster does not serve ${kind}`); return namespaced(LISTS[kind], namespace); },
        get: async ({ kind, namespace, name }) => (LISTS[kind] ?? []).find((o) => o.metadata.name === name && (o.metadata.namespace ?? '') === (namespace ?? '')),
        open: async () => null, openView: async () => null, openUrl: async () => null,
        summary: async () => ({ pluginId: 'cnpg', installed: true, checked: true, requirements: [], cards: [], error: '' }),
        storage: { get: async () => null, set: async () => null, remove: async () => null, keys: async () => [] },
        actions: async () => [], run: async () => ({ created: '' }), resize: async () => null,
        watch: () => () => {}, namespaces: async () => [],
        charts: async () => fixtures.charts,
        patch: async () => null, create: async () => ({ name: '' }),
        edit: async () => null, logs: async () => null, on: () => () => {},
        format,
    };
}

async function render(page, theme, object) {
    const [, module, , kind, hash] = page;
    const win = new Window({ url: `https://preview.local/${hash ? `#${hash}` : ''}` });
    const { document } = win;
    document.body.innerHTML = kind === 'panel' ? PANEL : PAGE;
    document.body.className = kind === 'panel' ? 'panel' : '';

    // What the SDK does before a page runs: the tokens on :root, and the base
    // recorded so the stylesheet's dark rules apply.
    const root = document.documentElement;
    for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(`--${name}`, value);
    root.setAttribute('data-theme-base', theme.base);

    // The page expects a browser's globals. Node defines some of these as
    // getters with no setter, so each is defined rather than assigned.
    const globals = ['window', 'document', 'navigator', 'location', 'DOMParser', 'URLSearchParams', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'KeyboardEvent', 'addEventListener', 'setTimeout', 'setInterval', 'clearInterval'];
    for (const key of globals) {
        if (win[key] === undefined) continue;
        const value = typeof win[key] === 'function' && key.endsWith('EventListener') ? win[key].bind(win) : win[key];
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    Object.defineProperty(globalThis, 'k8sdockside', { value: stub(theme, object), configurable: true, writable: true });

    // Each page is bundled fresh: a page runs its work on import, and an
    // already-imported module would not run again.
    await load(path.join(ROOT, 'src/pages', `${module}.ts`));
    for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 1));

    const html = document.body.innerHTML;
    // Every view polls on an interval, so the window has live timers on it
    // and nothing would ever exit until they are stopped.
    await win.happyDOM.close();
    return html;
}

mkdirSync(OUT, { recursive: true });
const index = [];

for (const page of PAGES) {
    const object = page[5] ? page[5](fixtures) : null;
    for (const theme of themes) {
        const html = await render(page, theme, object);
        const file = `${page[0]}.${theme.base}.html`;
        const panel = page[3] === 'panel';
        writeFileSync(
            path.join(OUT, file),
            `<!doctype html><html lang="en" data-theme-base="${theme.base}" style="${Object.entries(theme.tokens).map(([k, v]) => `--${k}:${v}`).join(';')}">
<head><meta charset="utf-8"><title>${page[2]} — ${theme.base}</title><style>${css}</style>${panel ? '<style>body.panel{max-width:760px}</style>' : ''}</head>
<body class="${panel ? 'panel' : ''}" style="background:var(--bg);color:var(--text)">${html}</body></html>`,
        );
        if (theme.base === 'light') index.push([page[2], page[0]]);
    }
}

writeFileSync(path.join(OUT, 'logo.svg'), logo);
writeFileSync(
    path.join(OUT, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CloudNativePG plugin preview</title>
<style>body{font:14px/1.6 system-ui;margin:40px auto;max-width:680px;color:#1a1d21}h1{font-size:20px}li{margin:4px 0}a{color:#0b6bcb}</style></head>
<body><h1>CloudNativePG plugin — page preview</h1>
<p>Every page, drawn against fixtures: a healthy three-instance cluster with poolers and a backup every ten minutes, a single instance with no backups, backups failing on bad credentials, a hibernated cluster, a standby 95 seconds behind, and a cluster failing over with its pooler down.</p>
<ul>${index.map(([label, id]) => `<li>${label} — <a href="${id}.light.html">light</a> · <a href="${id}.dark.html">dark</a></li>`).join('')}</ul>
<p style="color:#5c636b">Static HTML. Buttons and links do nothing: there is no app behind them.</p></body></html>`,
);
console.log(`wrote ${PAGES.length * 2 + 2} files to ${OUT}`);
console.log(`open ${path.join(OUT, 'index.html')}`);
// Anything the pages left running is irrelevant now that the files are out.
process.exit(0);
