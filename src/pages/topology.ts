// Topology: one cluster, drawn as what it is.
//
// The primary in the middle, its standbys on an arc around it, and down the
// left every way in -- the PgBouncer poolers and the rw, ro and r Services
// the operator makes -- wired to the instances they send traffic to. Each
// link says whether it is a synchronous candidate or async, and how far the
// standby is behind when Prometheus knows. Under the map, the same instances
// as a table, with the node and zone each runs in and the disks it has.
//
// It opens on the cluster the app focused it on (the address after #), or
// the one the dashboard handed over through storage, or the first there is,
// and a picker switches between them.

import { key, PODS, POOLERS, PVCS, SERVICES } from '../model/cnpg.js';
import { sentence } from '../model/health.js';
import type { Topology, Instance, EntryPoint } from '../model/topology.js';
import { size, span } from '../model/units.js';
import { actionBar } from '../ui/actions.js';
import { byId, el, replace } from '../ui/dom.js';
import { topologyMap } from '../ui/glyph.js';
import { load } from '../ui/load.js';
import { choose, every, focusKey, openCluster, openOn, start, wanted } from '../ui/page.js';
import { block, clickable, heading, nothing, pill } from '../ui/parts.js';

const REFRESH = 10_000;

start('page', async (ctx) => {
    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });
    const picker = el('select', { class: 'picker', 'aria-label': 'Cluster' });
    let chosen = await wanted('topology');
    let last: Topology[] = [];

    replace(byId('head'), heading('Topology', 'Where each instance runs, which one takes the writes, and how the rest keep up.', el('span', { class: 'spacer' }), picker));

    picker.addEventListener('change', () => {
        chosen = picker.value;
        const [namespace = '', name = ''] = chosen.split('/');
        void k8sdockside.storage?.set(focusKey('topology'), { namespace, name }).catch(() => {});
        render();
    });

    const render = () => {
        const topology = last.find((t) => key(t.view.namespace, t.view.name) === chosen) ?? last[0];
        if (!topology) {
            replace(body, failure, nothing('There is no Postgres cluster in any namespace you can see.'));
            return;
        }
        chosen = key(topology.view.namespace, topology.view.name);
        replace(body, failure, ...draw(topology, ctx, refresh));
    };

    const refresh = async () => {
        const world = await load({ charts: true, minutes: 15 });
        last = world.facts.map((f) => f.topology);
        fillPicker(picker, last, chosen);
        failure.textContent = '';
        document.getElementById('first')?.remove();
        render();
    };

    const stop = every(REFRESH, refresh, (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
    });
    addEventListener('pagehide', stop);
});

function fillPicker(picker: HTMLSelectElement, topologies: Topology[], chosen: string): void {
    const keys = topologies.map((t) => key(t.view.namespace, t.view.name));
    const same = picker.options.length === keys.length && keys.every((k, i) => picker.options[i]?.value === k);
    if (!same) {
        replace(picker, ...topologies.map((t) => el('option', { value: key(t.view.namespace, t.view.name) }, `${t.view.name} — ${t.view.namespace}`)));
    }
    if (keys.includes(chosen)) choose(picker, chosen);
}

function draw(topology: Topology, ctx: K8sDockside.Context, refresh: () => Promise<void>): HTMLElement[] {
    const view = topology.view;
    const openInstance = (instance: Instance) => void k8sdockside.open({ kind: PODS, namespace: instance.namespace, name: instance.name });
    const openEntry = (entry: EntryPoint) => void k8sdockside.open({ kind: entry.kind === 'pooler' ? POOLERS : SERVICES, namespace: entry.namespace, name: entry.name });

    const name = el('button', { type: 'button', class: 'summary-name', title: 'Open the Cluster' }, view.name);
    name.addEventListener('click', () => openCluster(view.namespace, view.name));

    const summary = el(
        'div',
        { class: 'summary' },
        el(
            'div',
            { class: 'summary-main' },
            el('div', { class: 'summary-title' }, name, el('span', { class: 'card-ns' }, view.namespace), pill(view.words, view.tone), view.version ? pill(`Postgres ${view.version}`) : null, view.timeline !== undefined ? pill(`timeline ${view.timeline}`, '', 'The Postgres timeline: it goes up by one at every promotion') : null),
            el('p', { class: 'summary-sentence' }, sentence(view)),
            el('p', { class: 'summary-sync' }, `Replication: ${topology.syncWords}.`),
        ),
        actionBar(view, ctx, { restart: true, after: () => void refresh() }),
    );

    const map = el('div', { class: 'map-holder' }, topologyMap(topology, { instance: openInstance, entry: openEntry }));
    const legend = el(
        'ul',
        { class: 'map-legend' },
        el('li', {}, el('span', { class: 'key key-primary' }), 'primary'),
        el('li', {}, el('span', { class: 'key key-replica' }), 'standby, streaming'),
        el('li', {}, el('span', { class: 'key key-broken' }), 'not streaming'),
        el('li', {}, el('span', { class: 'key-line key-sync' }), 'synchronous candidate'),
        el('li', {}, el('span', { class: 'key-line key-async' }), 'asynchronous'),
    );

    const blocks: HTMLElement[] = [summary, el('section', { class: 'block map-block' }, map, legend), instancesTable(topology, openInstance)];
    if (topology.entries.length) blocks.push(waysIn(topology, openEntry));
    return blocks;
}

function instancesTable(topology: Topology, open: (instance: Instance) => void): HTMLElement {
    const all = [...(topology.primary ? [topology.primary] : []), ...topology.replicas];
    if (all.length === 0) return block('Instances', '', nothing('The operator has not created any instance yet.'));
    const rows = all.map((instance) => {
        const row = el(
            'tr',
            { class: 'clickable' },
            el('td', {}, el('span', { class: `dot dot-${instance.tone || 'none'}` }), ' ', el('strong', {}, instance.name)),
            el('td', {}, instance.primary ? pill('primary', 'info') : instance.becomingPrimary ? pill('being promoted', 'warn') : 'standby'),
            el('td', { class: `tone-${instance.tone || 'none'}` }, instance.note),
            el('td', {}, instance.node || '—'),
            el('td', {}, instance.zone || '—'),
            el('td', { class: 'num' }, instance.timeline !== undefined ? String(instance.timeline) : '—'),
            el('td', {}, ...disks(instance)),
            el('td', { class: 'num' }, instance.lag === undefined ? '—' : span(instance.lag * 1000)),
            el('td', { class: 'num' }, instance.restarts ? String(instance.restarts) : '0'),
        );
        row.addEventListener('click', () => open(instance));
        return row;
    });
    const zones = new Set(all.map((i) => i.zone).filter((z) => z));
    const note = [
        topology.nodes.length ? `${topology.nodes.length} node${topology.nodes.length === 1 ? '' : 's'}${zones.size ? ` in ${zones.size} zone${zones.size === 1 ? '' : 's'}` : ''}` : '',
        topology.sharedNode ? 'some instances share a node, so losing it loses more than one' : '',
        'Lag comes from Prometheus, when there is one.',
    ]
        .filter((s) => s)
        .join('. ');
    return block(
        'Instances',
        note,
        el(
            'div',
            { class: 'table-wrap' },
            el(
                'table',
                {},
                el('thead', {}, el('tr', {}, ...['Instance', 'Role', 'State', 'Node', 'Zone', 'Timeline', 'Disks', 'Lag', 'Restarts'].map((h) => el('th', {}, h)))),
                el('tbody', {}, ...rows),
            ),
        ),
    );
}

function disks(instance: Instance): Node[] {
    if (instance.volumes.length === 0) return [document.createTextNode('—')];
    return instance.volumes.map((volume) => {
        const chip = el('span', { class: 'chip', title: `${volume.name} (${volume.phase || 'unknown'})` }, `${volume.role === 'PG_WAL' ? 'WAL' : volume.role === 'PG_TABLESPACE' ? 'tablespace' : 'data'} ${size(volume.bytes)}`);
        clickable(chip, () => void k8sdockside.open({ kind: PVCS, namespace: instance.namespace, name: volume.name }), `Open ${volume.name}`);
        return chip;
    });
}

function waysIn(topology: Topology, open: (entry: EntryPoint) => void): HTMLElement {
    const list = el('ul', { class: 'issues' });
    for (const entry of topology.entries) {
        const row = el(
            'li',
            { class: 'issue' },
            el('span', { class: `dot dot-${entry.tone || 'none'}` }),
            el('span', { class: 'issue-title' }, entry.name),
            el('span', { class: 'issue-detail' }, `${entry.kind === 'pooler' ? 'PgBouncer pooler' : 'Service'} (${entry.type}): ${entry.note}`),
        );
        clickable(row, () => open(entry));
        list.append(row);
    }
    return block(
        'Ways in',
        'Applications connect through these. rw reaches the primary, ro the standbys, r any instance; a pooler adds PgBouncer in front.',
        list,
        el('p', { class: 'links' }, linkTo('All backups of this cluster', () => void openOn('backups', topology.view.namespace, topology.view.name))),
    );
}

function linkTo(label: string, onClick: () => void): HTMLElement {
    const node = el('button', { type: 'button' }, label);
    node.addEventListener('click', onClick);
    return node;
}
