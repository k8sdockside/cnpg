// A namespace's worth of CloudNativePG objects, shaped the way the operator
// really writes them.
//
// Used by the page render test and by scripts/preview.mjs, so that what the
// test asserts on and what the preview draws are the same clusters and
// cannot drift apart. The first four mirror dev/samples, so the preview looks
// like the kind cluster dev/up.sh makes; the last two are the states a kind
// cluster will not produce on its own:
//
//   shop       healthy: three instances, one synchronous standby, poolers in
//              front for rw and ro, a backup every ten minutes
//   analytics  one instance and no backups at all
//   orders     backups failing on bad object-store credentials, and WAL
//              archiving failing with them
//   archive    hibernated: no pods, PVCs kept
//   ledger     a standby 95 seconds behind (from Prometheus), daily volume
//              snapshots with the last one three days old
//   billing    failing over: the primary is crash-looping, a standby is
//              being promoted, and its pooler has nothing to send to
//
// Timestamps are relative to when the module is loaded, so ages read the
// same whenever the preview is drawn.
//
// It lives in src/ rather than src/pages/ because scripts/build.mjs turns
// every non-test .ts under src/pages into a page of its own.

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();

const NS = 'cnpg-demo';
const IMAGE = 'ghcr.io/cloudnative-pg/postgresql:18.6-system-trixie';

function cond(type: string, status: string, reason = '', message = '') {
    return { type, status, reason, message, lastTransitionTime: ago(2 * HOUR) };
}

// ----- clusters --------------------------------------------------------------

export const shop = {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'Cluster',
    metadata: { name: 'shop', namespace: NS, creationTimestamp: ago(9 * DAY) },
    spec: {
        description: "The shop's orders and customers",
        instances: 3,
        postgresql: { synchronous: { method: 'any', number: 1 } },
        storage: { size: '1Gi' },
        walStorage: { size: '512Mi' },
        backup: { retentionPolicy: '7d', barmanObjectStore: { destinationPath: 's3://shop-backups/', endpointURL: 'http://backup-store.cnpg-demo.svc:9000' } },
    },
    status: {
        phase: 'Cluster in healthy state',
        instances: 3,
        readyInstances: 3,
        instanceNames: ['shop-1', 'shop-2', 'shop-3'],
        instancesStatus: { healthy: ['shop-1', 'shop-2', 'shop-3'] },
        instancesReportedState: {
            'shop-1': { isPrimary: true, timeLineID: 1, ip: '10.244.0.11' },
            'shop-2': { isPrimary: false, timeLineID: 1, ip: '10.244.1.12' },
            'shop-3': { isPrimary: false, timeLineID: 1, ip: '10.244.2.13' },
        },
        currentPrimary: 'shop-1',
        targetPrimary: 'shop-1',
        timelineID: 1,
        image: IMAGE,
        firstRecoverabilityPoint: ago(6 * DAY + 4 * HOUR),
        lastSuccessfulBackup: ago(7 * MIN),
        conditions: [cond('Ready', 'True', 'ClusterIsReady', 'Cluster is Ready'), cond('ContinuousArchiving', 'True', 'ContinuousArchivingSuccess', 'Continuous archiving is working'), cond('LastBackupSucceeded', 'True', 'LastBackupSucceeded')],
        healthyPVC: ['shop-1', 'shop-1-wal', 'shop-2', 'shop-2-wal', 'shop-3', 'shop-3-wal'],
    },
};

export const analytics = {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'Cluster',
    metadata: { name: 'analytics', namespace: NS, creationTimestamp: ago(9 * DAY) },
    spec: { instances: 1, storage: { size: '1Gi' } },
    status: {
        phase: 'Cluster in healthy state',
        instances: 1,
        readyInstances: 1,
        instanceNames: ['analytics-1'],
        instancesStatus: { healthy: ['analytics-1'] },
        instancesReportedState: { 'analytics-1': { isPrimary: true, timeLineID: 1 } },
        currentPrimary: 'analytics-1',
        targetPrimary: 'analytics-1',
        timelineID: 1,
        image: IMAGE,
        conditions: [cond('Ready', 'True', 'ClusterIsReady', 'Cluster is Ready')],
    },
};

export const orders = {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'Cluster',
    metadata: { name: 'orders', namespace: NS, creationTimestamp: ago(9 * DAY) },
    spec: {
        instances: 2,
        storage: { size: '1Gi' },
        backup: { barmanObjectStore: { destinationPath: 's3://orders-backups/', endpointURL: 'http://backup-store.cnpg-demo.svc:9000' } },
    },
    status: {
        phase: 'Cluster in healthy state',
        instances: 2,
        readyInstances: 2,
        instanceNames: ['orders-1', 'orders-2'],
        instancesStatus: { healthy: ['orders-1', 'orders-2'] },
        instancesReportedState: { 'orders-1': { isPrimary: true, timeLineID: 1 }, 'orders-2': { isPrimary: false, timeLineID: 1 } },
        currentPrimary: 'orders-1',
        targetPrimary: 'orders-1',
        timelineID: 1,
        image: IMAGE,
        lastFailedBackup: ago(40 * MIN),
        conditions: [
            cond('Ready', 'True', 'ClusterIsReady', 'Cluster is Ready'),
            cond('ContinuousArchiving', 'False', 'ContinuousArchivingFailing', 'unexpected failure invoking barman-cloud-wal-archive: exit status 4'),
            cond('LastBackupSucceeded', 'False', 'LastBackupFailed', 'encountered an error while taking the backup: exit status 4'),
        ],
    },
};

export const archive = {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'Cluster',
    metadata: { name: 'archive', namespace: NS, creationTimestamp: ago(9 * DAY), annotations: { 'cnpg.io/hibernation': 'on' } },
    spec: { instances: 1, storage: { size: '1Gi' } },
    status: {
        phase: 'Cluster in healthy state',
        instances: 1,
        readyInstances: 0,
        instanceNames: [],
        currentPrimary: 'archive-1',
        targetPrimary: 'archive-1',
        timelineID: 1,
        image: IMAGE,
        conditions: [cond('Ready', 'False', 'ClusterIsNotReady', 'Cluster Is Not Ready'), cond('cnpg.io/hibernation', 'True', 'Hibernated', 'Cluster has been hibernated')],
    },
};

export const ledger = {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'Cluster',
    metadata: { name: 'ledger', namespace: 'finance', creationTimestamp: ago(40 * DAY) },
    spec: {
        instances: 3,
        imageName: 'ghcr.io/cloudnative-pg/postgresql:17.6-system-trixie',
        storage: { size: '50Gi', storageClass: 'fast-ssd' },
        backup: { volumeSnapshot: { className: 'csi-snapclass' } },
    },
    status: {
        phase: 'Cluster in healthy state',
        instances: 3,
        readyInstances: 3,
        instanceNames: ['ledger-1', 'ledger-2', 'ledger-3'],
        instancesStatus: { healthy: ['ledger-1', 'ledger-2', 'ledger-3'] },
        instancesReportedState: {
            'ledger-1': { isPrimary: false, timeLineID: 2 },
            'ledger-2': { isPrimary: true, timeLineID: 2 },
            'ledger-3': { isPrimary: false, timeLineID: 2 },
        },
        currentPrimary: 'ledger-2',
        targetPrimary: 'ledger-2',
        timelineID: 2,
        image: 'ghcr.io/cloudnative-pg/postgresql:17.6-system-trixie',
        firstRecoverabilityPoint: ago(30 * DAY),
        lastSuccessfulBackup: ago(3 * DAY + 2 * HOUR),
        conditions: [cond('Ready', 'True', 'ClusterIsReady', 'Cluster is Ready')],
    },
};

export const billing = {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'Cluster',
    metadata: { name: 'billing', namespace: 'finance', creationTimestamp: ago(40 * DAY) },
    spec: {
        instances: 2,
        storage: { size: '20Gi' },
        plugins: [{ name: 'barman-cloud.cloudnative-pg.io', isWALArchiver: true }],
    },
    status: {
        phase: 'Failing over',
        phaseReason: 'Failing over from billing-1 to billing-2',
        instances: 2,
        readyInstances: 1,
        instanceNames: ['billing-1', 'billing-2'],
        instancesStatus: { failed: ['billing-1'], healthy: ['billing-2'] },
        instancesReportedState: { 'billing-1': { isPrimary: true, timeLineID: 4 }, 'billing-2': { isPrimary: false, timeLineID: 4 } },
        currentPrimary: 'billing-1',
        targetPrimary: 'billing-2',
        currentPrimaryFailingSinceTimestamp: ago(3 * MIN),
        timelineID: 4,
        image: IMAGE,
        conditions: [cond('Ready', 'False', 'ClusterIsNotReady', 'Cluster Is Not Ready')],
    },
};

export const clusters = [shop, analytics, orders, archive, ledger, billing];

// ----- backups ---------------------------------------------------------------

function backup(name: string, cluster: string, namespace: string, phase: string, stoppedAgo: number, extra: Record<string, unknown> = {}, schedule = '') {
    const method = (extra.method as string) ?? 'barmanObjectStore';
    return {
        apiVersion: 'postgresql.cnpg.io/v1',
        kind: 'Backup',
        metadata: {
            name,
            namespace,
            creationTimestamp: ago(stoppedAgo + 3 * MIN),
            labels: schedule ? { 'cnpg.io/scheduled-backup': schedule, 'cnpg.io/cluster': cluster } : { 'cnpg.io/cluster': cluster },
        },
        spec: { cluster: { name: cluster }, method, ...(extra.plugin ? { pluginConfiguration: { name: extra.plugin } } : {}) },
        status: {
            phase,
            method,
            startedAt: ago(stoppedAgo + 2 * MIN),
            ...(phase === 'running' ? {} : { stoppedAt: ago(stoppedAgo) }),
            ...(phase === 'completed' ? { backupId: `20260925T${String(Math.round(stoppedAgo / MIN)).padStart(6, '0')}`, instanceID: { podName: `${cluster}-2` } } : {}),
            ...(extra.error ? { error: extra.error } : {}),
        },
    };
}

export const backups = [
    // shop: every ten minutes for the last hours, plus the first one six days ago.
    ...Array.from({ length: 10 }, (_, i) => backup(`shop-every-10m-${20260925120000 - i}`, 'shop', NS, 'completed', 7 * MIN + i * 30 * MIN, {}, 'shop-every-10m')),
    backup('shop-first', 'shop', NS, 'completed', 6 * DAY + 4 * HOUR),
    backup('shop-manual-x7k2p', 'shop', NS, 'running', 0),
    // orders: failing on the credentials, over and over.
    backup('orders-before-migration', 'orders', NS, 'failed', 40 * MIN, {
        error: "encountered an error while taking the backup: exit status 4 -- barman-cloud-backup: ERROR: Barman cloud backup exception: An error occurred (InvalidAccessKeyId) when calling the CreateMultipartUpload operation: The Access Key Id you provided does not exist in our records.",
    }),
    backup('orders-retry', 'orders', NS, 'failed', 12 * MIN, {
        error: 'encountered an error while taking the backup: exit status 4 -- An error occurred (InvalidAccessKeyId) when calling the CreateMultipartUpload operation',
    }),
    // ledger: daily snapshots, the last three days ago.
    ...[3, 4, 5, 6, 7].map((d) => backup(`ledger-daily-${d}`, 'ledger', 'finance', 'completed', d * DAY + 2 * HOUR, { method: 'volumeSnapshot' }, 'ledger-daily')),
    // billing: through the Barman Cloud plugin, one running when it failed over.
    backup('billing-nightly-1', 'billing', 'finance', 'completed', 20 * HOUR, { method: 'plugin', plugin: 'barman-cloud.cloudnative-pg.io' }, 'billing-nightly'),
    backup('billing-nightly-2', 'billing', 'finance', 'completed', 44 * HOUR, { method: 'plugin', plugin: 'barman-cloud.cloudnative-pg.io' }, 'billing-nightly'),
];

export const scheduledBackups = [
    {
        apiVersion: 'postgresql.cnpg.io/v1',
        kind: 'ScheduledBackup',
        metadata: { name: 'shop-every-10m', namespace: NS },
        spec: { schedule: '0 */10 * * * *', immediate: true, cluster: { name: 'shop' } },
        status: { lastScheduleTime: ago(10 * MIN), nextScheduleTime: ahead(3 * MIN), lastCheckTime: ago(10 * MIN) },
    },
    {
        apiVersion: 'postgresql.cnpg.io/v1',
        kind: 'ScheduledBackup',
        metadata: { name: 'ledger-daily', namespace: 'finance' },
        spec: { schedule: '0 0 2 * * *', method: 'volumeSnapshot', cluster: { name: 'ledger' } },
        status: { lastScheduleTime: ago(3 * DAY + 2 * HOUR) },
    },
    {
        apiVersion: 'postgresql.cnpg.io/v1',
        kind: 'ScheduledBackup',
        metadata: { name: 'billing-nightly', namespace: 'finance' },
        spec: { schedule: '0 30 1 * * *', method: 'plugin', pluginConfiguration: { name: 'barman-cloud.cloudnative-pg.io' }, cluster: { name: 'billing' } },
        status: { lastScheduleTime: ago(20 * HOUR) },
    },
];

// ----- poolers, pods, volumes, services, nodes --------------------------------

export const poolers = [
    {
        apiVersion: 'postgresql.cnpg.io/v1',
        kind: 'Pooler',
        metadata: { name: 'shop-pooler-rw', namespace: NS },
        spec: { cluster: { name: 'shop' }, type: 'rw', instances: 2, pgbouncer: { poolMode: 'transaction' } },
        status: { instances: 2, phase: 'active' },
    },
    {
        apiVersion: 'postgresql.cnpg.io/v1',
        kind: 'Pooler',
        metadata: { name: 'shop-pooler-ro', namespace: NS },
        spec: { cluster: { name: 'shop' }, type: 'ro', instances: 1, pgbouncer: { poolMode: 'session' } },
        status: { instances: 1, phase: 'active' },
    },
    {
        apiVersion: 'postgresql.cnpg.io/v1',
        kind: 'Pooler',
        metadata: { name: 'billing-pooler-rw', namespace: 'finance' },
        spec: { cluster: { name: 'billing' }, type: 'rw', instances: 2, pgbouncer: { poolMode: 'transaction' } },
        status: { instances: 2 },
    },
];

function instancePod(name: string, cluster: string, namespace: string, role: 'primary' | 'replica', node: string, ok = true) {
    return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
            name,
            namespace,
            labels: { 'cnpg.io/cluster': cluster, 'cnpg.io/instanceName': name, 'cnpg.io/instanceRole': role, role, 'cnpg.io/podRole': 'instance' },
        },
        spec: { nodeName: node },
        status: ok
            ? { phase: 'Running', startTime: ago(2 * DAY), conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'postgres', ready: true, restartCount: 0 }] }
            : {
                  phase: 'Running',
                  startTime: ago(2 * DAY),
                  conditions: [{ type: 'Ready', status: 'False' }],
                  containerStatuses: [{ name: 'postgres', ready: false, restartCount: 6, state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 2m40s restarting failed container' } } }],
              },
    };
}

function poolerPod(name: string, pooler: string, cluster: string, namespace: string, node: string, ok = true) {
    return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name, namespace, labels: { 'cnpg.io/poolerName': pooler, 'cnpg.io/podRole': 'pooler', 'cnpg.io/cluster': cluster } },
        spec: { nodeName: node },
        status: ok
            ? { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'pgbouncer', ready: true, restartCount: 0 }] }
            : { phase: 'Running', conditions: [{ type: 'Ready', status: 'False' }], containerStatuses: [{ name: 'pgbouncer', ready: false, restartCount: 0 }] },
    };
}

export const pods = [
    instancePod('shop-1', 'shop', NS, 'primary', 'kind-worker'),
    instancePod('shop-2', 'shop', NS, 'replica', 'kind-worker2'),
    instancePod('shop-3', 'shop', NS, 'replica', 'kind-worker3'),
    instancePod('analytics-1', 'analytics', NS, 'primary', 'kind-worker2'),
    instancePod('orders-1', 'orders', NS, 'primary', 'kind-worker3'),
    instancePod('orders-2', 'orders', NS, 'replica', 'kind-worker'),
    instancePod('ledger-1', 'ledger', 'finance', 'replica', 'kind-worker'),
    instancePod('ledger-2', 'ledger', 'finance', 'primary', 'kind-worker2'),
    instancePod('ledger-3', 'ledger', 'finance', 'replica', 'kind-worker3'),
    instancePod('billing-1', 'billing', 'finance', 'primary', 'kind-worker', false),
    instancePod('billing-2', 'billing', 'finance', 'replica', 'kind-worker2'),
    poolerPod('shop-pooler-rw-7d9f8-abcde', 'shop-pooler-rw', 'shop', NS, 'kind-worker'),
    poolerPod('shop-pooler-rw-7d9f8-fghij', 'shop-pooler-rw', 'shop', NS, 'kind-worker2'),
    poolerPod('shop-pooler-ro-5c6b7-klmno', 'shop-pooler-ro', 'shop', NS, 'kind-worker3'),
    poolerPod('billing-pooler-rw-6f5d4-pqrst', 'billing-pooler-rw', 'billing', 'finance', 'kind-worker', false),
    poolerPod('billing-pooler-rw-6f5d4-uvwxy', 'billing-pooler-rw', 'billing', 'finance', 'kind-worker2', false),
    // A job pod, which is not an instance and must not be drawn as one.
    {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'shop-1-initdb-abcde', namespace: NS, labels: { 'cnpg.io/cluster': 'shop', 'cnpg.io/jobRole': 'initdb', 'cnpg.io/instanceName': 'shop-1' } },
        spec: { nodeName: 'kind-worker' },
        status: { phase: 'Succeeded' },
    },
];

function pvc(name: string, cluster: string, namespace: string, instance: string, role: string, storage: string) {
    return {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name, namespace, labels: { 'cnpg.io/cluster': cluster, 'cnpg.io/instanceName': instance, 'cnpg.io/pvcRole': role } },
        spec: { storageClassName: 'standard', resources: { requests: { storage } } },
        status: { phase: 'Bound', capacity: { storage } },
    };
}

export const pvcs = [
    ...['shop-1', 'shop-2', 'shop-3'].flatMap((i) => [pvc(i, 'shop', NS, i, 'PG_DATA', '1Gi'), pvc(`${i}-wal`, 'shop', NS, i, 'PG_WAL', '512Mi')]),
    pvc('analytics-1', 'analytics', NS, 'analytics-1', 'PG_DATA', '1Gi'),
    pvc('orders-1', 'orders', NS, 'orders-1', 'PG_DATA', '1Gi'),
    pvc('orders-2', 'orders', NS, 'orders-2', 'PG_DATA', '1Gi'),
    pvc('archive-1', 'archive', NS, 'archive-1', 'PG_DATA', '1Gi'),
    ...['ledger-1', 'ledger-2', 'ledger-3'].map((i) => pvc(i, 'ledger', 'finance', i, 'PG_DATA', '50Gi')),
    ...['billing-1', 'billing-2'].map((i) => pvc(i, 'billing', 'finance', i, 'PG_DATA', '20Gi')),
];

function service(name: string, namespace: string) {
    return { apiVersion: 'v1', kind: 'Service', metadata: { name, namespace }, spec: { type: 'ClusterIP', ports: [{ name: 'postgres', port: 5432 }] } };
}

export const services = [
    ...['shop', 'analytics', 'orders', 'archive'].flatMap((c) => ['-rw', '-ro', '-r'].map((s) => service(`${c}${s}`, NS))),
    ...['ledger', 'billing'].flatMap((c) => ['-rw', '-ro', '-r'].map((s) => service(`${c}${s}`, 'finance'))),
    { apiVersion: 'v1', kind: 'Service', metadata: { name: 'shop-pooler-rw', namespace: NS }, spec: { ports: [{ name: 'pgbouncer', port: 5432 }] } },
];

export const nodes = [
    { apiVersion: 'v1', kind: 'Node', metadata: { name: 'kind-worker', labels: { 'topology.kubernetes.io/zone': 'zone-a' } } },
    { apiVersion: 'v1', kind: 'Node', metadata: { name: 'kind-worker2', labels: { 'topology.kubernetes.io/zone': 'zone-b' } } },
    { apiVersion: 'v1', kind: 'Node', metadata: { name: 'kind-worker3', labels: { 'topology.kubernetes.io/zone': 'zone-c' } } },
];

// ----- Prometheus ---------------------------------------------------------------

function series(name: string, values: (i: number) => number, points = 30) {
    return { name, points: Array.from({ length: points }, (_, i) => ({ t: Math.round((NOW - (points - 1 - i) * 2 * MIN) / 1000), v: values(i) })) };
}

function chart(id: string, label: string, unit: string, description: string, list: ReturnType<typeof series>[]) {
    return { pluginId: 'cnpg', pluginName: 'CloudNativePG', id, label, unit, description, series: list, error: '' };
}

export const charts = {
    attached: true,
    range: 60,
    source: {
        available: true,
        error: '',
        describe: 'monitoring/prometheus-operated:9090',
        configured: '',
        endpoint: { namespace: 'monitoring', service: 'prometheus-operated', port: '9090', path: '', url: '', source: 'label' },
    },
    charts: [
        chart('replication-lag', 'Replication lag', 'seconds', 'How far each standby is behind its primary.', [
            series('namespace=cnpg-demo, pod=shop-2', () => 0),
            series('namespace=cnpg-demo, pod=shop-3', (i) => (i % 7 === 0 ? 1 : 0)),
            series('namespace=finance, pod=ledger-1', () => 0),
            series('namespace=finance, pod=ledger-3', (i) => Math.min(95, i * 4)),
        ]),
        chart('instances-up', 'Instances up', 'count', 'Postgres instances answering the exporter.', [
            series('cluster=shop, namespace=cnpg-demo', () => 3),
            series('cluster=ledger, namespace=finance', () => 3),
            series('cluster=billing, namespace=finance', (i) => (i > 26 ? 1 : 2)),
        ]),
        chart('connections', 'Connections', 'count', 'Backends per instance.', [
            series('namespace=cnpg-demo, pod=shop-1', (i) => 40 + Math.round(12 * Math.sin(i / 3))),
            series('namespace=finance, pod=ledger-2', (i) => 18 + (i % 5)),
        ]),
        chart('transactions', 'Commits', 'ops/s', 'Committed transactions per second.', [
            series('namespace=cnpg-demo, pod=shop-1', (i) => 120 + 30 * Math.sin(i / 4)),
            series('namespace=finance, pod=ledger-2', (i) => 12 + (i % 3)),
        ]),
        chart('database-size', 'Database size', 'bytes', 'All databases on each primary.', [
            series('namespace=cnpg-demo, pod=shop-1', (i) => 310e6 + i * 1.5e6),
            series('namespace=finance, pod=ledger-2', (i) => 21e9 + i * 20e6),
        ]),
        chart('archive-failures', 'WAL archive failures', 'count', 'Failed WAL archive attempts in the last 15 minutes.', [series('namespace=cnpg-demo, pod=orders-1', (i) => 3 + (i % 4))]),
    ],
};
