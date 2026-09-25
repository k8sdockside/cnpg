// Backups: could each cluster be brought back, and to when?
//
// One section per cluster, each answering in the same order:
//
//   1. how it backs up -- object store, volume snapshot or plugin -- and how
//      old the last good backup is, coloured against its own schedule
//   2. its schedules, in words ("every 10 minutes"), with the next run
//   3. a timeline of the last day, week or month: the window a point-in-time
//      recovery can reach as a band, every Backup as a dot, the next run as
//      a diamond
//   4. what failed since the last success, with the backup tool's own error
//      written out in full -- the one thing everyone needs and nobody finds
//      in a YAML status block
//   5. the recent Backups as a table
//
// A cluster with no backup configuration at all gets a section too, saying
// so, because "nothing could bring this back" is the most important line on
// the page.

import type { ClusterFacts } from '../model/attention.js';
import { methodWords, windowWords, type BackupView } from '../model/backups.js';
import { BACKUPS, key, SCHEDULED_BACKUPS } from '../model/cnpg.js';
import { count, DAY, span } from '../model/units.js';
import { actionBar } from '../ui/actions.js';
import { byId, el, replace } from '../ui/dom.js';
import { load, type World } from '../ui/load.js';
import { choose, every, moment, openCluster, start, wanted } from '../ui/page.js';
import { clickable, heading, nothing, pill, stat } from '../ui/parts.js';
import { timeline } from '../ui/timeline.js';

const REFRESH = 15_000;
const RANGES: [string, number][] = [
    ['Last 24 hours', DAY],
    ['Last 7 days', 7 * DAY],
    ['Last 30 days', 30 * DAY],
];

start('page', async (ctx) => {
    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });
    const only = el('select', { class: 'picker', 'aria-label': 'Cluster' });
    const range = el('select', { class: 'picker', 'aria-label': 'Time range' }, ...RANGES.map(([label, ms]) => el('option', { value: String(ms) }, label)));
    choose(range, String(7 * DAY));
    let chosen = await wanted('backups', true);
    let world: World | null = null;

    replace(byId('head'), heading('Backups', 'Every backup and schedule, and how far back each cluster can be restored.', el('span', { class: 'spacer' }), only, range));

    const render = () => {
        if (!world) return;
        const facts = chosen ? world.facts.filter((f) => key(f.topology.view.namespace, f.topology.view.name) === chosen) : world.facts;
        replace(body, failure, ...draw(world, facts.length ? facts : world.facts, Number(range.value), ctx, refresh));
    };
    only.addEventListener('change', () => {
        chosen = only.value;
        render();
    });
    range.addEventListener('change', render);

    const refresh = async () => {
        world = await load();
        fillPicker(only, world, chosen);
        failure.textContent = '';
        document.getElementById('first')?.remove();
        render();
    };
    const stop = every(REFRESH, refresh, (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
    });
    addEventListener('pagehide', stop);
});

function fillPicker(picker: HTMLSelectElement, world: World, chosen: string): void {
    const keys = ['', ...world.facts.map((f) => key(f.topology.view.namespace, f.topology.view.name))];
    const same = picker.options.length === keys.length && keys.every((k, i) => picker.options[i]?.value === k);
    if (!same) {
        replace(
            picker,
            el('option', { value: '' }, 'All clusters'),
            ...world.facts.map((f) => el('option', { value: key(f.topology.view.namespace, f.topology.view.name) }, `${f.topology.view.name} — ${f.topology.view.namespace}`)),
        );
    }
    choose(picker, keys.includes(chosen) ? chosen : '');
}

function draw(world: World, facts: ClusterFacts[], rangeMs: number, ctx: K8sDockside.Context, refresh: () => Promise<void>): HTMLElement[] {
    if (world.facts.length === 0) return [nothing('There is no Postgres cluster in any namespace you can see.')];
    const now = world.now;
    const all = facts.flatMap((f) => f.backups.backups);
    const dayAgo = now - DAY;
    const recent = all.filter((b) => (b.at ?? 0) >= dayAgo);
    const running = all.filter((b) => b.state === 'running' || b.state === 'pending');
    const nexts = facts.map((f) => f.backups.next).filter((n): n is number => n !== undefined).sort((a, b) => a - b);
    const unprotected = facts.filter((f) => !f.backups.configured).length;

    const stats = el(
        'div',
        { class: 'stats' },
        stat('Completed, 24h', String(recent.filter((b) => b.state === 'completed').length), `${count(all.length, 'Backup')} in all`),
        stat('Failed, 24h', String(recent.filter((b) => b.state === 'failed').length), 'since yesterday', recent.some((b) => b.state === 'failed') ? 'error' : ''),
        stat('Running now', String(running.length), running.length ? running.map((b) => b.cluster).join(', ') : 'nothing in progress', running.length ? 'info' : ''),
        stat('Next scheduled', nexts[0] !== undefined ? `in ${span(nexts[0] - now)}` : '—', nexts[0] !== undefined ? moment(nexts[0]) : 'no active schedule'),
        stat('Unprotected', String(unprotected), unprotected ? 'clusters with no backups at all' : 'every cluster backs up', unprotected ? 'warn' : ''),
    );
    let legend = true;
    const sections = facts.map((f) => {
        const drawn = section(f, now, rangeMs, ctx, refresh, legend);
        // The legend is drawn under the first timeline only.
        if (drawn.querySelector('.timeline')) legend = false;
        return drawn;
    });
    return [stats, ...sections];
}

function section(facts: ClusterFacts, now: number, rangeMs: number, ctx: K8sDockside.Context, refresh: () => Promise<void>, legend: boolean): HTMLElement {
    const { topology, backups } = facts;
    const view = topology.view;

    const name = el('button', { type: 'button', class: 'summary-name', title: 'Open the Cluster' }, view.name);
    name.addEventListener('click', () => openCluster(view.namespace, view.name));
    const methods = backups.methods.length ? backups.methods.map((m) => pill(methodWords(m), 'info')) : [pill('no backups configured', 'warn')];

    const head = el(
        'div',
        { class: 'backup-head' },
        el(
            'div',
            { class: 'summary-main' },
            el('div', { class: 'summary-title' }, name, el('span', { class: 'card-ns' }, view.namespace), ...methods, view.state === 'hibernated' ? pill('hibernated', 'info') : null),
            el(
                'p',
                { class: 'backup-facts' },
                el('span', {}, 'Last good backup ', el('strong', { class: `tone-${backups.freshness.tone || 'none'}`, title: backups.freshness.why }, backups.freshness.words)),
                el('span', {}, 'Can restore ', el('strong', { class: `tone-${windowWords(backups, now).tone || 'none'}` }, windowWords(backups, now).words)),
                backups.firstPoint !== undefined ? el('span', { class: 'faint' }, `from ${moment(backups.firstPoint)}`) : null,
            ),
        ),
        actionBar(view, ctx, { after: () => void refresh() }),
    );

    if (!backups.configured && backups.backups.length === 0) {
        return el(
            'section',
            { class: 'block backup-section' },
            head,
            el('p', { class: 'unprotected' }, `${view.name} has no backup section, no plugin that archives WAL and no schedule. If its volumes were lost, nothing here could bring the data back.`),
            el('p', { class: 'links' }, linkButton('How CloudNativePG backs up', 'https://cloudnative-pg.io/documentation/current/backup/')),
        );
    }

    const schedules = el('ul', { class: 'schedules' });
    for (const schedule of backups.schedules) {
        const tone = schedule.invalid || schedule.error ? 'error' : schedule.suspended ? 'info' : 'ok';
        const when = schedule.invalid
            ? `cannot run: ${schedule.invalid}`
            : schedule.error
              ? schedule.error
              : schedule.suspended
                ? 'suspended'
                : schedule.next !== undefined
                  ? `next in ${span(schedule.next - now)}`
                  : 'no next run';
        const row = el(
            'li',
            { class: 'schedule' },
            el('span', { class: `dot dot-${tone}` }),
            el('span', { class: 'schedule-name' }, schedule.name),
            el('span', {}, schedule.words),
            el('code', { class: 'mono faint', title: 'The schedule as written: six fields, seconds first' }, schedule.schedule),
            el('span', { class: `tone-${tone === 'ok' ? 'none' : tone}` }, when),
            el('span', { class: 'faint' }, schedule.methodWords),
        );
        clickable(row, () => void k8sdockside.open({ kind: SCHEDULED_BACKUPS, namespace: schedule.namespace, name: schedule.name }));
        schedules.append(row);
    }
    if (backups.schedules.length === 0) schedules.append(el('li', { class: 'schedule faint' }, 'No ScheduledBackup: backups happen only when someone asks for one.'));

    const drawing = timeline(backups, {
        now,
        range: rangeMs,
        tick: (t, r) => tickLabel(t, r),
        moment: (t) => moment(t),
        open: (b) => void k8sdockside.open({ kind: BACKUPS, namespace: b.namespace, name: b.name }),
    });

    return el(
        'section',
        { class: 'block backup-section' },
        head,
        schedules,
        el('div', { class: 'timeline-holder' }, drawing),
        legend ? timelineLegend() : null,
        failures(backups.failures),
        recentTable(backups.backups, now),
    );
}

function timelineLegend(): HTMLElement {
    return el(
        'ul',
        { class: 'map-legend' },
        el('li', {}, el('span', { class: 'key-band' }), 'restorable'),
        el('li', {}, el('span', { class: 'key key-completed' }), 'completed'),
        el('li', {}, el('span', { class: 'key key-failed' }), 'failed'),
        el('li', {}, el('span', { class: 'key key-running' }), 'running'),
        el('li', {}, el('span', { class: 'key-diamond' }), 'next scheduled'),
    );
}

function failures(list: BackupView[]): HTMLElement | null {
    if (list.length === 0) return null;
    return el(
        'div',
        { class: 'failures' },
        el('h3', {}, list.length === 1 ? 'The last backup failed' : `The last ${list.length} backups failed`),
        ...list.slice(0, 3).map((b) => {
            const row = el('div', { class: 'failure-row' }, el('div', { class: 'failure-name' }, el('strong', {}, b.name), el('span', { class: 'faint' }, ` · ${moment(b.at)} · ${b.methodWords}`)), el('pre', { class: 'failure-text' }, b.error || `The operator says: ${b.words}.`));
            clickable(row, () => void k8sdockside.open({ kind: BACKUPS, namespace: b.namespace, name: b.name }));
            return row;
        }),
    );
}

function recentTable(list: BackupView[], now: number): HTMLElement | null {
    if (list.length === 0) return el('p', { class: 'empty' }, 'No Backup objects yet.');
    const shown = list.slice(0, 6);
    const rows = shown.map((b) => {
        const row = el(
            'tr',
            { class: 'clickable' },
            el('td', {}, el('span', { class: `dot dot-${b.tone || 'none'}` }), ' ', b.name),
            el('td', {}, pill(b.words, b.tone)),
            el('td', { title: moment(b.at) }, b.at !== undefined ? `${span(now - b.at)} ago` : '—'),
            el('td', {}, b.took !== undefined ? span(b.took) : '—'),
            el('td', {}, b.methodWords),
            el('td', {}, b.scheduledBy || 'on demand'),
            el('td', {}, b.instance || '—'),
        );
        row.addEventListener('click', () => void k8sdockside.open({ kind: BACKUPS, namespace: b.namespace, name: b.name }));
        return row;
    });
    return el(
        'div',
        { class: 'table-wrap' },
        el(
            'table',
            {},
            el('thead', {}, el('tr', {}, ...['Backup', 'Result', 'When', 'Took', 'Method', 'Made by', 'From'].map((h) => el('th', {}, h)))),
            el('tbody', {}, ...rows),
        ),
        list.length > shown.length ? el('p', { class: 'chart-more' }, `and ${list.length - shown.length} older — all of them are under Backups in the sidebar`) : null,
    );
}

function tickLabel(t: number, range: number): string {
    const format = k8sdockside.format;
    if (range <= DAY) return format ? format.time(t) : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return format ? format.day(t) : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function linkButton(label: string, url: string): HTMLElement {
    const node = el('button', { type: 'button' }, label);
    node.addEventListener('click', () => void k8sdockside.openUrl(url));
    return node;
}
