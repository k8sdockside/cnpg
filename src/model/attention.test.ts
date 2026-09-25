import { describe, expect, it } from 'vitest';
import { backups, clusters, nodes, pods, poolers, pvcs, scheduledBackups, services, shop } from '../fixtures.js';
import { issues, type ClusterFacts } from './attention.js';
import { summarise } from './backups.js';
import type { Backup, Cluster, ScheduledBackup } from './cnpg.js';
import { build } from './topology.js';

const NOW = Date.now();
const lag = new Map([['finance/ledger-3', 95]]);

function facts(list: unknown[] = clusters): ClusterFacts[] {
    return (list as Cluster[]).map((cluster) => ({
        topology: build(cluster, { pods, pvcs, poolers, services, nodes, lag }),
        backups: summarise(cluster, backups as Backup[], scheduledBackups as ScheduledBackup[], NOW),
    }));
}

describe('issues', () => {
    it('has nothing to say about a healthy cluster that backs up on time', () => {
        expect(issues(facts([shop]))).toEqual([]);
    });

    it('puts the worst first: errors, then warnings, then information', () => {
        const found = issues(facts());
        const tones = found.map((issue) => issue.tone);
        const rank = { error: 3, warn: 2, info: 1, ok: 0, '': 0 };
        expect([...tones].sort((a, b) => rank[b] - rank[a])).toEqual(tones);
        expect(found[0]?.tone).toBe('error');
    });

    it('finds every state the fixtures were made to show', () => {
        const titles = issues(facts()).map((issue) => issue.title);
        expect(titles).toEqual(
            expect.arrayContaining([
                'billing: failing over',
                'billing: pooler billing-pooler-rw is down',
                'orders: the last 2 backups failed',
                'orders: WAL archiving is failing',
                'ledger: ledger-3 is lagging',
                'ledger: last backup 3d 2h ago',
                'analytics: no backups',
                'analytics: a single instance',
                'archive: hibernated',
            ]),
        );
    });

    it('carries the tool s own error on a failed backup, and opens that backup', () => {
        const failed = issues(facts()).find((issue) => issue.title === 'orders: the last 2 backups failed');
        expect(failed?.detail).toContain('InvalidAccessKeyId');
        expect(failed?.ref).toEqual({ kind: 'crd:backups.postgresql.cnpg.io', namespace: 'cnpg-demo', name: 'orders-retry' });
    });

    it('says nothing else about a hibernated cluster', () => {
        const archive = issues(facts()).filter((issue) => issue.cluster === 'archive');
        expect(archive.map((issue) => issue.tone)).toEqual(['info']);
    });

    it('does not repeat "old" on top of "failed"', () => {
        const orders = issues(facts()).filter((issue) => issue.cluster === 'orders').map((issue) => issue.title);
        expect(orders.some((title) => title.includes('never backed up'))).toBe(false);
    });

    it('flags a schedule the operator cannot read', () => {
        const broken: ScheduledBackup = { metadata: { name: 'nightly', namespace: 'cnpg-demo' }, spec: { schedule: 'at 2am', cluster: { name: 'shop' } } };
        const cluster = shop as Cluster;
        const found = issues([{ topology: build(cluster, { pods, pvcs, poolers, services, nodes }), backups: summarise(cluster, backups as Backup[], [...(scheduledBackups as ScheduledBackup[]), broken], NOW) }]);
        expect(found.map((issue) => issue.title)).toContain('shop: schedule nightly cannot run');
    });
});
