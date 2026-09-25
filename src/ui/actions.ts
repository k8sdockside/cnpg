// The changes the pages can ask for, and nothing else.
//
// Every one of them goes through the app, which shows it to the user and
// waits for a yes before anything reaches the cluster:
//
//   Back up now   a new Backup object for the cluster. Where the manifest
//                 has an action for the cluster's method, the page runs that
//                 action, so the question the user answers is the manifest's
//                 sentence; otherwise (a backup plugin, a snapshot class left
//                 to the default) the page asks to create the object itself
//                 and the user sees the whole Backup before saying yes.
//   Hibernate     the manifest's action: `cnpg.io/hibernation: "on"`.
//   Wake up       the manifest's action: `cnpg.io/hibernation: "off"`.
//   Restart       a new timestamp in `kubectl.kubernetes.io/restartedAt`,
//                 exactly what `kubectl cnpg restart` writes; the operator
//                 then restarts the instances one by one, standbys first. A
//                 timestamp cannot be written in a manifest, so this one is a
//                 patch from the page, shown to the user as a patch.
//
// Switchover is deliberately not here: `kubectl cnpg promote` writes the
// Cluster's *status* (targetPrimary), and a merge patch of the object cannot.

import { backupPlugin, methodsOf } from '../model/backups.js';
import { ANNOTATION, BACKUPS, CLUSTERS, type Cluster } from '../model/cnpg.js';
import type { ClusterView } from '../model/health.js';
import { button, el } from './dom.js';

export const ACTION = {
    backupBarman: 'backup-now',
    backupSnapshot: 'backup-now-snapshot',
    hibernate: 'hibernate',
    wake: 'wake-up',
} as const;

/** What pressing a button came to, for the notice under the buttons. */
export interface Outcome {
    tone: 'ok' | 'error';
    text: string;
}

const declined = (err: unknown) => err instanceof Error && /declined/i.test(err.message);

async function attempt(work: () => Promise<string>, report: (outcome: Outcome | null) => void): Promise<void> {
    try {
        report({ tone: 'ok', text: await work() });
    } catch (err) {
        // Saying no is not a failure worth reporting.
        report(declined(err) ? null : { tone: 'error', text: err instanceof Error ? err.message : String(err) });
    }
}

/** Why a backup cannot be asked for right now, or '' when it can. */
export function backupBlocked(view: ClusterView): string {
    // The operator refuses these outright: "cannot backup a hibernated cluster".
    if (view.state === 'hibernated' || view.state === 'hibernating') return 'A hibernated cluster cannot be backed up. Wake it up first.';
    if (methodsOf(view.cluster).length === 0) return 'This cluster has no backup configuration to back up to.';
    return '';
}

export function backUpNow(cluster: Cluster, report: (outcome: Outcome | null) => void): Promise<void> {
    const name = cluster.metadata.name;
    const namespace = cluster.metadata.namespace ?? '';
    const methods = methodsOf(cluster);
    return attempt(async () => {
        if (methods.includes('barmanObjectStore')) {
            const result = await k8sdockside.run(ACTION.backupBarman, { namespace, name });
            return `Backup ${result.created || 'requested'} is on its way.`;
        }
        if (methods.includes('volumeSnapshot') && cluster.spec?.backup?.volumeSnapshot?.className) {
            const result = await k8sdockside.run(ACTION.backupSnapshot, { namespace, name });
            return `Backup ${result.created || 'requested'} is on its way.`;
        }
        const method = methods.includes('volumeSnapshot') ? 'volumeSnapshot' : 'plugin';
        const plugin = backupPlugin(cluster);
        const object = {
            apiVersion: 'postgresql.cnpg.io/v1',
            kind: 'Backup',
            metadata: { generateName: `${name}-manual-` },
            spec: { cluster: { name }, method, ...(method === 'plugin' && plugin ? { pluginConfiguration: { name: plugin } } : {}) },
        };
        const created = await k8sdockside.create({ kind: BACKUPS, namespace, object });
        return `Backup ${created.name} is on its way.`;
    }, report);
}

export function hibernate(view: ClusterView, report: (outcome: Outcome | null) => void): Promise<void> {
    return attempt(async () => {
        await k8sdockside.run(ACTION.hibernate, { namespace: view.namespace, name: view.name });
        return `${view.name} is going to sleep: its pods stop, its volumes stay.`;
    }, report);
}

export function wake(view: ClusterView, report: (outcome: Outcome | null) => void): Promise<void> {
    return attempt(async () => {
        await k8sdockside.run(ACTION.wake, { namespace: view.namespace, name: view.name });
        return `${view.name} is waking up.`;
    }, report);
}

/** RFC 3339 to the second, the way `kubectl cnpg restart` writes it. */
export function restartStamp(now = Date.now()): string {
    return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function restart(view: ClusterView, report: (outcome: Outcome | null) => void): Promise<void> {
    return attempt(async () => {
        await k8sdockside.patch({
            kind: CLUSTERS,
            namespace: view.namespace,
            name: view.name,
            patch: { metadata: { annotations: { [ANNOTATION.restartedAt]: restartStamp() } } },
        });
        return `${view.name} is restarting, one instance at a time, the primary last.`;
    }, report);
}

/**
 * The buttons for one cluster, with a notice line under them for what
 * happened. Nothing is drawn when the plugin may not write, and only the
 * buttons that make sense for the cluster's state are.
 */
export function actionBar(view: ClusterView, ctx: K8sDockside.Context, options: { restart?: boolean; after?: () => void } = {}): HTMLElement {
    const bar = el('div', { class: 'actions' });
    if (!ctx.write) return bar;
    const notice = el('p', { class: 'notice' });
    const report = (outcome: Outcome | null) => {
        notice.textContent = outcome?.text ?? '';
        notice.className = `notice${outcome ? ` notice-${outcome.tone}` : ''}`;
        if (outcome?.tone === 'ok') options.after?.();
    };
    const asleep = view.state === 'hibernated' || view.state === 'hibernating' || view.hibernationRequested;

    const blocked = backupBlocked(view);
    const backup = button('Back up now', () => void backUpNow(view.cluster, report), { class: 'primary', title: blocked || `Take a backup of ${view.name} now` });
    if (blocked) backup.disabled = true;
    bar.append(backup);

    if (asleep) {
        bar.append(button('Wake up', () => void wake(view, report), { title: `Start ${view.name}'s pods again on the volumes it kept` }));
    } else {
        bar.append(button('Hibernate', () => void hibernate(view, report), { title: `Stop ${view.name}'s pods and keep its volumes` }));
        if (options.restart) bar.append(button('Restart', () => void restart(view, report), { title: `Rolling restart of ${view.name}, as kubectl cnpg restart does` }));
    }
    return el('div', { class: 'action-row' }, bar, notice);
}
