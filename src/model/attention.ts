// Everything that needs a person, worst first.
//
// Each rule here is a question someone running Postgres actually asks, and
// each finding is written as the answer: "orders: the last 2 backups failed"
// with the tool's error beside it, not "Backup phase=failed". The order is
// by how bad it is, then by cluster, because a failing cluster three rows
// below a hibernated one is the attention list failing at its one job.
//
//   error   the cluster is failing or failing over; a standby is not
//           streaming; the latest backups failed; WAL archiving is failing;
//           the last backup is far older than its schedule; a pooler has no
//           ready pod; a schedule the operator cannot read
//   warn    fewer instances ready than asked for; a switchover; a standby
//           lagging; no backup at all, or an old one; a pooler short of pods
//   info    hibernated; a suspended schedule; a single instance

import type { BackupSummary } from './backups.js';
import { BACKUPS, CLUSTERS, PODS, POOLERS, SCHEDULED_BACKUPS } from './cnpg.js';
import type { Topology } from './topology.js';
import { count, severity, span, type Tone } from './units.js';

export interface Issue {
    tone: Tone;
    /** Which cluster it is about. */
    cluster: string;
    title: string;
    detail: string;
    /** The object a click should open. */
    ref: K8sDockside.ObjectRef;
}

export interface ClusterFacts {
    topology: Topology;
    backups: BackupSummary;
}

export function issues(clusters: ClusterFacts[]): Issue[] {
    const found: Issue[] = [];
    for (const { topology, backups } of clusters) {
        const view = topology.view;
        const at = { kind: CLUSTERS, namespace: view.namespace, name: view.name };
        const add = (tone: Tone, title: string, detail: string, ref: K8sDockside.ObjectRef = at) =>
            found.push({ tone, cluster: view.name, title: `${view.name}: ${title}`, detail, ref });

        if (view.state === 'hibernated' || view.state === 'hibernating') {
            add('info', view.state === 'hibernated' ? 'hibernated' : 'going into hibernation', 'No pods run and the volumes are kept. Wake it up to use it again.');
            // Nothing else about a sleeping cluster is news.
            continue;
        }

        if (view.state === 'failing') add('error', view.words.toLowerCase(), view.phaseReason || view.phase);
        else if (view.state === 'failover') add('error', 'failing over', `The primary ${view.primary} failed; ${view.targetPrimary === 'pending' || !view.targetPrimary ? 'a replica' : view.targetPrimary} is being promoted.`);
        else if (view.state === 'switchover') add('warn', 'switchover in progress', `The primary is moving from ${view.primary} to ${view.targetPrimary}.`);
        else if (view.state === 'degraded') add(view.tone === 'error' ? 'error' : 'warn', view.words, `${view.ready} of ${count(view.instances, 'instance')} ready.`);
        else if (view.tone === 'warn' && view.state === 'working') add('warn', view.words.toLowerCase(), view.phaseReason || view.phase);

        if (topology.primary && !topology.primary.ready && view.state !== 'failover' && view.state !== 'switchover') {
            add('error', `the primary ${topology.primary.name} is not ready`, topology.primary.trouble || 'Writes are failing until it is back or a replica is promoted.', { kind: PODS, namespace: view.namespace, name: topology.primary.name });
        }
        for (const replica of topology.replicas) {
            const pod = { kind: PODS, namespace: view.namespace, name: replica.name };
            if (!replica.streaming) add('error', `${replica.name} is not streaming`, replica.trouble ? `The standby is ${replica.trouble}.` : 'The standby is not ready, so it is not keeping up with the primary.', pod);
            // A standby being promoted is the failover above, not a lag.
            else if (!replica.becomingPrimary && (replica.tone === 'error' || replica.tone === 'warn')) add(replica.tone, `${replica.name} is lagging`, `${span((replica.lag ?? 0) * 1000)} behind the primary.`, pod);
        }
        if (view.instances === 1 && topology.replicas.length === 0) {
            add('info', 'a single instance', 'Nothing stands by if its pod or its node goes; add instances for a standby to fail over to.');
        } else if (topology.sharedNode) {
            add('warn', 'instances share a node', `${count(topology.nodes.length, 'node')} for ${count(topology.replicas.length + (topology.primary ? 1 : 0), 'instance')}: losing one node loses more than one of them.`);
        }

        for (const entry of topology.entries) {
            if (entry.kind !== 'pooler' || entry.tone === 'ok' || entry.tone === '') continue;
            add(entry.tone, `pooler ${entry.name} ${entry.tone === 'error' ? 'is down' : 'is short of pods'}`, entry.note, { kind: POOLERS, namespace: view.namespace, name: entry.name });
        }

        // Backups. A failure is only news until a later backup works.
        if (backups.failures.length > 0) {
            const latest = backups.failures[0]!;
            const title = backups.failures.length === 1 ? 'the last backup failed' : `the last ${backups.failures.length} backups failed`;
            add('error', title, latest.error || latest.words, { kind: BACKUPS, namespace: view.namespace, name: latest.name });
        }
        if (backups.archiving === false) {
            const message = (view.cluster.status?.conditions ?? []).find((c) => c.type === 'ContinuousArchiving')?.message ?? '';
            add('error', 'WAL archiving is failing', message || 'Changes since the last backup are not being saved anywhere, so a restore cannot reach them.');
        }
        if (!backups.configured) add('warn', 'no backups', backups.freshness.why);
        else if (backups.failures.length === 0 && (backups.freshness.tone === 'error' || backups.freshness.tone === 'warn')) {
            // With failures listed above, "and so it is old" says nothing new.
            add(backups.freshness.tone, backups.last === undefined ? 'never backed up' : `last backup ${backups.freshness.words}`, backups.freshness.why);
        }
        for (const schedule of backups.schedules) {
            const ref = { kind: SCHEDULED_BACKUPS, namespace: schedule.namespace, name: schedule.name };
            if (schedule.invalid) add('error', `schedule ${schedule.name} cannot run`, `"${schedule.schedule}": ${schedule.invalid}. CloudNativePG's schedule has six fields, seconds first.`, ref);
            else if (schedule.error) add('error', `schedule ${schedule.name} is refused`, schedule.error, ref);
            else if (schedule.suspended) add('info', `schedule ${schedule.name} is suspended`, 'No backups are taken on it until it is resumed.', ref);
        }
    }
    return found.sort((a, b) => severity(b.tone) - severity(a.tone) || a.cluster.localeCompare(b.cluster) || a.title.localeCompare(b.title));
}
