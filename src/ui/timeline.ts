// A cluster's backups on a line of time.
//
// One drawing answers the three backup questions at once, on one axis:
//
//   how far back can I restore   the band on top: from the first
//                                recoverability point to now, green -- or
//                                ending in red when WAL archiving is failing,
//                                because then "now" is not reachable
//   what happened                a dot per Backup: green completed, red
//                                failed, a hollow ring still running
//   what happens next            a diamond at the next scheduled run
//
// The axis runs from `range` ago to a little past now, so the next run has
// somewhere to be.

import type { BackupSummary, BackupView } from '../model/backups.js';
import { DAY, HOUR, span } from '../model/units.js';
import { svgEl } from './dom.js';
import { clickable } from './parts.js';

const W = 860;
const H = 92;
const PAD = 10;

export interface TimelineOptions {
    now: number;
    range: number;
    /** Writes a tick label the user's way. */
    tick(when: number, range: number): string;
    moment(when: number): string;
    open(backup: BackupView): void;
}

export function timeline(summary: BackupSummary, options: TimelineOptions): SVGElement {
    const { now, range } = options;
    const start = now - range;
    const end = now + range * 0.08;
    const x = (t: number) => PAD + ((Math.min(end, Math.max(start, t)) - start) / (end - start)) * (W - 2 * PAD);
    const drawing = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'timeline', role: 'img', 'aria-label': 'Backups over time' });

    // Ticks first, underneath everything.
    const step = range <= DAY ? 3 * HOUR : range <= 7 * DAY ? DAY : 5 * DAY;
    const firstTick = Math.ceil(start / step) * step;
    for (let t = firstTick; t <= now; t += step) {
        drawing.append(svgEl('line', { x1: x(t).toFixed(1), x2: x(t).toFixed(1), y1: 8, y2: 66, class: 'tick' }));
        drawing.append(svgEl('text', { x: x(t).toFixed(1), y: 82, class: 'tick-label', 'text-anchor': 'middle' }, options.tick(t, range)));
    }

    // The recovery window.
    drawing.append(svgEl('rect', { x: PAD, y: 14, width: W - 2 * PAD, height: 10, rx: 5, class: 'band-track' }));
    if (summary.firstPoint !== undefined) {
        const from = x(summary.firstPoint);
        const reach = summary.archiving === false && summary.last !== undefined ? Math.max(summary.last, summary.firstPoint) : now;
        const band = svgEl('rect', { x: from.toFixed(1), y: 14, width: Math.max(3, x(reach) - from).toFixed(1), height: 10, rx: 5, class: 'band' });
        band.append(svgEl('title', {}, `Restorable from ${options.moment(summary.firstPoint)}${summary.estimated ? ' (estimated from Backup objects)' : ''}`));
        drawing.append(band);
        if (summary.archiving === false) {
            const gap = svgEl('rect', { x: x(reach).toFixed(1), y: 14, width: Math.max(3, x(now) - x(reach)).toFixed(1), height: 10, rx: 5, class: 'band-gap' });
            gap.append(svgEl('title', {}, 'WAL archiving is failing: changes in this stretch are not saved anywhere a restore can reach.'));
            drawing.append(gap);
        }
        if (summary.firstPoint < start) {
            drawing.append(svgEl('text', { x: PAD + 4, y: 23, class: 'band-more' }, `◂ ${span(now - summary.firstPoint)}`));
        }
    }

    // The backups track.
    drawing.append(svgEl('line', { x1: PAD, x2: W - PAD, y1: 46, y2: 46, class: 'track' }));
    const visible = summary.backups.filter((b) => b.at !== undefined && b.at >= start && b.at <= end);
    for (const backup of [...visible].reverse()) {
        const cx = x(backup.at!);
        const mark = svgEl('circle', { cx: cx.toFixed(1), cy: 46, r: backup.state === 'running' || backup.state === 'pending' ? 5 : 5.5, class: `dotmark dot-${backup.state}` });
        mark.append(svgEl('title', {}, `${backup.name}: ${backup.words.toLowerCase()}, ${options.moment(backup.at!)}${backup.error ? ` — ${backup.error}` : ''}`));
        clickable(mark, () => options.open(backup), `Open ${backup.name}`);
        drawing.append(mark);
    }
    const older = summary.backups.filter((b) => b.at !== undefined && b.at < start).length;
    if (older > 0) drawing.append(svgEl('text', { x: PAD + 2, y: 60, class: 'band-more' }, `+${older} older`));

    // Now, and what comes next.
    drawing.append(svgEl('line', { x1: x(now).toFixed(1), x2: x(now).toFixed(1), y1: 8, y2: 66, class: 'now' }));
    drawing.append(svgEl('text', { x: x(now).toFixed(1), y: 82, class: 'now-label', 'text-anchor': 'middle' }, 'now'));
    if (summary.next !== undefined) {
        const nx = summary.next <= end ? x(summary.next) : W - PAD - 4;
        const diamond = svgEl('path', { d: `M${nx.toFixed(1)},39 l7,7 l-7,7 l-7,-7 z`, class: 'next-run' });
        diamond.append(svgEl('title', {}, `Next scheduled backup: ${options.moment(summary.next)} (in ${span(summary.next - now)})`));
        drawing.append(diamond);
        // Past the right edge it waits there; the schedule line says when.
    }
    return drawing;
}
