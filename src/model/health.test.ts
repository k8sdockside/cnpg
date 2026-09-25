import { describe, expect, it } from 'vitest';
import type { Cluster } from './cnpg.js';
import { clusterView, isMoving, PHASES, sentence, versionOf } from './health.js';

function cluster(status: Cluster['status'], spec: Cluster['spec'] = { instances: 3 }, annotations?: Record<string, string>): Cluster {
    return { metadata: { name: 'shop', namespace: 'db', ...(annotations ? { annotations } : {}) }, spec, status };
}

describe('clusterView', () => {
    it('says a healthy cluster is healthy, in a word', () => {
        const view = clusterView(cluster({ phase: 'Cluster in healthy state', readyInstances: 3, currentPrimary: 'shop-1' }));
        expect(view.words).toBe('Healthy');
        expect(view.tone).toBe('ok');
        expect(sentence(view)).toBe('All 3 instances ready; shop-1 takes the writes.');
    });

    // The operator keeps saying "healthy" while a standby's pod is gone.
    it('does not call a cluster healthy with an instance missing', () => {
        const view = clusterView(cluster({ phase: 'Cluster in healthy state', readyInstances: 2 }));
        expect(view.state).toBe('degraded');
        expect(view.words).toBe('2 of 3 ready');
        expect(view.tone).toBe('warn');
        expect(clusterView(cluster({ phase: 'Cluster in healthy state', readyInstances: 0 })).tone).toBe('error');
    });

    it('turns failover red and switchover amber', () => {
        const failing = clusterView(cluster({ phase: 'Failing over', currentPrimary: 'shop-1', targetPrimary: 'pending' }));
        expect(failing.tone).toBe('error');
        expect(sentence(failing)).toBe('The primary shop-1 failed; the most advanced replica is being promoted in its place.');
        const switching = clusterView(cluster({ phase: 'Switchover in progress', currentPrimary: 'shop-1', targetPrimary: 'shop-2' }));
        expect(switching.tone).toBe('warn');
        expect(isMoving(switching)).toBe(true);
    });

    // The phase of a hibernated cluster is whatever it was before -- usually
    // "healthy" -- which is the wrong thing to show for a cluster with no pods.
    it('reads hibernation from the annotation and the condition, not the phase', () => {
        const asleep = clusterView(
            cluster(
                { phase: 'Cluster in healthy state', readyInstances: 0, conditions: [{ type: 'cnpg.io/hibernation', status: 'True', reason: 'Hibernated' }] },
                { instances: 1 },
                { 'cnpg.io/hibernation': 'on' },
            ),
        );
        expect(asleep.state).toBe('hibernated');
        expect(asleep.words).toBe('Hibernated');
        expect(asleep.tone).toBe('info');

        const going = clusterView(cluster({ phase: 'Cluster in healthy state', readyInstances: 1 }, { instances: 1 }, { 'cnpg.io/hibernation': 'on' }));
        expect(going.state).toBe('hibernating');
        // "off" is awake.
        expect(clusterView(cluster({ phase: 'Cluster in healthy state', readyInstances: 3 }, { instances: 3 }, { 'cnpg.io/hibernation': 'off' })).state).toBe('healthy');
    });

    it('shows a phase it does not know as written, in amber', () => {
        const view = clusterView(cluster({ phase: 'Doing something new' }));
        expect(view.words).toBe('Doing something new');
        expect(view.tone).toBe('warn');
    });

    it('does not guess about a cluster the operator has not reached', () => {
        const view = clusterView(cluster(undefined));
        expect(view.words).toBe('Not reconciled yet');
        expect(view.tone).toBe('');
    });

    it('knows every failing phase is an error', () => {
        for (const [phase, words] of Object.entries(PHASES)) {
            if (words.state === 'failing') expect(words.tone, phase).toBe('error');
        }
    });

    it('reads the synchronous settings, new and old', () => {
        expect(clusterView(cluster({}, { instances: 3, postgresql: { synchronous: { method: 'first', number: 2 } } })).sync).toEqual({ number: 2, method: 'first' });
        expect(clusterView(cluster({}, { instances: 3, minSyncReplicas: 1, maxSyncReplicas: 1 })).sync).toEqual({ number: 1, method: 'any' });
        expect(clusterView(cluster({}, { instances: 3 })).sync).toBe(null);
    });

    it('reads storage sizes as bytes, from size or the PVC template', () => {
        expect(clusterView(cluster({}, { instances: 1, storage: { size: '10Gi' } })).storage).toBe(10 * 1024 ** 3);
        expect(clusterView(cluster({}, { instances: 1, storage: { pvcTemplate: { resources: { requests: { storage: '5Gi' } } } } })).storage).toBe(5 * 1024 ** 3);
    });
});

describe('versionOf', () => {
    it.each([
        ['ghcr.io/cloudnative-pg/postgresql:18.6-system-trixie', '18.6'],
        ['ghcr.io/cloudnative-pg/postgresql:16', '16'],
        ['registry:5000/pg/postgresql:17.2@sha256:abc', '17.2'],
        ['ghcr.io/cloudnative-pg/postgresql@sha256:abc', ''],
        ['', ''],
    ])('%s is "%s"', (image, want) => {
        expect(versionOf(image)).toBe(want);
    });
});
