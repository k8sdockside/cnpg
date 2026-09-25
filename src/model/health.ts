// What state a Postgres cluster is in, in plain words.
//
// CloudNativePG writes a cluster's state as a sentence in `status.phase` --
// "Cluster in healthy state", "Switchover in progress", "Waiting for the
// instances to become active" -- and the list of them is fixed in
// api/v1/cluster_types.go. Each is mapped here to a short phrase and a tone,
// so a card can say "Healthy" in green rather than repeat the operator's
// sentence, and so that "Failing over" is red wherever it appears.
//
// Two states are not phases at all and are worked out on top:
//
//   hibernated     the `cnpg.io/hibernation` annotation is `on`, and the
//                  condition of the same name says the pods are gone. The
//                  phase is left as it was before, usually "healthy", which
//                  is exactly the wrong thing to show for a cluster with no
//                  pods.
//   not all ready  a healthy phase with fewer ready instances than asked for
//                  is a cluster that has lost a replica and not yet noticed.

import { ANNOTATION, CONDITION, condition, type Cluster } from './cnpg.js';
import { quantity, type Tone } from './units.js';

export type State = 'healthy' | 'degraded' | 'working' | 'switchover' | 'failover' | 'failing' | 'hibernated' | 'hibernating' | 'waking' | 'unknown';

interface PhaseWords {
    words: string;
    tone: Tone;
    state: State;
}

/**
 * Every phase in CloudNativePG 1.30, in words. A phase not in this table --
 * a newer operator's -- is shown as the operator wrote it, in amber, which
 * is the honest thing to do with a word nobody here has read yet.
 */
export const PHASES: Record<string, PhaseWords> = {
    'Cluster in healthy state': { words: 'Healthy', tone: 'ok', state: 'healthy' },
    'Switchover in progress': { words: 'Switching primary', tone: 'warn', state: 'switchover' },
    'Failing over': { words: 'Failing over', tone: 'error', state: 'failover' },
    'Setting up primary': { words: 'Creating the primary', tone: 'info', state: 'working' },
    'Creating a new replica': { words: 'Adding a replica', tone: 'info', state: 'working' },
    'Upgrading cluster': { words: 'Upgrading', tone: 'info', state: 'working' },
    'Upgrading Postgres major version': { words: 'Major version upgrade', tone: 'info', state: 'working' },
    'Cluster upgrade delayed': { words: 'Upgrade delayed', tone: 'warn', state: 'working' },
    'Waiting for user action': { words: 'Waiting for you', tone: 'warn', state: 'working' },
    'Primary instance is being restarted in-place': { words: 'Restarting the primary', tone: 'info', state: 'working' },
    'Primary instance is being restarted without a switchover': { words: 'Restarting the primary', tone: 'info', state: 'working' },
    'Cluster cannot proceed to reconciliation due to an unknown plugin being required': { words: 'Unknown plugin', tone: 'error', state: 'failing' },
    'Cluster cannot proceed to reconciliation due to an error while interacting with plugins': { words: 'Plugin error', tone: 'error', state: 'failing' },
    'Cluster has incomplete or invalid image catalog': { words: 'Image catalog error', tone: 'error', state: 'failing' },
    'Cluster is unrecoverable and needs manual intervention': { words: 'Unrecoverable', tone: 'error', state: 'failing' },
    'Cluster cannot execute instance online upgrade due to missing architecture binary': { words: 'Missing binary', tone: 'error', state: 'failing' },
    'Waiting for the instances to become active': { words: 'Waiting for instances', tone: 'warn', state: 'working' },
    'Online upgrade in progress': { words: 'Online upgrade', tone: 'info', state: 'working' },
    'Applying configuration': { words: 'Applying configuration', tone: 'info', state: 'working' },
    'Promoting to primary cluster': { words: 'Promoting', tone: 'info', state: 'working' },
    'Unable to create required cluster objects': { words: 'Cannot create objects', tone: 'error', state: 'failing' },
    'Invalid cluster definition': { words: 'Invalid definition', tone: 'error', state: 'failing' },
};

export interface ClusterView {
    cluster: Cluster;
    name: string;
    namespace: string;
    description: string;
    /** The operator's phase, as written. */
    phase: string;
    phaseReason: string;
    /** The phase, or the hibernation, in a word or three. */
    words: string;
    tone: Tone;
    state: State;
    /** Instances asked for, and ready. */
    instances: number;
    ready: number;
    primary: string;
    targetPrimary: string;
    timeline: number | undefined;
    image: string;
    /** "16.4", "17", or '' when the image does not say. */
    version: string;
    /** Bytes asked for per instance; 0 when the spec does not say. */
    storage: number;
    walStorage: number;
    storageClass: string;
    /** `on` when the annotation says so -- whether or not the pods have gone yet. */
    hibernationRequested: boolean;
    /** Synchronous replication as the spec asks for it: how many, and how they are chosen. */
    sync: { number: number; method: string } | null;
    /** A replica cluster follows another cluster rather than accepting writes. */
    replicaCluster: boolean;
    /** The ContinuousArchiving condition, when the cluster archives WAL at all. */
    archiving: { ok: boolean; message: string } | null;
}

/** The major and minor version in an image tag: `postgresql:16.4-bookworm` is "16.4". */
export function versionOf(image: string): string {
    const tag = image.split('@')[0]?.split('/').pop()?.split(':')[1] ?? '';
    const match = /^(\d+(?:\.\d+)?)/.exec(tag);
    return match?.[1] ?? '';
}

/** The size a StorageConfiguration asks for: `size`, or the PVC template's request. */
function storageOf(config: { size?: string; pvcTemplate?: { resources?: { requests?: { storage?: string } } } } | undefined): number {
    return quantity(config?.size ?? config?.pvcTemplate?.resources?.requests?.storage);
}

export function clusterView(cluster: Cluster): ClusterView {
    const spec = cluster.spec ?? {};
    const status = cluster.status ?? {};
    const phase = status.phase ?? '';
    const known = PHASES[phase];
    const instances = spec.instances ?? status.instances ?? 0;
    const ready = status.readyInstances ?? 0;
    const image = status.image ?? spec.imageName ?? '';
    const catalogMajor = spec.imageCatalogRef?.major;

    let words = known?.words ?? (phase || 'Not reconciled yet');
    let tone: Tone = known?.tone ?? (phase ? 'warn' : '');
    let state: State = known?.state ?? 'unknown';

    const hibernationRequested = (cluster.metadata.annotations?.[ANNOTATION.hibernation] ?? '') === 'on';
    const hibernation = condition(status.conditions, CONDITION.hibernation);
    const hibernatedNow = hibernation?.status === 'True' && hibernation.reason === 'Hibernated';

    if (hibernationRequested) {
        state = hibernatedNow ? 'hibernated' : 'hibernating';
        words = hibernatedNow ? 'Hibernated' : 'Going to sleep';
        tone = 'info';
    } else if (hibernatedNow || (hibernation?.status === 'True' && ready < instances)) {
        // The annotation is gone or off, the condition has not caught up: the
        // operator is putting the pods back.
        state = 'waking';
        words = 'Waking up';
        tone = 'info';
    } else if (state === 'healthy' && ready < instances) {
        state = 'degraded';
        words = ready === 0 ? 'No instance ready' : `${ready} of ${instances} ready`;
        tone = ready === 0 ? 'error' : 'warn';
    }

    const synchronous = spec.postgresql?.synchronous;
    let sync: ClusterView['sync'] = null;
    if (synchronous && (synchronous.number ?? 0) > 0) {
        sync = { number: synchronous.number ?? 0, method: synchronous.method ?? 'any' };
    } else if ((spec.minSyncReplicas ?? 0) > 0 || (spec.maxSyncReplicas ?? 0) > 0) {
        // The older fields: a quorum of up to maxSyncReplicas.
        sync = { number: spec.maxSyncReplicas || spec.minSyncReplicas || 0, method: 'any' };
    }

    const archivingCondition = condition(status.conditions, CONDITION.archiving);
    const archiving = archivingCondition
        ? { ok: archivingCondition.status === 'True', message: archivingCondition.message ?? archivingCondition.reason ?? '' }
        : null;

    return {
        cluster,
        name: cluster.metadata.name,
        namespace: cluster.metadata.namespace ?? '',
        description: spec.description ?? '',
        phase,
        phaseReason: status.phaseReason ?? '',
        words,
        tone,
        state,
        instances,
        ready,
        primary: status.currentPrimary ?? '',
        targetPrimary: status.targetPrimary ?? '',
        timeline: status.timelineID,
        image,
        version: versionOf(image) || (catalogMajor ? String(catalogMajor) : '') || (status.pgDataImageInfo?.majorVersion ? String(status.pgDataImageInfo.majorVersion) : ''),
        storage: storageOf(spec.storage),
        walStorage: storageOf(spec.walStorage),
        storageClass: spec.storage?.storageClass ?? spec.storage?.pvcTemplate?.storageClassName ?? '',
        hibernationRequested,
        sync,
        replicaCluster: spec.replica?.enabled === true,
        archiving,
    };
}

/** Whether the primary is moving: a switchover or a failover under way. */
export function isMoving(view: ClusterView): boolean {
    return view.state === 'switchover' || view.state === 'failover' || (view.targetPrimary !== '' && view.primary !== '' && view.targetPrimary !== view.primary);
}

/** One sentence on the cluster, for under its name. */
export function sentence(view: ClusterView): string {
    const instances = view.instances === 1 ? 'its one instance' : `${view.instances} instances`;
    switch (view.state) {
        case 'hibernated':
            return `Hibernated: no pods run, and the volumes of ${instances} are kept until it is woken up.`;
        case 'hibernating':
            return 'Hibernation was asked for: the operator is stopping the pods and keeping the volumes.';
        case 'waking':
            return 'Waking up: the operator is starting the pods again on the volumes it kept.';
        case 'switchover':
            return `The primary is moving from ${view.primary || 'the old primary'} to ${view.targetPrimary || 'a new one'}. Writes pause for a moment.`;
        case 'failover': {
            // The operator writes "pending" as the target while it is still
            // choosing which replica to promote.
            const next = !view.targetPrimary || view.targetPrimary === 'pending' ? 'the most advanced replica' : view.targetPrimary;
            return `The primary${view.primary ? ` ${view.primary}` : ''} failed; ${next} is being promoted in its place.`;
        }
        case 'failing':
            return view.phaseReason || view.phase;
        case 'degraded':
            return `${view.ready} of ${instances} ready${view.primary ? `; ${view.primary} is the primary` : ''}.`;
        case 'healthy':
            if (view.instances === 1) return `One instance, ${view.primary || 'the primary'}, and nothing standing by if it goes.`;
            return `All ${view.instances} instances ready; ${view.primary || 'the primary'} takes the writes.`;
        default:
            return view.phaseReason || (view.phase ? view.phase : 'The operator has not reported on this cluster yet.');
    }
}
