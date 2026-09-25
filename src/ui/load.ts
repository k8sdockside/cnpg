// Reading everything a page needs, in one go.
//
// Every page wants much the same things -- the Clusters, their Backups and
// schedules, the Poolers, the pods and PVCs the operator made -- so they are
// read together here, in parallel, and turned into the model's views. Only
// the Clusters are required: every other list may be refused (a missing
// CRD, a role that cannot list Nodes) and the page draws without it.
//
// Pods, PVCs and Services are asked for by the `cnpg.io/cluster` label, which
// the operator stamps on every instance pod, pooler pod, PVC and Service it
// makes, so a cluster with ten thousand other pods is not read in full every
// ten seconds.

import type { ClusterFacts } from '../model/attention.js';
import { summarise } from '../model/backups.js';
import {
    BACKUPS,
    CLUSTERS,
    LABEL,
    NODES,
    PODS,
    POOLERS,
    PVCS,
    SCHEDULED_BACKUPS,
    SERVICES,
    type Backup,
    type Cluster,
    type Node,
    type PersistentVolumeClaim,
    type Pod,
    type Pooler,
    type ScheduledBackup,
    type Service,
} from '../model/cnpg.js';
import { byPod } from '../model/metrics.js';
import { build } from '../model/topology.js';
import { maybeCharts, maybeList } from './page.js';

export interface World {
    now: number;
    clusters: Cluster[];
    backups: Backup[];
    schedules: ScheduledBackup[];
    poolers: Pooler[];
    pods: Pod[];
    pvcs: PersistentVolumeClaim[];
    services: Service[];
    nodes: Node[];
    charts: K8sDockside.ChartsPanel | null;
    facts: ClusterFacts[];
}

export interface LoadOptions {
    /** Ask Prometheus too, for lag and the charts. */
    charts?: boolean;
    minutes?: number;
    /** Read only what one namespace holds. */
    namespace?: string;
}

export async function load(options: LoadOptions = {}): Promise<World> {
    const namespace = options.namespace ?? '';
    const [clusters, backups, schedules, poolers, pods, pvcs, services, nodes, charts] = await Promise.all([
        k8sdockside.list<Cluster>({ kind: CLUSTERS, namespace }),
        maybeList<Backup>({ kind: BACKUPS, namespace }),
        maybeList<ScheduledBackup>({ kind: SCHEDULED_BACKUPS, namespace }),
        maybeList<Pooler>({ kind: POOLERS, namespace }),
        maybeList<Pod>({ kind: PODS, namespace, selector: LABEL.cluster }),
        maybeList<PersistentVolumeClaim>({ kind: PVCS, namespace, selector: LABEL.cluster }),
        maybeList<Service>({ kind: SERVICES, namespace, selector: LABEL.cluster }),
        maybeList<Node>({ kind: NODES }),
        options.charts ? maybeCharts(options.minutes ?? 60) : Promise.resolve(null),
    ]);
    const now = Date.now();
    const lag = byPod(charts?.charts.find((chart) => chart.id === 'replication-lag'));
    const facts = [...clusters]
        .sort((a, b) => (a.metadata.namespace ?? '').localeCompare(b.metadata.namespace ?? '') || a.metadata.name.localeCompare(b.metadata.name))
        .map((cluster) => ({
            topology: build(cluster, { pods, pvcs, poolers, services, nodes, lag }),
            backups: summarise(cluster, backups, schedules, now),
        }));
    return { now, clusters, backups, schedules, poolers, pods, pvcs, services, nodes, charts, facts };
}
