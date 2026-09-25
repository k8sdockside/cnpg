// The things every page in this plugin does the same way.
//
//  1. `start` wraps the page in one try/catch. Every bridge call rejects with
//     an Error carrying a sentence written for a person, so the honest thing
//     to do with a failure is show that sentence -- not a blank page and a
//     console nobody can open, because the page is in a sandboxed frame.
//  2. `fail` puts it where the user is looking.
//  3. Nothing subscribes to the theme: the SDK writes the app's tokens onto
//     :root before `ready()` resolves and rewrites them when the user
//     switches, so a stylesheet in var(--text) follows along on its own. The
//     drawings are SVG coloured by class for the same reason.

import { CLUSTERS, key } from '../model/cnpg.js';
import { el, replace } from './dom.js';

/** Shows a failure where the user is looking, as a sentence. */
export function fail(host: HTMLElement, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    replace(host, el('div', { class: 'failure' }, el('strong', {}, 'That did not work. '), el('span', {}, message)));
}

/**
 * Runs a page's body once the bridge is ready, and shows anything that goes
 * wrong instead of dying silently.
 */
export function start(hostId: string, body: (ctx: K8sDockside.Context) => Promise<void>): void {
    const run = async () => {
        const host = document.getElementById(hostId);
        try {
            const ctx = await k8sdockside.ready();
            await body(ctx);
        } catch (err) {
            if (host) fail(host, err);
        }
    };
    void run();
}

/**
 * Runs `body` now and every `ms` milliseconds after it, and hands anything it
 * throws to `onError`. The page has no network of its own, so this is how a
 * view stays live: the bridge's `watch` polls one list, and this polls the
 * handful of lists a page needs together.
 */
export function every(ms: number, body: () => Promise<void>, onError: (err: unknown) => void): () => void {
    let stopped = false;
    let busy = false;
    const tick = async () => {
        // A slow cluster must not stack reads on top of each other.
        if (stopped || busy) return;
        busy = true;
        try {
            await body();
        } catch (err) {
            onError(err);
        } finally {
            busy = false;
        }
    };
    void tick();
    const timer = setInterval(() => void tick(), ms);
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}

/**
 * A list of a kind the cluster may not serve: empty rather than a failure.
 *
 * Only Clusters are required. A cluster without the Pooler CRD, or a user
 * without permission to list Nodes, should still get a topology -- just
 * without the poolers, or the zones.
 */
export async function maybeList<T extends K8sDockside.KubeObject = K8sDockside.KubeObject>(query: K8sDockside.ListQuery): Promise<T[]> {
    try {
        return await k8sdockside.list<T>(query);
    } catch {
        return [];
    }
}

/** The plugin's charts, or null when there is no Prometheus or they cannot be read. */
export async function maybeCharts(minutes: number): Promise<K8sDockside.ChartsPanel | null> {
    try {
        return await k8sdockside.charts({ minutes });
    } catch {
        return null;
    }
}

/** What follows the # in a focused page's address, as the app writes it. */
export function focused(): { namespace: string; name: string } {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    return { namespace: params.get('namespace') ?? '', name: params.get('name') ?? '' };
}

/** The storage key a view's hand-over is kept under. */
export const focusKey = (viewId: string) => `focus-${viewId}`;

/**
 * Opens another of this plugin's views on one cluster.
 *
 * `openView` takes only a view's id, so the cluster travels through the
 * plugin's storage: written here, read by the view as it loads. An app older
 * than 0.0.19 has no storage, and the view then opens as it would anyway.
 */
export async function openOn(viewId: string, namespace: string, name: string): Promise<void> {
    try {
        await k8sdockside.storage?.set(focusKey(viewId), { namespace, name });
    } catch {
        // Not being able to remember is not a reason not to open the view.
    }
    await k8sdockside.openView(viewId);
}

/**
 * The cluster a view was asked to open on, as `namespace/name`: its address
 * first, then what `openOn` left in storage, then '' for "none in
 * particular". With `once`, the hand-over is forgotten as it is read, so the
 * next time the view is opened from the sidebar it shows everything again.
 */
export async function wanted(viewId: string, once = false): Promise<string> {
    const hash = focused();
    if (hash.name) return key(hash.namespace, hash.name);
    try {
        const stored = (await k8sdockside.storage?.get(focusKey(viewId))) as { namespace?: string; name?: string } | null | undefined;
        if (once && stored) await k8sdockside.storage?.remove(focusKey(viewId));
        if (stored?.name) return key(stored.namespace, stored.name);
    } catch {
        // Fall through to "none in particular".
    }
    return '';
}

/** Opens a Cluster in the app. */
export function openCluster(namespace: string, name: string): void {
    void k8sdockside.open({ kind: CLUSTERS, namespace, name });
}

/** A moment the user's way when the app can say it (0.1.10 and newer), plainly otherwise. */
export function moment(when: number | undefined): string {
    if (when === undefined) return '—';
    const format = k8sdockside.format;
    if (format) return format.dateTime(when);
    return new Date(when).toLocaleString();
}

/** Picks an option, as the property and as the attribute, so it reads the same however the page is looked at. */
export function choose(select: HTMLSelectElement, value: string): void {
    for (const option of Array.from(select.options)) {
        option.selected = option.value === value;
        if (option.selected) option.setAttribute('selected', '');
        else option.removeAttribute('selected');
    }
    select.value = value;
}
