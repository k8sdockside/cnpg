// The panel on a Cluster: its health, its shape, and whether it could be
// restored -- the three things the Cluster's own YAML takes a minute of
// scrolling to answer, in the space above it.

import { windowWords } from '../model/backups.js';
import { key, type Cluster } from '../model/cnpg.js';
import { sentence } from '../model/health.js';
import { count, span } from '../model/units.js';
import { actionBar } from '../ui/actions.js';
import { byId, el, replace } from '../ui/dom.js';
import { miniGlyph } from '../ui/glyph.js';
import { load } from '../ui/load.js';
import { openOn, start } from '../ui/page.js';
import { facts, nothing, pill } from '../ui/parts.js';

start('panel', async (ctx) => {
    const host = byId('panel');
    const cluster = await k8sdockside.object<Cluster>();
    const namespace = cluster.metadata.namespace ?? '';
    const world = await load({ namespace });
    const found = world.facts.find((f) => key(f.topology.view.namespace, f.topology.view.name) === key(namespace, cluster.metadata.name));
    if (!found) {
        replace(host, nothing('This Cluster could not be read with the rest of its namespace.'));
        return;
    }
    const { topology, backups } = found;
    const view = topology.view;
    const now = world.now;

    const head = el(
        'div',
        { class: 'panel-top' },
        el('div', { class: 'panel-glyph' }, miniGlyph(topology)),
        el(
            'div',
            { class: 'panel-main' },
            el('div', { class: 'panel-head' }, pill(view.words, view.tone), view.version ? pill(`Postgres ${view.version}`) : null, view.timeline !== undefined ? pill(`timeline ${view.timeline}`) : null),
            el('p', { class: 'panel-sentence' }, sentence(view)),
        ),
    );

    const standbys = topology.replicas.length ? topology.replicas.map((r) => `${r.name} (${r.note})`).join(', ') : 'none';
    const reach = windowWords(backups, now);
    const pairs: [string, Node | string][] = [
        ['Primary', topology.primary ? `${topology.primary.name}${topology.primary.node ? ` on ${topology.primary.node}` : ''}` : '—'],
        ['Standbys', standbys],
        ['Replication', topology.syncWords],
        ['Last backup', el('span', { class: `tone-${backups.freshness.tone || 'none'}`, title: backups.freshness.why }, backups.freshness.words)],
        ['Can restore', el('span', { class: `tone-${reach.tone || 'none'}` }, reach.words)],
    ];
    if (backups.next !== undefined) pairs.push(['Next backup', `in ${span(backups.next - now)}`]);
    const poolers = topology.entries.filter((e) => e.kind === 'pooler');
    if (poolers.length) pairs.push(['Poolers', poolers.map((p) => `${p.name} (${p.type}, ${p.ready}/${p.wanted})`).join(', ')]);
    if (backups.failures.length) pairs.push(['Failing', el('span', { class: 'tone-error' }, `${count(backups.failures.length, 'backup')}: ${backups.failures[0]?.error || backups.failures[0]?.words || ''}`)]);

    const links = el('div', { class: 'links' });
    const toTopology = el('button', { type: 'button' }, 'Open the topology');
    toTopology.addEventListener('click', () => void openOn('topology', view.namespace, view.name));
    const toBackups = el('button', { type: 'button' }, 'Backups');
    toBackups.addEventListener('click', () => void openOn('backups', view.namespace, view.name));
    links.append(toTopology, toBackups);

    replace(host, head, facts(pairs), el('div', { class: 'panel-actions' }, actionBar(view, ctx, { restart: true }), links));
});
