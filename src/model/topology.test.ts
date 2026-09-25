import { describe, expect, it } from 'vitest';
import { archive, billing, ledger, nodes, orders, pods, poolers, pvcs, services, shop } from '../fixtures.js';
import type { Cluster } from './cnpg.js';
import { build, isInstancePod, podReady, type Sources } from './topology.js';

const sources: Sources = { pods, pvcs, poolers, services, nodes };

describe('build', () => {
    it('puts the primary in the middle and the standbys around it', () => {
        const topology = build(shop as Cluster, sources);
        expect(topology.primary?.name).toBe('shop-1');
        expect(topology.replicas.map((r) => r.name)).toEqual(['shop-2', 'shop-3']);
        expect(topology.tone).toBe('ok');
    });

    it('does not mistake a job pod for an instance', () => {
        const topology = build(shop as Cluster, sources);
        expect([topology.primary, ...topology.replicas].map((i) => i?.name)).not.toContain('shop-1-initdb-abcde');
    });

    it('reads node, zone, timeline and disks for each instance', () => {
        const replica = build(shop as Cluster, sources).replicas[0]!;
        expect(replica.node).toBe('kind-worker2');
        expect(replica.zone).toBe('zone-b');
        expect(replica.timeline).toBe(1);
        expect(replica.volumes.map((v) => [v.role, v.bytes])).toEqual([
            ['PG_DATA', 1024 ** 3],
            ['PG_WAL', 512 * 1024 ** 2],
        ]);
    });

    it('draws standbys as sync candidates when the cluster asks for synchronous replication', () => {
        const topology = build(shop as Cluster, sources);
        expect(topology.replicas.every((r) => r.link === 'sync')).toBe(true);
        expect(topology.syncWords).toBe('any 1 of 2 standbys must confirm each commit (synchronous)');
        expect(build(orders as Cluster, sources).replicas[0]?.link).toBe('async');
    });

    it('puts the lag from Prometheus on the standby, and colours it', () => {
        const lag = new Map([
            ['finance/ledger-1', 0],
            ['finance/ledger-3', 95],
        ]);
        const topology = build(ledger as Cluster, { ...sources, lag });
        expect(topology.primary?.name).toBe('ledger-2');
        const [one, three] = topology.replicas;
        expect(one?.tone).toBe('ok');
        expect(three?.tone).toBe('warn');
        expect(three?.note).toBe('streaming, 1m behind');
    });

    it('draws a failover: the old primary red, the new one on its way', () => {
        const topology = build(billing as Cluster, sources);
        expect(topology.primary?.name).toBe('billing-1');
        expect(topology.primary?.tone).toBe('error');
        expect(topology.primary?.trouble).toBe('CrashLoopBackOff');
        expect(topology.replicas[0]?.becomingPrimary).toBe(true);
        expect(topology.tone).toBe('error');
    });

    it('finds a hibernated cluster s instances from its volumes', () => {
        const topology = build(archive as Cluster, sources);
        expect(topology.primary?.name).toBe('archive-1');
        expect(topology.primary?.podFound).toBe(false);
        expect(topology.primary?.note).toBe('asleep: volume kept');
        expect(topology.syncWords).toMatch(/hibernated/);
    });

    it('lists poolers and the operator s services as the ways in', () => {
        const entries = build(shop as Cluster, sources).entries;
        expect(entries.map((e) => `${e.kind}:${e.name}:${e.type}`)).toEqual([
            'pooler:shop-pooler-rw:rw',
            'pooler:shop-pooler-ro:ro',
            'service:shop-rw:rw',
            'service:shop-ro:ro',
            'service:shop-r:r',
        ]);
        expect(entries[0]?.note).toContain('2 of 2 ready');
    });

    // A Pooler from an operator older than 1.30 has no status.phase: it is
    // judged by its pods.
    it('calls a pooler with no ready pod down, with or without a phase', () => {
        const pooler = build(billing as Cluster, sources).entries.find((e) => e.kind === 'pooler');
        expect(pooler?.tone).toBe('error');
        expect(pooler?.note).toContain('none of 2 ready');
    });

    it('notices when instances share a node', () => {
        const crowded = pods.map((pod) => (pod.metadata.name.startsWith('shop-') ? { ...pod, spec: { nodeName: 'kind-worker' } } : pod));
        expect(build(shop as Cluster, { ...sources, pods: crowded }).sharedNode).toBe(true);
        expect(build(shop as Cluster, sources).sharedNode).toBe(false);
    });

    it('only uses objects from the cluster s own namespace', () => {
        const stranger = { ...pods[1]!, metadata: { ...pods[1]!.metadata, namespace: 'elsewhere', name: 'shop-9' } };
        const topology = build(shop as Cluster, { ...sources, pods: [...pods, stranger] });
        expect(topology.replicas.map((r) => r.name)).not.toContain('shop-9');
    });
});

describe('pods', () => {
    it('reads readiness from the condition, or the containers without one', () => {
        expect(podReady({ metadata: { name: 'p' }, status: { conditions: [{ type: 'Ready', status: 'False' }], containerStatuses: [{ name: 'c', ready: true }] } })).toBe(false);
        expect(podReady({ metadata: { name: 'p' }, status: { containerStatuses: [{ name: 'c', ready: true }] } })).toBe(true);
        expect(podReady(undefined)).toBe(false);
    });

    it('knows an instance pod by its labels', () => {
        expect(isInstancePod({ metadata: { name: 'x-1', labels: { 'cnpg.io/cluster': 'x', 'cnpg.io/podRole': 'instance' } } }, 'x')).toBe(true);
        expect(isInstancePod({ metadata: { name: 'x-pooler', labels: { 'cnpg.io/cluster': 'x', 'cnpg.io/poolerName': 'p' } } }, 'x')).toBe(false);
        expect(isInstancePod({ metadata: { name: 'y-1', labels: { 'cnpg.io/cluster': 'y', role: 'primary' } } }, 'x')).toBe(false);
    });
});
