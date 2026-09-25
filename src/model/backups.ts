// Backups: what happened, what happens next, and how far back you can go.
//
// Three things are worth knowing about a cluster's backups, and CloudNativePG
// keeps them in three places:
//
//   what happened          one Backup object per base backup, with a phase
//                          (pending, started, running, finalizing, completed,
//                          failed, walArchivingFailing, "invalid backup
//                          definition") and the tool's own error when it fails
//   what happens next      ScheduledBackups, whose `status.nextScheduleTime`
//                          the operator keeps, and whose `spec.schedule` is a
//                          six-field cron (see cron.ts)
//   how far back you can   `status.firstRecoverabilityPoint` on the Cluster --
//   restore to             the oldest moment a point-in-time recovery can
//                          reach -- and `lastSuccessfulBackup` beside it
//
// The Cluster's two fields are deprecated and not set when a backup plugin
// (the Barman Cloud plugin, say) does the backups, so both fall back to what
// the Backup objects say: the oldest and newest completed backup. That is an
// estimate -- the plugin keeps its own retention -- and is marked as one.

import { cronFor } from './cron.js';
import { LABEL, type Backup, type Cluster, type ScheduledBackup } from './cnpg.js';
import { DAY, HOUR, parseTime, span, type Tone } from './units.js';

export type BackupState = 'completed' | 'failed' | 'running' | 'pending' | 'unknown';

const PHASES: Record<string, { state: BackupState; words: string; tone: Tone }> = {
    pending: { state: 'pending', words: 'Pending', tone: 'info' },
    started: { state: 'running', words: 'Started', tone: 'info' },
    running: { state: 'running', words: 'Running', tone: 'info' },
    finalizing: { state: 'running', words: 'Finalizing', tone: 'info' },
    completed: { state: 'completed', words: 'Completed', tone: 'ok' },
    failed: { state: 'failed', words: 'Failed', tone: 'error' },
    walArchivingFailing: { state: 'failed', words: 'WAL archiving failing', tone: 'error' },
    'invalid backup definition': { state: 'failed', words: 'Invalid definition', tone: 'error' },
};

/** A backup method, as a person would say it. */
export function methodWords(method: string, plugin = ''): string {
    switch (method) {
        case 'barmanObjectStore':
            return 'object store';
        case 'volumeSnapshot':
            return 'volume snapshot';
        case 'plugin':
            return plugin ? `plugin ${plugin}` : 'plugin';
        default:
            return method || 'object store';
    }
}

export interface BackupView {
    backup: Backup;
    name: string;
    namespace: string;
    cluster: string;
    phase: string;
    state: BackupState;
    words: string;
    tone: Tone;
    /** `barmanObjectStore`, `volumeSnapshot` or `plugin`; the default is the first. */
    method: string;
    methodWords: string;
    /** When it happened, for a timeline: when it stopped, else started, else was created. */
    at: number | undefined;
    started: number | undefined;
    stopped: number | undefined;
    /** Milliseconds it took, when it finished. */
    took: number | undefined;
    /** What went wrong, in the tool's own words. */
    error: string;
    /** The ScheduledBackup that made it, or '' for one somebody asked for. */
    scheduledBy: string;
    /** The pod it was taken from. */
    instance: string;
}

export function backupView(backup: Backup): BackupView {
    const phase = backup.status?.phase ?? '';
    const known = PHASES[phase];
    const method = backup.status?.method ?? backup.spec?.method ?? 'barmanObjectStore';
    const started = parseTime(backup.status?.startedAt);
    const stopped = parseTime(backup.status?.stoppedAt);
    const created = parseTime(backup.metadata.creationTimestamp);
    const owner = (backup.metadata.ownerReferences ?? []).find((ref) => ref.kind === 'ScheduledBackup');
    return {
        backup,
        name: backup.metadata.name,
        namespace: backup.metadata.namespace ?? '',
        cluster: backup.spec?.cluster?.name ?? '',
        phase,
        state: known?.state ?? (phase ? 'unknown' : 'pending'),
        words: known?.words ?? (phase || 'Not started'),
        tone: known?.tone ?? (phase ? 'warn' : 'info'),
        method,
        methodWords: methodWords(method, backup.spec?.pluginConfiguration?.name ?? ''),
        at: stopped ?? started ?? created,
        started,
        stopped,
        took: started !== undefined && stopped !== undefined && stopped >= started ? stopped - started : undefined,
        error: (backup.status?.error || backup.status?.commandError || '').trim(),
        scheduledBy: backup.metadata.labels?.[LABEL.scheduledBackup] ?? owner?.name ?? '',
        instance: backup.status?.instanceID?.podName ?? '',
    };
}

export interface ScheduleView {
    scheduled: ScheduledBackup;
    name: string;
    namespace: string;
    cluster: string;
    schedule: string;
    /** "every 10 minutes", or "on a custom schedule". */
    words: string;
    /** Why the schedule cannot be read, when it cannot. */
    invalid: string;
    suspended: boolean;
    method: string;
    methodWords: string;
    /** The next run: the operator's, else worked out from the schedule. */
    next: number | undefined;
    /** How often it runs, for how stale "stale" is. */
    every: number | undefined;
    last: number | undefined;
    error: string;
}

export function scheduleView(scheduled: ScheduledBackup, now: number): ScheduleView {
    const schedule = scheduled.spec?.schedule ?? '';
    const cron = cronFor(schedule, now);
    const method = scheduled.spec?.method ?? 'barmanObjectStore';
    const suspended = scheduled.spec?.suspend === true;
    const fromStatus = parseTime(scheduled.status?.nextScheduleTime);
    return {
        scheduled,
        name: scheduled.metadata.name,
        namespace: scheduled.metadata.namespace ?? '',
        cluster: scheduled.spec?.cluster?.name ?? '',
        schedule,
        words: cron.words,
        invalid: cron.error,
        suspended,
        method,
        methodWords: methodWords(method, scheduled.spec?.pluginConfiguration?.name ?? ''),
        // A suspended schedule has no next run, whatever the status last said.
        next: suspended ? undefined : fromStatus !== undefined && fromStatus > now ? fromStatus : cron.next,
        every: cron.every,
        last: parseTime(scheduled.status?.lastScheduleTime),
        error: scheduled.status?.error ?? '',
    };
}

/** What a cluster's backups add up to. */
export interface BackupSummary {
    /** How the cluster is set up to back up: methods, or none at all. */
    methods: string[];
    configured: boolean;
    last: number | undefined;
    lastFailed: number | undefined;
    /** The oldest moment a point-in-time recovery can reach. */
    firstPoint: number | undefined;
    /** True when the two above come from Backup objects rather than the Cluster. */
    estimated: boolean;
    /** Whether continuous WAL archiving is working, when the cluster archives at all. */
    archiving: boolean | undefined;
    freshness: Freshness;
    backups: BackupView[];
    schedules: ScheduleView[];
    running: BackupView[];
    /** Failed backups newer than the last one that worked: the ones still worth reading. */
    failures: BackupView[];
    /** The soonest next run of an active schedule. */
    next: number | undefined;
}

export interface Freshness {
    tone: Tone;
    /** "3h ago", "never", "no backups configured". */
    words: string;
    /** Why that tone: "older than twice its schedule (every 10 minutes)". */
    why: string;
}

/**
 * How stale the last backup is.
 *
 * With a schedule, "stale" is measured against it: two missed runs is a
 * warning, six is an error -- a backup every ten minutes that is an hour
 * old is as broken as a daily one that is six days old. Without one, a day
 * and a bit is a warning and a week is an error, which is what anybody means
 * by "we back up daily" whether or not they wrote it down.
 */
export function freshness(last: number | undefined, every: number | undefined, configured: boolean, now: number): Freshness {
    if (!configured) return { tone: 'warn', words: 'not configured', why: 'This cluster has no backup configuration: nothing could bring its data back.' };
    if (last === undefined) return { tone: 'warn', words: 'never', why: 'Backups are configured, but none has completed yet.' };
    const age = Math.max(0, now - last);
    const words = `${span(age)} ago`;
    const warnAfter = every ? Math.max(2 * every, 10 * 60 * 1000) : 26 * HOUR;
    const errorAfter = every ? Math.max(6 * every, 30 * 60 * 1000) : 7 * DAY;
    const basis = every ? `its schedule runs every ${span(every)}` : 'there is no schedule, so a day is the measure';
    if (age > errorAfter) return { tone: 'error', words, why: `Much older than it should be: ${basis}.` };
    if (age > warnAfter) return { tone: 'warn', words, why: `Older than it should be: ${basis}.` };
    return { tone: 'ok', words, why: every ? `On schedule: ${basis}.` : 'Within the last day.' };
}

/** The backup methods a cluster is set up for. */
export function methodsOf(cluster: Cluster): string[] {
    const backup = cluster.spec?.backup;
    const methods: string[] = [];
    if (backup?.barmanObjectStore) methods.push('barmanObjectStore');
    if (backup?.volumeSnapshot) methods.push('volumeSnapshot');
    if ((cluster.spec?.plugins ?? []).some((plugin) => plugin.isWALArchiver || /barman/i.test(plugin.name ?? ''))) methods.push('plugin');
    return methods;
}

/** The plugin that archives WAL, which is the one a `plugin` backup should name. */
export function backupPlugin(cluster: Cluster): string {
    const plugins = (cluster.spec?.plugins ?? []).filter((plugin) => plugin.enabled !== false);
    return (plugins.find((plugin) => plugin.isWALArchiver) ?? plugins.find((plugin) => /barman/i.test(plugin.name ?? '')))?.name ?? '';
}

export function summarise(cluster: Cluster, allBackups: Backup[], allSchedules: ScheduledBackup[], now: number): BackupSummary {
    const name = cluster.metadata.name;
    const namespace = cluster.metadata.namespace ?? '';
    const backups = allBackups
        .filter((b) => (b.metadata.namespace ?? '') === namespace && b.spec?.cluster?.name === name)
        .map(backupView)
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const schedules = allSchedules
        .filter((s) => (s.metadata.namespace ?? '') === namespace && s.spec?.cluster?.name === name)
        .map((s) => scheduleView(s, now));

    const completed = backups.filter((b) => b.state === 'completed');
    const status = cluster.status ?? {};
    const fromCluster = parseTime(status.lastSuccessfulBackup);
    const fromBackups = completed[0]?.stopped ?? completed[0]?.at;
    const last = [fromCluster, fromBackups].filter((t): t is number => t !== undefined).sort((a, b) => b - a)[0];

    const firstFromCluster = parseTime(status.firstRecoverabilityPoint);
    const oldest = completed[completed.length - 1];
    const firstFromBackups = oldest?.stopped ?? oldest?.at;
    const firstPoint = firstFromCluster ?? firstFromBackups;

    const methods = methodsOf(cluster);
    const configured = methods.length > 0 || schedules.length > 0;
    const active = schedules.filter((s) => !s.suspended && !s.invalid);
    const every = active.map((s) => s.every).filter((e): e is number => e !== undefined).sort((a, b) => a - b)[0];
    const next = active.map((s) => s.next).filter((n): n is number => n !== undefined).sort((a, b) => a - b)[0];

    const lastOk = last ?? -Infinity;
    const failures = backups.filter((b) => b.state === 'failed' && (b.at ?? 0) > lastOk);
    const archivingCondition = (status.conditions ?? []).find((c) => c.type === 'ContinuousArchiving');

    return {
        methods,
        configured,
        last,
        lastFailed: parseTime(status.lastFailedBackup) ?? backups.find((b) => b.state === 'failed')?.at,
        firstPoint,
        estimated: firstFromCluster === undefined && firstFromBackups !== undefined,
        archiving: archivingCondition ? archivingCondition.status === 'True' : undefined,
        freshness: freshness(last, every, configured, now),
        backups,
        schedules,
        running: backups.filter((b) => b.state === 'running' || b.state === 'pending'),
        failures,
        next,
    };
}

/**
 * The window a point-in-time recovery can reach, as a phrase: "6d 4h, since
 * <date>". With WAL archiving failing the window no longer reaches the
 * present, and that is the one thing about it worth shouting.
 */
export function windowWords(summary: BackupSummary, now: number): { words: string; tone: Tone } {
    if (summary.firstPoint === undefined) {
        return { words: summary.configured ? 'no recovery point yet' : 'none', tone: summary.configured ? 'warn' : '' };
    }
    const reach = span(now - summary.firstPoint);
    if (summary.archiving === false) return { words: `${reach} — but WAL archiving is failing, so not up to now`, tone: 'error' };
    return { words: `${reach} back${summary.estimated ? ' (estimated)' : ''}`, tone: 'ok' };
}
