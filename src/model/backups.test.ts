import { describe, expect, it } from 'vitest';
import { backupPlugin, backupView, freshness, methodsOf, scheduleView, summarise, windowWords } from './backups.js';
import type { Backup, Cluster, ScheduledBackup } from './cnpg.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function backup(name: string, phase: string, stoppedAgo: number, extra: Partial<NonNullable<Backup['status']>> = {}): Backup {
    return {
        metadata: { name, namespace: 'db', creationTimestamp: ago(stoppedAgo + MIN) },
        spec: { cluster: { name: 'shop' } },
        status: { phase, startedAt: ago(stoppedAgo + MIN), stoppedAt: ago(stoppedAgo), ...extra },
    };
}

function cluster(spec: Cluster['spec'] = {}, status: Cluster['status'] = {}): Cluster {
    return { metadata: { name: 'shop', namespace: 'db' }, spec: { instances: 1, ...spec }, status };
}

const barman = { backup: { barmanObjectStore: { destinationPath: 's3://x/' } } };

describe('backupView', () => {
    it('puts every phase the operator writes into one of five states', () => {
        const states = ['pending', 'started', 'running', 'finalizing', 'completed', 'failed', 'walArchivingFailing', 'invalid backup definition'].map((phase) => backupView(backup('b', phase, 0)).state);
        expect(states).toEqual(['pending', 'running', 'running', 'running', 'completed', 'failed', 'failed', 'failed']);
    });

    it('keeps the tool s error, and how long it took', () => {
        const view = backupView(backup('b', 'failed', 0, { error: '  exit status 4 ' }));
        expect(view.error).toBe('exit status 4');
        expect(view.took).toBe(MIN);
    });

    it('defaults the method to the object store, as the operator does', () => {
        expect(backupView(backup('b', 'completed', 0)).methodWords).toBe('object store');
        const plugin = backupView({ ...backup('b', 'completed', 0), spec: { cluster: { name: 'shop' }, method: 'plugin', pluginConfiguration: { name: 'barman-cloud.cloudnative-pg.io' } } });
        expect(plugin.methodWords).toBe('plugin barman-cloud.cloudnative-pg.io');
    });

    it('knows which schedule made it, by label or by owner', () => {
        const labelled = backup('b', 'completed', 0);
        labelled.metadata.labels = { 'cnpg.io/scheduled-backup': 'nightly' };
        expect(backupView(labelled).scheduledBy).toBe('nightly');
        const owned = backup('c', 'completed', 0);
        owned.metadata.ownerReferences = [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'ScheduledBackup', name: 'hourly', uid: 'u' }];
        expect(backupView(owned).scheduledBy).toBe('hourly');
    });
});

describe('freshness', () => {
    it('measures against the schedule when there is one', () => {
        const every = 10 * MIN;
        expect(freshness(NOW - 5 * MIN, every, true, NOW).tone).toBe('ok');
        expect(freshness(NOW - 25 * MIN, every, true, NOW).tone).toBe('warn');
        expect(freshness(NOW - 2 * HOUR, every, true, NOW).tone).toBe('error');
    });

    it('uses a day and a week without one', () => {
        expect(freshness(NOW - 20 * HOUR, undefined, true, NOW).tone).toBe('ok');
        expect(freshness(NOW - 3 * DAY, undefined, true, NOW).tone).toBe('warn');
        expect(freshness(NOW - 8 * DAY, undefined, true, NOW).tone).toBe('error');
    });

    it('says never, and not configured, in words', () => {
        expect(freshness(undefined, undefined, true, NOW).words).toBe('never');
        expect(freshness(undefined, undefined, false, NOW).words).toBe('not configured');
    });
});

describe('scheduleView', () => {
    const scheduled = (spec: ScheduledBackup['spec'], status: ScheduledBackup['status'] = {}): ScheduledBackup => ({ metadata: { name: 's', namespace: 'db' }, spec, status });

    it('prefers the operator s next run, and works one out without it', () => {
        expect(scheduleView(scheduled({ schedule: '0 0 2 * * *' }, { nextScheduleTime: ago(-HOUR) }), NOW).next).toBe(NOW + HOUR);
        expect(scheduleView(scheduled({ schedule: '0 0 2 * * *' }), NOW).next).toBe(Date.parse('2026-09-26T02:00:00Z'));
    });

    it('has no next run while suspended', () => {
        expect(scheduleView(scheduled({ schedule: '0 0 2 * * *', suspend: true }), NOW).next).toBeUndefined();
    });

    it('says when the schedule cannot be read', () => {
        expect(scheduleView(scheduled({ schedule: 'nightly' }), NOW).invalid).not.toBe('');
    });
});

describe('summarise', () => {
    it('finds the last and first recovery point on the Cluster', () => {
        const summary = summarise(cluster(barman, { lastSuccessfulBackup: ago(HOUR), firstRecoverabilityPoint: ago(5 * DAY) }), [], [], NOW);
        expect(summary.last).toBe(NOW - HOUR);
        expect(summary.firstPoint).toBe(NOW - 5 * DAY);
        expect(summary.estimated).toBe(false);
    });

    // A backup plugin does not set the Cluster's fields; the Backups still say.
    it('falls back to the Backup objects, and says it is an estimate', () => {
        const summary = summarise(cluster({ plugins: [{ name: 'barman-cloud.cloudnative-pg.io', isWALArchiver: true }] }), [backup('new', 'completed', HOUR), backup('old', 'completed', 4 * DAY)], [], NOW);
        expect(summary.last).toBe(NOW - HOUR);
        expect(summary.firstPoint).toBe(NOW - 4 * DAY);
        expect(summary.estimated).toBe(true);
        expect(summary.methods).toEqual(['plugin']);
    });

    it('lists only the failures since the last backup that worked', () => {
        const summary = summarise(cluster(barman), [backup('old-fail', 'failed', 3 * HOUR), backup('ok', 'completed', 2 * HOUR), backup('new-fail', 'failed', HOUR)], [], NOW);
        expect(summary.failures.map((b) => b.name)).toEqual(['new-fail']);
    });

    it('only counts the cluster s own backups', () => {
        const other = { ...backup('x', 'completed', HOUR), spec: { cluster: { name: 'other' } } };
        const elsewhere = { ...backup('y', 'completed', HOUR), metadata: { name: 'y', namespace: 'other-ns' } };
        expect(summarise(cluster(barman), [other, elsewhere], [], NOW).backups).toEqual([]);
    });

    it('reads WAL archiving from its condition', () => {
        const failing = summarise(cluster(barman, { conditions: [{ type: 'ContinuousArchiving', status: 'False' }] }), [], [], NOW);
        expect(failing.archiving).toBe(false);
        expect(summarise(cluster(), [], [], NOW).archiving).toBeUndefined();
    });

    it('calls a cluster with no backup section and no schedule unconfigured', () => {
        const summary = summarise(cluster(), [], [], NOW);
        expect(summary.configured).toBe(false);
        expect(summary.freshness.tone).toBe('warn');
    });

    it('measures staleness against the tightest active schedule', () => {
        const every10: ScheduledBackup = { metadata: { name: 's', namespace: 'db' }, spec: { schedule: '0 */10 * * * *', cluster: { name: 'shop' } } };
        const summary = summarise(cluster(barman, { lastSuccessfulBackup: ago(2 * HOUR) }), [], [every10], NOW);
        expect(summary.freshness.tone).toBe('error');
    });
});

describe('windowWords', () => {
    it('says how far back, and shouts when archiving has stopped', () => {
        const ok = summarise(cluster(barman, { firstRecoverabilityPoint: ago(6 * DAY + 4 * HOUR), conditions: [{ type: 'ContinuousArchiving', status: 'True' }] }), [], [], NOW);
        expect(windowWords(ok, NOW)).toEqual({ words: '6d 4h back', tone: 'ok' });
        const broken = summarise(cluster(barman, { firstRecoverabilityPoint: ago(DAY), conditions: [{ type: 'ContinuousArchiving', status: 'False' }] }), [], [], NOW);
        expect(windowWords(broken, NOW).tone).toBe('error');
    });
});

describe('methodsOf and backupPlugin', () => {
    it('reads the methods a cluster is set up for', () => {
        expect(methodsOf(cluster({ backup: { volumeSnapshot: { className: 'x' } } }))).toEqual(['volumeSnapshot']);
        expect(methodsOf(cluster())).toEqual([]);
    });

    it('picks the WAL archiver as the backup plugin', () => {
        expect(backupPlugin(cluster({ plugins: [{ name: 'other' }, { name: 'barman-cloud.cloudnative-pg.io', isWALArchiver: true }] }))).toBe('barman-cloud.cloudnative-pg.io');
        expect(backupPlugin(cluster())).toBe('');
    });
});
