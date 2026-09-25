// The panel on a PersistentVolumeClaim: whose data this is.
//
// CloudNativePG names a claim after the instance it belongs to and labels it
// with its role -- the data directory, the WAL, a tablespace. Deleting the
// wrong one is how a standby gets rebuilt from scratch, or worse, so the
// panel says whose it is and whether that instance is the primary right now.
// Reading the claim's own labels and the Cluster's status is all it costs.

import { CLUSTERS, LABEL, PODS, type Cluster, type PersistentVolumeClaim } from '../model/cnpg.js';
import { clusterView } from '../model/health.js';
import { quantity, size } from '../model/units.js';
import { byId, el, replace } from '../ui/dom.js';
import { openOn, start } from '../ui/page.js';
import { facts, nothing, openName, pill } from '../ui/parts.js';

const ROLES: Record<string, string> = {
    PG_DATA: 'the data directory',
    PG_WAL: 'the write-ahead log',
    PG_TABLESPACE: 'a tablespace',
};

start('panel', async () => {
    const host = byId('panel');
    const claim = await k8sdockside.object<PersistentVolumeClaim>();
    const labels = claim.metadata.labels ?? {};
    const clusterName = labels[LABEL.cluster];
    const namespace = claim.metadata.namespace ?? '';
    if (!clusterName) {
        replace(host, nothing('This claim does not belong to a CloudNativePG cluster.'));
        return;
    }
    const role = labels[LABEL.pvcRole] ?? '';
    const instance = labels[LABEL.instanceName] ?? '';

    let cluster: Cluster | undefined;
    try {
        cluster = await k8sdockside.get<Cluster>({ kind: CLUSTERS, namespace, name: clusterName });
    } catch {
        cluster = undefined;
    }
    const view = cluster ? clusterView(cluster) : undefined;
    const status = cluster?.status ?? {};
    const name = claim.metadata.name;
    const state = status.danglingPVC?.includes(name)
        ? ['dangling: no pod is using it', 'warn']
        : status.resizingPVC?.includes(name)
          ? ['being resized', 'info']
          : status.initializingPVC?.includes(name)
            ? ['being initialised', 'info']
            : status.unusablePVC?.includes(name)
              ? ['unusable: a claim it needs is missing', 'error']
              : status.healthyPVC?.includes(name)
                ? ['healthy', 'ok']
                : [view?.state === 'hibernated' ? 'kept while the cluster hibernates' : 'not listed by the cluster yet', view?.state === 'hibernated' ? 'info' : ''];

    const isPrimary = instance !== '' && view?.primary === instance;
    const head = el(
        'div',
        { class: 'panel-head' },
        pill(role === 'PG_WAL' ? 'WAL' : role === 'PG_TABLESPACE' ? 'Tablespace' : 'Data', 'info'),
        el('span', {}, `holds ${ROLES[role] ?? 'Postgres data'} of`),
        instance ? openName(instance, { kind: PODS, namespace, name: instance }) : el('span', {}, 'an instance'),
        isPrimary ? pill('primary', 'info') : instance ? pill('standby') : null,
    );
    const pairs: [string, Node | string][] = [
        ['Cluster', openName(clusterName, { kind: CLUSTERS, namespace, name: clusterName })],
        ['Size', size(quantity(claim.status?.capacity?.storage ?? claim.spec?.resources?.requests?.storage)) || '—'],
        ['State', el('span', { class: `tone-${state[1] || 'none'}` }, state[0] ?? '')],
    ];
    const topology = el('button', { type: 'button' }, 'Open the topology');
    topology.addEventListener('click', () => void openOn('topology', namespace, clusterName));
    replace(host, head, facts(pairs), el('div', { class: 'links', style: 'margin-top:8px' }, topology));
});
