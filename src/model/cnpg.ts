// The CloudNativePG objects this plugin reads, as far as it reads them.
//
// Every field here is a JSON tag from CloudNativePG's own API types
// (api/v1/*_types.go in cloudnative-pg/cloudnative-pg, checked against
// v1.30.1), and every label and annotation is one of the constants in
// pkg/utils/labels_annotations.go. Everything is optional, because the
// operator fills status in over time and older operators leave newer fields
// out -- a Pooler's `status.phase` only exists from 1.30 on -- so the model
// reads each one as "maybe there" and says so rather than guessing.

/** The app's names for the kinds the plugin reads. */
export const CLUSTERS = 'crd:clusters.postgresql.cnpg.io';
export const BACKUPS = 'crd:backups.postgresql.cnpg.io';
export const SCHEDULED_BACKUPS = 'crd:scheduledbackups.postgresql.cnpg.io';
export const POOLERS = 'crd:poolers.postgresql.cnpg.io';
export const DATABASES = 'crd:databases.postgresql.cnpg.io';
export const PUBLICATIONS = 'crd:publications.postgresql.cnpg.io';
export const SUBSCRIPTIONS = 'crd:subscriptions.postgresql.cnpg.io';
export const IMAGE_CATALOGS = 'crd:imagecatalogs.postgresql.cnpg.io';
export const CLUSTER_IMAGE_CATALOGS = 'crd:clusterimagecatalogs.postgresql.cnpg.io';
export const PODS = 'pods';
export const PVCS = 'persistentvolumeclaims';
export const SERVICES = 'services';
export const NODES = 'nodes';

/** Labels the operator stamps on the pods, PVCs and backups it makes. */
export const LABEL = {
    cluster: 'cnpg.io/cluster',
    /** `primary` or `replica` on an instance pod; the current label. */
    instanceRole: 'cnpg.io/instanceRole',
    /** The same, under the name older operators used. Still set, deprecated. */
    legacyRole: 'role',
    /** `instance` or `pooler`. */
    podRole: 'cnpg.io/podRole',
    instanceName: 'cnpg.io/instanceName',
    /** `PG_DATA`, `PG_WAL` or `PG_TABLESPACE` on a PVC. */
    pvcRole: 'cnpg.io/pvcRole',
    poolerName: 'cnpg.io/poolerName',
    /** Set on a pod that is a job: `initdb`, `join`, `snapshot-recovery` ... */
    jobRole: 'cnpg.io/jobRole',
    /** The ScheduledBackup a Backup was made by. */
    scheduledBackup: 'cnpg.io/scheduled-backup',
} as const;

export const ANNOTATION = {
    /** `on` hibernates the cluster, `off` (or absent) wakes it. */
    hibernation: 'cnpg.io/hibernation',
    /** A new timestamp here is what `kubectl cnpg restart` writes: a rolling restart. */
    restartedAt: 'kubectl.kubernetes.io/restartedAt',
    /** A JSON list of fenced instance names, or `["*"]`. */
    fencedInstances: 'cnpg.io/fencedInstances',
} as const;

/** The condition types on a Cluster. */
export const CONDITION = {
    ready: 'Ready',
    archiving: 'ContinuousArchiving',
    lastBackup: 'LastBackupSucceeded',
    hibernation: 'cnpg.io/hibernation',
} as const;

export interface Condition {
    type: string;
    status?: string;
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
}

export interface NamedRef {
    name?: string;
}

export interface StorageConfiguration {
    size?: string;
    storageClass?: string;
    pvcTemplate?: { resources?: { requests?: { storage?: string } }; storageClassName?: string };
}

export interface BarmanObjectStore {
    destinationPath?: string;
    endpointURL?: string;
    serverName?: string;
}

export interface Cluster extends K8sDockside.KubeObject {
    spec?: {
        description?: string;
        instances?: number;
        imageName?: string;
        imageCatalogRef?: { kind?: string; name?: string; major?: number };
        minSyncReplicas?: number;
        maxSyncReplicas?: number;
        postgresql?: {
            synchronous?: { method?: string; number?: number; dataDurability?: string };
        };
        storage?: StorageConfiguration;
        walStorage?: StorageConfiguration;
        replica?: { enabled?: boolean; primary?: string; source?: string };
        backup?: {
            barmanObjectStore?: BarmanObjectStore;
            volumeSnapshot?: { className?: string };
            retentionPolicy?: string;
            target?: string;
        };
        plugins?: { name?: string; enabled?: boolean; isWALArchiver?: boolean }[];
    };
    status?: {
        phase?: string;
        phaseReason?: string;
        instances?: number;
        readyInstances?: number;
        instanceNames?: string[];
        instancesStatus?: Record<string, string[]>;
        instancesReportedState?: Record<string, { isPrimary?: boolean; timeLineID?: number; ip?: string }>;
        currentPrimary?: string;
        currentPrimaryTimestamp?: string;
        currentPrimaryFailingSinceTimestamp?: string;
        targetPrimary?: string;
        targetPrimaryTimestamp?: string;
        timelineID?: number;
        topology?: {
            instances?: Record<string, Record<string, string>>;
            nodesUsed?: number;
            successfullyExtracted?: boolean;
        };
        image?: string;
        pgDataImageInfo?: { image?: string; majorVersion?: number };
        firstRecoverabilityPoint?: string;
        firstRecoverabilityPointByMethod?: Record<string, string>;
        lastSuccessfulBackup?: string;
        lastSuccessfulBackupByMethod?: Record<string, string>;
        lastFailedBackup?: string;
        conditions?: Condition[];
        danglingPVC?: string[];
        resizingPVC?: string[];
        initializingPVC?: string[];
        healthyPVC?: string[];
        unusablePVC?: string[];
        writeService?: string;
        readService?: string;
    };
}

export interface Backup extends K8sDockside.KubeObject {
    spec?: {
        cluster?: NamedRef;
        method?: string;
        target?: string;
        online?: boolean;
        pluginConfiguration?: { name?: string };
    };
    status?: {
        phase?: string;
        method?: string;
        startedAt?: string;
        stoppedAt?: string;
        error?: string;
        commandError?: string;
        backupId?: string;
        backupName?: string;
        destinationPath?: string;
        majorVersion?: number;
        online?: boolean;
        instanceID?: { podName?: string; ContainerID?: string };
        beginWal?: string;
        endWal?: string;
    };
}

export interface ScheduledBackup extends K8sDockside.KubeObject {
    spec?: {
        cluster?: NamedRef;
        schedule?: string;
        suspend?: boolean;
        immediate?: boolean;
        method?: string;
        pluginConfiguration?: { name?: string };
    };
    status?: {
        lastCheckTime?: string;
        lastScheduleTime?: string;
        nextScheduleTime?: string;
        error?: string;
    };
}

export interface Pooler extends K8sDockside.KubeObject {
    spec?: {
        cluster?: NamedRef;
        type?: string;
        instances?: number;
        pgbouncer?: { poolMode?: string; paused?: boolean };
    };
    status?: {
        instances?: number;
        phase?: string;
        phaseReason?: string;
        error?: string;
    };
}

export interface Pod extends K8sDockside.KubeObject {
    spec?: { nodeName?: string; containers?: { name: string; image?: string }[] };
    status?: {
        phase?: string;
        podIP?: string;
        startTime?: string;
        conditions?: { type: string; status: string }[];
        containerStatuses?: {
            name: string;
            ready?: boolean;
            restartCount?: number;
            state?: { waiting?: { reason?: string; message?: string }; terminated?: { reason?: string } };
        }[];
    };
}

export interface PersistentVolumeClaim extends K8sDockside.KubeObject {
    spec?: { storageClassName?: string; resources?: { requests?: { storage?: string } } };
    status?: { phase?: string; capacity?: { storage?: string } };
}

export interface Service extends K8sDockside.KubeObject {
    spec?: { type?: string; clusterIP?: string; ports?: { name?: string; port?: number }[]; selector?: Record<string, string> };
}

export interface Node extends K8sDockside.KubeObject {
    metadata: K8sDockside.ObjectMeta & { labels?: Record<string, string> };
}

/** The condition of a type, or undefined when the object does not have it. */
export function condition(conditions: Condition[] | undefined, type: string): Condition | undefined {
    return (conditions ?? []).find((c) => c.type === type);
}

/** An object's `namespace/name`, the key the model files things under. */
export function key(namespace: string | undefined, name: string | undefined): string {
    return `${namespace ?? ''}/${name ?? ''}`;
}
