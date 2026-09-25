// The two drawings of a cluster's shape: a glyph the size of a thumbnail for
// the dashboard's cards, and the full map for the Topology view.
//
// Both follow the same conventions, so reading one teaches the other:
//
//   the primary     the big filled circle, in the accent colour
//   a standby       a smaller ring: green when streaming, amber when lagging,
//                   red when it is not streaming at all
//   the link        solid for a synchronous candidate, dashed for async
//   asleep          everything hollow, dashed and faint: a hibernated cluster
//                   has the shape and none of the pods
//
// Colours come from classes in cnpg.css, which are theme tokens -- nothing
// here names a colour -- and every label is a text node.

import type { EntryPoint, Instance, Topology } from '../model/topology.js';
import { size, type Tone } from '../model/units.js';
import { svgEl } from './dom.js';
import { clickable } from './parts.js';

const toneClass = (tone: Tone) => `tone-${tone || 'none'}`;

/** How a glyph's picture of one instance is classed. */
function nodeClass(instance: Instance, asleep: boolean): string {
    if (asleep) return 'node node-asleep';
    const parts = ['node', instance.primary ? 'node-primary' : 'node-replica', toneClass(instance.tone)];
    if (instance.becomingPrimary) parts.push('node-promoting');
    return parts.join(' ');
}

function edgeClass(instance: Instance, asleep: boolean): string {
    const parts = ['edge', instance.link === 'sync' ? 'edge-sync' : 'edge-async'];
    if (asleep) parts.push('edge-asleep');
    else if (!instance.streaming) parts.push('edge-broken');
    else parts.push(toneClass(instance.tone));
    return parts.join(' ');
}

/** The thumbnail: primary on the left, standbys stacked on the right. */
export function miniGlyph(topology: Topology, width = 112, height = 66): SVGElement {
    const asleep = topology.view.state === 'hibernated' || topology.view.state === 'hibernating';
    const drawing = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: `glyph${asleep ? ' glyph-asleep' : ''}`, role: 'img' });
    drawing.append(svgEl('title', {}, glyphTitle(topology)));

    const px = 30;
    const py = height / 2;
    const pr = 13;
    const shown = topology.replicas.slice(0, 4);
    const extra = topology.replicas.length - shown.length;
    const rx = width - 22;
    const rr = 8;
    const gap = shown.length > 1 ? Math.min(20, (height - 18) / (shown.length - 1)) : 0;
    const top = py - (gap * (shown.length - 1)) / 2;

    shown.forEach((replica, i) => {
        const y = top + i * gap;
        const dx = rx - px;
        const dy = y - py;
        const length = Math.hypot(dx, dy) || 1;
        drawing.append(
            svgEl('line', {
                x1: (px + (dx / length) * pr).toFixed(1),
                y1: (py + (dy / length) * pr).toFixed(1),
                x2: (rx - (dx / length) * rr).toFixed(1),
                y2: (y - (dy / length) * rr).toFixed(1),
                class: edgeClass(replica, asleep),
            }),
        );
        drawing.append(svgEl('circle', { cx: rx, cy: y.toFixed(1), r: rr, class: nodeClass(replica, asleep) }));
    });

    if (topology.replicas.length === 0 && !asleep) {
        // No standby: a ghost where one would be, so a single instance looks
        // like something is missing -- because something is.
        drawing.append(svgEl('line', { x1: px + pr, y1: py, x2: rx - rr, y2: py, class: 'edge edge-ghost' }));
        drawing.append(svgEl('circle', { cx: rx, cy: py, r: rr, class: 'node node-ghost' }));
    }
    if (extra > 0) drawing.append(svgEl('text', { x: rx, y: height - 1, class: 'glyph-more', 'text-anchor': 'middle' }, `+${extra}`));

    const primary = topology.primary;
    drawing.append(
        svgEl('circle', {
            cx: px,
            cy: py,
            r: pr,
            class: primary ? nodeClass(primary, asleep) : 'node node-missing',
        }),
    );
    if (asleep) drawing.append(svgEl('text', { x: px + pr + 3, y: py - pr + 2, class: 'glyph-zz' }, 'z z'));
    return drawing;
}

function glyphTitle(topology: Topology): string {
    const primary = topology.primary ? `primary ${topology.primary.name}` : 'no primary';
    const standbys = topology.replicas.map((r) => `${r.name} ${r.note}`).join('; ');
    return standbys ? `${primary}; ${standbys}` : `${primary}; no standby`;
}

// ----- the full map ----------------------------------------------------------------

export interface MapHandlers {
    instance(instance: Instance): void;
    entry(entry: EntryPoint): void;
}

const ENTRY_W = 200;
const ENTRY_H = 48;
const ENTRY_GAP = 12;

const f = (n: number) => n.toFixed(1);

/** Cuts a label to fit, since SVG text does not ellipsize itself. */
function fit(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The Topology view's map: the ways in down the left, the primary in the
 * middle, the standbys on an arc around it, and on every link what kind it
 * is and how far behind.
 */
export function topologyMap(topology: Topology, on: MapHandlers): SVGElement {
    const asleep = topology.view.state === 'hibernated' || topology.view.state === 'hibernating';
    const replicas = topology.replicas;
    const n = replicas.length;
    const R = n > 4 ? 230 : 200;
    const spread = n <= 1 ? 0 : Math.min(160, 52 * (n - 1));
    const armHeight = n <= 1 ? 0 : 2 * R * Math.sin(((spread / 2) * Math.PI) / 180);
    const entries = topology.entries;
    const entriesHeight = entries.length * (ENTRY_H + ENTRY_GAP);
    const H = Math.round(Math.max(360, armHeight + 170, entriesHeight + 40, 2 * 150));
    const cx = 16 + ENTRY_W + 240;
    const cy = H / 2;
    // As wide as the drawing needs: the arc's right edge and the labels under it.
    const reachRight = n === 0 ? 0 : R * (n % 2 === 1 ? 1 : Math.cos(((spread / Math.max(1, n - 1)) * Math.PI) / 360));
    const W = Math.round(cx + Math.max(reachRight, 60) + 130);

    const drawing = svgEl('svg', {
        viewBox: `0 0 ${W} ${H}`,
        class: `map${asleep ? ' map-asleep' : ''}`,
        role: 'img',
        'aria-label': `Topology of ${topology.view.name}`,
        style: `max-width:${Math.round(W * 1.25)}px`,
    });

    // Where each instance sits.
    const at = new Map<string, { x: number; y: number; r: number }>();
    if (topology.primary) at.set(topology.primary.name, { x: cx, y: cy, r: 42 });
    replicas.forEach((replica, i) => {
        const angle = ((n <= 1 ? 0 : -spread / 2 + (i * spread) / (n - 1)) * Math.PI) / 180;
        at.set(replica.name, { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle), r: 30 });
    });

    const edges = svgEl('g', { class: 'map-edges' });
    const labels = svgEl('g', { class: 'map-labels' });
    drawing.append(edges);

    // The ways in, down the left, each wired to what it sends traffic to.
    const entryTop = cy - (entriesHeight - ENTRY_GAP) / 2;
    entries.forEach((entry, i) => {
        const y = entryTop + i * (ENTRY_H + ENTRY_GAP);
        const targets = entryTargets(entry, topology);
        for (const target of targets) {
            const to = at.get(target.name);
            if (!to) continue;
            const x1 = 16 + ENTRY_W;
            const y1 = y + ENTRY_H / 2;
            const x2 = to.x - to.r - 4;
            let d: string;
            if (target === topology.primary) {
                const bend = Math.max(40, (x2 - x1) / 2);
                d = `M${x1},${f(y1)} C${f(x1 + bend)},${f(y1)} ${f(x2 - bend)},${f(to.y)} ${f(x2)},${f(to.y)}`;
            } else {
                // Around the primary rather than through it and its labels:
                // over the top for a standby above the middle, under the
                // labels for one below.
                const wy = to.y <= cy ? cy - 72 : cy + 128;
                d = `M${x1},${f(y1)} C${f(x1 + 90)},${f(y1)} ${f(cx - 130)},${f(wy)} ${f(cx)},${f(wy)} S${f(x2 - 50)},${f(to.y)} ${f(x2)},${f(to.y)}`;
            }
            edges.append(svgEl('path', { d, class: `entry-edge entry-${entry.kind}${asleep ? ' edge-asleep' : ''}` }));
        }
        drawing.append(entryBox(entry, 16, y, on));
    });

    // Primary to standby: the replication links.
    for (const replica of replicas) {
        const from = topology.primary ? at.get(topology.primary.name) : undefined;
        const to = at.get(replica.name);
        if (!from || !to) continue;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy) || 1;
        const x1 = from.x + (dx / length) * (from.r + 3);
        const y1 = from.y + (dy / length) * (from.r + 3);
        const x2 = to.x - (dx / length) * (to.r + 3);
        const y2 = to.y - (dy / length) * (to.r + 3);
        edges.append(svgEl('line', { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), class: `${edgeClass(replica, asleep)} map-edge` }));
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        labels.append(svgEl('text', { x: mx.toFixed(1), y: (my - 6).toFixed(1), class: `edge-label ${asleep ? '' : toneClass(replica.streaming ? replica.tone : 'error')}`, 'text-anchor': 'middle' }, linkWords(replica, asleep)));
    }

    // The instances themselves, on top of the links.
    const all = [...(topology.primary ? [topology.primary] : []), ...replicas];
    for (const instance of all) {
        const where = at.get(instance.name);
        if (!where) continue;
        drawing.append(instanceNode(instance, where, asleep, on));
    }
    drawing.append(labels);

    if (!topology.primary && n === 0) {
        drawing.append(svgEl('text', { x: cx, y: cy, class: 'map-empty', 'text-anchor': 'middle' }, 'No instance yet'));
    }
    return drawing;
}

function entryTargets(entry: EntryPoint, topology: Topology): Instance[] {
    const primary = topology.primary ? [topology.primary] : [];
    if (entry.type === 'ro') return topology.replicas.length ? topology.replicas : primary;
    if (entry.type === 'r') return [...primary, ...topology.replicas];
    return primary;
}

function linkWords(instance: Instance, asleep: boolean): string {
    const kind = instance.link === 'sync' ? 'sync' : 'async';
    if (asleep) return kind;
    if (!instance.streaming) return `${kind} · not streaming`;
    if (instance.lag === undefined) return `${kind} · streaming`;
    return `${kind} · ${instance.lag < 1 ? 'in step' : instance.note.replace('streaming, ', '')}`;
}

function entryBox(entry: EntryPoint, x: number, y: number, on: MapHandlers): SVGElement {
    const group = svgEl('g', { class: `entry entry-box-${entry.kind} ${toneClass(entry.tone)}`, transform: `translate(${x},${y})` });
    group.append(svgEl('title', {}, `${entry.kind === 'pooler' ? 'Pooler' : 'Service'} ${entry.name}: ${entry.note}`));
    group.append(svgEl('rect', { width: ENTRY_W, height: ENTRY_H, rx: 9, class: 'entry-rect' }));
    group.append(svgEl('rect', { width: 4, height: ENTRY_H - 16, x: 0, y: 8, rx: 2, class: 'entry-edge-mark' }));
    group.append(svgEl('text', { x: 14, y: 20, class: 'entry-name' }, fit(entry.name, 24)));
    const kind = entry.kind === 'pooler' ? `PgBouncer · ${entry.type}` : `Service · ${entry.type}`;
    const detail = entry.kind === 'pooler' ? `${kind} · ${entry.ready}/${entry.wanted} ready` : `${kind} → ${entry.type === 'rw' ? 'primary' : entry.type === 'ro' ? 'standbys' : 'any'}`;
    group.append(svgEl('text', { x: 14, y: 37, class: 'entry-detail' }, fit(detail, 32)));
    clickable(group, () => on.entry(entry), `Open ${entry.name}`);
    return group;
}

function instanceNode(instance: Instance, where: { x: number; y: number; r: number }, asleep: boolean, on: MapHandlers): SVGElement {
    const group = svgEl('g', { class: `instance ${instance.primary ? 'instance-primary' : 'instance-replica'}`, transform: `translate(${where.x.toFixed(1)},${where.y.toFixed(1)})` });
    group.append(svgEl('title', {}, `${instance.name}: ${instance.note}`));
    if (instance.becomingPrimary && !asleep) group.append(svgEl('circle', { r: where.r + 7, class: 'node-halo' }));
    group.append(svgEl('circle', { r: where.r, class: nodeClass(instance, asleep) }));
    group.append(svgEl('text', { y: 4, class: `node-role${instance.primary && !asleep ? ' node-role-primary' : ''}`, 'text-anchor': 'middle' }, instance.primary ? 'PRIMARY' : 'STANDBY'));

    const below = where.r + 16;
    group.append(svgEl('text', { y: below, class: 'node-name', 'text-anchor': 'middle' }, fit(instance.name, 26)));
    const place = [instance.node, instance.zone].filter((s) => s).join(' · ');
    group.append(svgEl('text', { y: below + 15, class: 'node-detail', 'text-anchor': 'middle' }, fit(place || (asleep ? 'no pod' : 'not scheduled'), 34)));
    const disks = instance.volumes.map((v) => `${v.role === 'PG_WAL' ? 'WAL ' : v.role === 'PG_TABLESPACE' ? 'tbs ' : ''}${size(v.bytes)}`).join(' + ');
    const timeline = instance.timeline !== undefined ? `TL ${instance.timeline}` : '';
    const line3 = [disks, timeline].filter((s) => s).join(' · ');
    if (line3) group.append(svgEl('text', { y: below + 29, class: 'node-detail', 'text-anchor': 'middle' }, fit(line3, 34)));
    if (!asleep && instance.tone !== 'ok' && instance.tone !== '') {
        group.append(svgEl('text', { y: below + (line3 ? 43 : 29), class: `node-trouble ${toneClass(instance.tone)}`, 'text-anchor': 'middle' }, fit(instance.note, 36)));
    }
    clickable(group, () => on.instance(instance), `Open ${instance.name}`);
    return group;
}
