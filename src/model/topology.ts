// A Postgres cluster as a picture: one primary, its standbys, and the ways in.
//
// No single object holds this. The Cluster's status names the instances and
// which is primary; the pods say whether each is ready and on which node; the
// nodes carry the zone; the PVCs, labelled with the instance they belong to,
// say how big each disk is; the Poolers and Services are the entry points.
// This file puts them together, and nothing here draws.
//
// What the Kubernetes API does not say, and this therefore does not claim:
// which standbys are synchronous *right now*. The spec says how many should
// be and how they are chosen (`synchronous.number` and `method`); Postgres
// decides which, and only `kubectl cnpg status` -- which asks the instance
// manager over HTTP -- can tell. So a standby is drawn as a sync *candidate*
// when the cluster asks for synchronous replication, and as async when it
// does not, and the words beside the picture say which rule applies.

import { LABEL, key, type Cluster, type Node, type PersistentVolumeClaim, type Pod, type Pooler, type Service } from './cnpg.js';
import { clusterView, type ClusterView } from './health.js';
import { LAG_ERROR, LAG_WARN } from './metrics.js';
import { quantity, span, worst, type Tone } from './units.js';

/** Node labels a zone is read from, the well-known one first. */
const ZONE_LABELS = ['topology.kubernetes.io/zone', 'failure-domain.beta.kubernetes.io/zone'];

export interface Volume {
    name: string;
    /** `PG_DATA`, `PG_WAL`, `PG_TABLESPACE`, or '' when unlabelled. */
    role: string;
    bytes: number;
    phase: string;
}

export interface Instance {
    name: string;
    namespace: string;
    primary: boolean;
    /** The instance a switchover or failover is moving the primary to. */
    becomingPrimary: boolean;
    /** `healthy`, `replicating` or `failed` from the Cluster's status; '' when it does not list the instance. */
    reported: string;
    podFound: boolean;
    ready: boolean;
    /** Why it is not ready, in the kubelet's words: CrashLoopBackOff, Pending ... */
    trouble: string;
    restarts: number;
    node: string;
    zone: string;
    timeline: number | undefined;
    volumes: Volume[];
    /** Seconds behind the primary, from Prometheus; undefined when unknown. */
    lag: number | undefined;
    /** Whether a standby streams from the primary as far as can be told. */
    streaming: boolean;
    link: 'sync' | 'async' | 'none';
    tone: Tone;
    /** One line on it: "streaming, 0s behind", "not ready: CrashLoopBackOff". */
    note: string;
}

export interface EntryPoint {
    kind: 'pooler' | 'service';
    name: string;
    namespace: string;
    /** `rw`, `ro` or `r`: to the primary, to the standbys, or to any instance. */
    type: string;
    /** Pooler pods ready, and asked for. Services have neither. */
    ready: number;
    wanted: number;
    tone: Tone;
    note: string;
}

export interface Topology {
    view: ClusterView;
    primary: Instance | undefined;
    replicas: Instance[];
    entries: EntryPoint[];
    /** "any 1 of 2 standbys is synchronous", "asynchronous replication". */
    syncWords: string;
    /** Distinct nodes the instances are on, and whether one node holds more than one. */
    nodes: string[];
    sharedNode: boolean;
    tone: Tone;
}

export interface Sources {
    pods: Pod[];
    pvcs: PersistentVolumeClaim[];
    poolers: Pooler[];
    services: Service[];
    nodes: Node[];
    /** Replication lag in seconds by `namespace/pod`, from the exporter. */
    lag?: Map<string, number>;
}

/** Whether a pod counts as ready: its Ready condition, or every container ready. */
export function podReady(pod: Pod | undefined): boolean {
    if (!pod) return false;
    const cond = pod.status?.conditions?.find((c) => c.type === 'Ready');
    if (cond) return cond.status === 'True';
    const containers = pod.status?.containerStatuses ?? [];
    return containers.length > 0 && containers.every((c) => c.ready === true);
}

/** The kubelet's reason a pod is not running properly, or ''. */
export function podTrouble(pod: Pod | undefined): string {
    if (!pod) return 'no pod';
    for (const container of pod.status?.containerStatuses ?? []) {
        const reason = container.state?.waiting?.reason ?? container.state?.terminated?.reason;
        if (reason) return reason;
    }
    if (pod.status?.phase && pod.status.phase !== 'Running') return pod.status.phase;
    return podReady(pod) ? '' : 'not ready';
}

/** Whether a pod is one of a cluster's Postgres instances (not a job, not a pooler). */
export function isInstancePod(pod: Pod, cluster: string): boolean {
    const labels = pod.metadata.labels ?? {};
    if (labels[LABEL.cluster] !== cluster) return false;
    if (labels[LABEL.jobRole] || labels[LABEL.poolerName]) return false;
    return labels[LABEL.podRole] === 'instance' || labels[LABEL.instanceName] !== undefined || labels[LABEL.instanceRole] !== undefined || labels[LABEL.legacyRole] !== undefined;
}

export function build(cluster: Cluster, sources: Sources): Topology {
    const view = clusterView(cluster);
    const { name, namespace } = view;
    const status = cluster.status ?? {};
    const inNamespace = <T extends K8sDockside.KubeObject>(items: T[]) => items.filter((item) => (item.metadata.namespace ?? '') === namespace);

    const pods = inNamespace(sources.pods).filter((pod) => isInstancePod(pod, name));
    const podsByName = new Map(pods.map((pod) => [pod.metadata.name, pod]));
    const nodesByName = new Map(sources.nodes.map((node) => [node.metadata.name, node]));

    // Every instance anything knows about: the status's list, the reported
    // states, and the pods -- a new replica has a pod before the status
    // catches up, and a lost one is still in the status after its pod is gone.
    // A hibernated cluster has none of these left, so its PVCs name them.
    const names = new Set<string>([...(status.instanceNames ?? []), ...Object.keys(status.instancesReportedState ?? {}), ...pods.map((pod) => pod.metadata.name)]);
    const claims = inNamespace(sources.pvcs).filter((pvc) => pvc.metadata.labels?.[LABEL.cluster] === name);
    if (names.size === 0) {
        for (const pvc of claims) {
            const instance = pvc.metadata.labels?.[LABEL.instanceName];
            if (instance) names.add(instance);
        }
    }

    const reported = new Map<string, string>();
    for (const [state, list] of Object.entries(status.instancesStatus ?? {})) {
        for (const instance of list ?? []) reported.set(instance, state);
    }

    const hibernated = view.state === 'hibernated';
    const primaryName = view.primary;
    const moving = view.targetPrimary && view.targetPrimary !== primaryName && view.targetPrimary !== 'pending' ? view.targetPrimary : '';

    const instances: Instance[] = [...names].sort(byOrdinal).map((instance) => {
        const pod = podsByName.get(instance);
        const labels = pod?.metadata.labels ?? {};
        const role = labels[LABEL.instanceRole] ?? labels[LABEL.legacyRole] ?? '';
        const primary = instance === primaryName || (!primaryName && (role === 'primary' || status.instancesReportedState?.[instance]?.isPrimary === true));
        const nodeName = pod?.spec?.nodeName ?? '';
        const node = nodesByName.get(nodeName);
        const topologyLabels = status.topology?.instances?.[instance] ?? {};
        const zone = ZONE_LABELS.map((label) => node?.metadata.labels?.[label] ?? topologyLabels[label]).find((z) => z) ?? '';
        const volumes = claims
            .filter((pvc) => pvc.metadata.labels?.[LABEL.instanceName] === instance || pvc.metadata.name === instance || pvc.metadata.name === `${instance}-wal`)
            .map((pvc) => ({
                name: pvc.metadata.name,
                role: pvc.metadata.labels?.[LABEL.pvcRole] ?? (pvc.metadata.name.endsWith('-wal') ? 'PG_WAL' : 'PG_DATA'),
                bytes: quantity(pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage),
                phase: pvc.status?.phase ?? '',
            }))
            .sort((a, b) => a.role.localeCompare(b.role));
        const ready = podReady(pod);
        const lag = sources.lag?.get(key(namespace, instance));
        return {
            name: instance,
            namespace,
            primary,
            becomingPrimary: instance === moving,
            reported: reported.get(instance) ?? '',
            podFound: pod !== undefined,
            ready,
            trouble: hibernated ? '' : podTrouble(pod),
            restarts: (pod?.status?.containerStatuses ?? []).reduce((n, c) => n + (c.restartCount ?? 0), 0),
            node: nodeName,
            zone,
            timeline: status.instancesReportedState?.[instance]?.timeLineID,
            volumes,
            lag,
            streaming: false,
            link: 'none' as const,
            tone: '' as Tone,
            note: '',
        };
    });

    const primary = instances.find((i) => i.primary);
    const replicas = instances.filter((i) => !i.primary);
    const sync = view.sync;

    for (const instance of instances) judge(instance, { hibernated, sync: sync !== null && !view.replicaCluster });

    const syncWords = hibernated
        ? 'hibernated: nothing replicates while the pods are gone'
        : replicas.length === 0
          ? 'no standby: a single instance'
          : view.replicaCluster
            ? `a replica cluster: the primary here follows ${cluster.spec?.replica?.source ?? 'another cluster'}`
            : sync
              ? `${sync.method === 'first' ? 'the first' : 'any'} ${sync.number} of ${replicas.length} standby${replicas.length === 1 ? '' : 's'} must confirm each commit (synchronous)`
              : 'asynchronous: commits do not wait for a standby';

    const entries = entryPoints(cluster, view, inNamespace(sources.poolers), inNamespace(sources.pods), inNamespace(sources.services));
    const nodeNames = instances.map((i) => i.node).filter((n) => n !== '');
    const distinct = [...new Set(nodeNames)];

    let tone: Tone = view.tone;
    for (const instance of instances) tone = worst(tone, instance.tone === 'ok' ? '' : instance.tone);

    return {
        view,
        primary,
        replicas,
        entries,
        syncWords,
        nodes: distinct,
        sharedNode: distinct.length < nodeNames.length,
        tone,
    };
}

/** Decides an instance's tone, its link to the primary, and its line of words. */
function judge(instance: Instance, context: { hibernated: boolean; sync: boolean }): void {
    if (context.hibernated) {
        instance.tone = '';
        instance.note = 'asleep: volume kept';
        instance.link = instance.primary ? 'none' : context.sync ? 'sync' : 'async';
        return;
    }
    if (instance.primary) {
        instance.tone = instance.ready ? 'ok' : 'error';
        instance.note = instance.ready ? 'primary: takes the writes' : `primary, not ready${instance.trouble ? `: ${instance.trouble}` : ''}`;
        return;
    }
    instance.link = context.sync ? 'sync' : 'async';
    if (!instance.ready || instance.reported === 'failed') {
        instance.streaming = false;
        instance.tone = 'error';
        instance.note = `not streaming${instance.trouble ? `: ${instance.trouble}` : ''}`;
        return;
    }
    instance.streaming = true;
    if (instance.lag !== undefined && instance.lag >= LAG_ERROR) {
        instance.tone = 'error';
        instance.note = `streaming, ${span(instance.lag * 1000)} behind`;
    } else if (instance.lag !== undefined && instance.lag >= LAG_WARN) {
        instance.tone = 'warn';
        instance.note = `streaming, ${span(instance.lag * 1000)} behind`;
    } else {
        instance.tone = 'ok';
        instance.note = instance.lag === undefined ? 'streaming' : instance.lag < 1 ? 'streaming, in step' : `streaming, ${span(instance.lag * 1000)} behind`;
    }
    if (instance.becomingPrimary) {
        instance.tone = worst(instance.tone, 'warn');
        instance.note = 'being promoted to primary';
    }
}

function entryPoints(cluster: Cluster, view: ClusterView, poolers: Pooler[], pods: Pod[], services: Service[]): EntryPoint[] {
    const out: EntryPoint[] = [];
    for (const pooler of poolers) {
        if (pooler.spec?.cluster?.name !== view.name) continue;
        const name = pooler.metadata.name;
        const mine = pods.filter((pod) => pod.metadata.labels?.[LABEL.poolerName] === name);
        const ready = mine.filter(podReady).length;
        const wanted = pooler.spec?.instances ?? 1;
        const phase = pooler.status?.phase ?? '';
        const paused = pooler.spec?.pgbouncer?.paused === true || phase === 'paused';
        let tone: Tone = 'ok';
        let note = `${ready} of ${wanted} ready`;
        if (phase === 'failed' || phase === 'inactive') {
            tone = 'error';
            note = pooler.status?.phaseReason || pooler.status?.error || phase;
        } else if (view.state === 'hibernated') {
            tone = '';
            note = 'no primary to send to while hibernated';
        } else if (wanted > 0 && ready === 0) {
            tone = 'error';
            note = `none of ${wanted} ready`;
        } else if (ready < wanted) {
            tone = 'warn';
        }
        if (paused) {
            tone = worst(tone, 'warn');
            note = `paused: holding new connections · ${note}`;
        }
        const mode = pooler.spec?.pgbouncer?.poolMode;
        out.push({ kind: 'pooler', name, namespace: view.namespace, type: pooler.spec?.type ?? 'rw', ready, wanted, tone, note: mode ? `${note} · ${mode} pooling` : note });
    }
    // The three Services the operator makes, when they exist. Any of them can
    // be switched off in `spec.managed.services`, so they are read, not assumed.
    for (const [suffix, type, words] of [
        ['-rw', 'rw', 'the primary'],
        ['-ro', 'ro', 'the standbys'],
        ['-r', 'r', 'any instance'],
    ] as const) {
        const service = services.find((s) => s.metadata.name === `${cluster.metadata.name}${suffix}`);
        if (!service) continue;
        const port = service.spec?.ports?.[0]?.port;
        out.push({ kind: 'service', name: service.metadata.name, namespace: view.namespace, type, ready: 0, wanted: 0, tone: '', note: `to ${words}${port ? ` on port ${port}` : ''}` });
    }
    return out;
}

/** shop-1, shop-2, shop-10 -- in the order the operator made them, not the alphabet's. */
function byOrdinal(a: string, b: string): number {
    const na = Number(/-(\d+)$/.exec(a)?.[1] ?? NaN);
    const nb = Number(/-(\d+)$/.exec(b)?.[1] ?? NaN);
    if (Number.isFinite(na) && Number.isFinite(nb) && a.replace(/\d+$/, '') === b.replace(/\d+$/, '')) return na - nb;
    return a.localeCompare(b);
}
