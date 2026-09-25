// The panel on a Pod: what this pod is to CloudNativePG.
//
// A Postgres instance pod looks like any other pod -- a name with a number on
// the end. Whether it is the primary, a standby keeping up or one that is
// not, and which cluster it belongs to, is spread over labels and the
// Cluster's status. This says it in a line, and says nothing at all about a
// pod CloudNativePG did not make.

import { CLUSTERS, key, LABEL, POOLERS, type Cluster, type Pod } from '../model/cnpg.js';
import { size } from '../model/units.js';
import { byId, el, replace } from '../ui/dom.js';
import { load } from '../ui/load.js';
import { openOn, start } from '../ui/page.js';
import { facts, nothing, openName, pill } from '../ui/parts.js';

start('panel', async () => {
    const host = byId('panel');
    const pod = await k8sdockside.object<Pod>();
    const labels = pod.metadata.labels ?? {};
    const clusterName = labels[LABEL.cluster];
    const namespace = pod.metadata.namespace ?? '';

    if (!clusterName) {
        replace(host, nothing('This pod is not part of a CloudNativePG cluster.'));
        return;
    }
    const clusterRef = { kind: CLUSTERS, namespace, name: clusterName };

    // A pooler's pod, or a job's: say which, and point at the owner.
    const pooler = labels[LABEL.poolerName];
    if (pooler) {
        replace(host, el('div', { class: 'panel-head' }, pill('PgBouncer', 'info'), el('span', {}, 'in front of '), openName(clusterName, clusterRef)), facts([['Pooler', openName(pooler, { kind: POOLERS, namespace, name: pooler })]]));
        return;
    }
    const job = labels[LABEL.jobRole];
    if (job) {
        replace(host, el('div', { class: 'panel-head' }, pill(`${job} job`), el('span', {}, 'for '), openName(clusterName, clusterRef)), el('p', { class: 'faint' }, 'A one-off job the operator ran for this cluster, not a Postgres instance.'));
        return;
    }

    const world = await load({ namespace });
    const found = world.facts.find((f) => key(f.topology.view.namespace, f.topology.view.name) === key(namespace, clusterName));
    const all = found ? [...(found.topology.primary ? [found.topology.primary] : []), ...found.topology.replicas] : [];
    const instance = all.find((i) => i.name === pod.metadata.name);
    const cluster = world.clusters.find((c: Cluster) => c.metadata.name === clusterName);

    const primary = instance?.primary ?? (labels[LABEL.instanceRole] ?? labels[LABEL.legacyRole]) === 'primary';
    const tone = instance?.tone ?? '';
    const head = el(
        'div',
        { class: 'panel-head' },
        pill(primary ? 'Primary' : 'Standby', primary ? 'info' : ''),
        el('span', {}, 'in'),
        openName(clusterName, clusterRef),
        found ? pill(found.topology.view.words, found.topology.view.tone) : null,
    );

    const pairs: [string, Node | string][] = [['State', el('span', { class: `tone-${tone || 'none'}` }, instance?.note ?? (cluster ? 'not in the cluster’s status' : 'the Cluster could not be read'))]];
    if (!primary && found?.topology.primary) pairs.push(['Follows', `${found.topology.primary.name} (${instance?.link === 'sync' ? 'synchronous candidate' : 'asynchronous'})`]);
    if (instance?.timeline !== undefined) pairs.push(['Timeline', String(instance.timeline)]);
    if (instance?.zone) pairs.push(['Zone', instance.zone]);
    if (instance?.volumes.length) pairs.push(['Disks', instance.volumes.map((v) => `${v.name} (${v.role === 'PG_WAL' ? 'WAL' : 'data'}, ${size(v.bytes)})`).join(', ')]);

    const topology = el('button', { type: 'button' }, 'Open the topology');
    topology.addEventListener('click', () => void openOn('topology', namespace, clusterName));
    replace(host, head, facts(pairs), el('div', { class: 'links', style: 'margin-top:8px' }, topology));
});
