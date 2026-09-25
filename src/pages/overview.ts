// The dashboard: every Postgres cluster at a glance, and what needs a person.
//
//   Is it up?              one card per cluster: its state in words, and its
//                          shape as a glyph -- primary, standbys, and which
//                          of them are not keeping up
//   Could I restore it?    on the same card: how old the last backup is,
//                          coloured against its own schedule, and how far
//                          back a point-in-time recovery can reach
//   What needs me?         the attention list, worst first, each row opening
//                          the object it is about
//   How is it doing?       the exporter's numbers from Prometheus, when there
//                          is one; the page says so plainly when there is not

import { issues, type ClusterFacts, type Issue } from '../model/attention.js';
import { windowWords } from '../model/backups.js';
import { sentence } from '../model/health.js';
import { latest, seriesLabel } from '../model/metrics.js';
import { count, DAY, percent, size, span, worst, type Tone } from '../model/units.js';
import { byId, el, replace } from '../ui/dom.js';
import { miniGlyph } from '../ui/glyph.js';
import { load, type World } from '../ui/load.js';
import { every, openOn, start } from '../ui/page.js';
import { block, clickable, formatValue, heading, nothing, pill, sparkline, stat, toneVar } from '../ui/parts.js';

const REFRESH = 15_000;

start('page', async (ctx) => {
    replace(byId('head'), heading('CloudNativePG', `PostgreSQL in ${ctx.contextName}.`));
    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });

    // Before anything else: is CloudNativePG here at all?
    try {
        const summary = await k8sdockside.summary();
        if (summary.checked && !summary.installed) {
            document.getElementById('first')?.remove();
            replace(body, notInstalled(ctx));
            return;
        }
    } catch {
        // Could not tell: carry on, and let the list below say what it can.
    }

    const stop = every(
        REFRESH,
        async () => {
            const world = await load({ charts: true, minutes: 60 });
            failure.textContent = '';
            document.getElementById('first')?.remove();
            replace(body, failure, ...draw(world));
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

function draw(world: World): (Node | null)[] {
    if (world.facts.length === 0) {
        return [
            block(
                'No Postgres clusters yet',
                'The operator is installed, but no Cluster exists in any namespace you can see. Create one and it appears here within a few seconds.',
                el('p', { class: 'links' }, linkButton('Quickstart', 'https://cloudnative-pg.io/documentation/current/quickstart/')),
            ),
        ];
    }
    const problems = issues(world.facts);
    return [stats(world), el('div', { class: 'cards' }, ...world.facts.map((facts) => card(facts, world.now))), attention(problems), charts(world.charts)];
}

function stats(world: World): HTMLElement {
    const views = world.facts.map((f) => f.topology.view);
    const healthy = views.filter((v) => v.state === 'healthy').length;
    const asleep = views.filter((v) => v.state === 'hibernated' || v.state === 'hibernating').length;
    const bad = views.filter((v) => v.tone === 'error').length;

    const awake = world.facts.filter((f) => f.topology.view.state !== 'hibernated');
    const wanted = awake.reduce((n, f) => n + f.topology.view.instances, 0);
    const ready = awake.reduce((n, f) => n + f.topology.view.ready, 0);

    const dayAgo = world.now - DAY;
    const recent = world.facts.flatMap((f) => f.backups.backups).filter((b) => (b.at ?? 0) >= dayAgo);
    const completed = recent.filter((b) => b.state === 'completed').length;
    const failed = recent.filter((b) => b.state === 'failed').length;

    const poolers = world.facts.flatMap((f) => f.topology.entries.filter((e) => e.kind === 'pooler'));
    const poolersOk = poolers.filter((p) => p.tone === 'ok').length;

    return el(
        'div',
        { class: 'stats' },
        stat('Clusters healthy', `${healthy} / ${views.length}`, [bad ? `${bad} failing` : '', asleep ? `${asleep} asleep` : '', !bad && !asleep ? 'all of them' : ''].filter((s) => s).join(' · '), bad ? 'error' : healthy < views.length - asleep ? 'warn' : '', bad ? 'error' : ''),
        stat('Instances ready', `${ready} / ${wanted}`, asleep ? 'hibernated clusters left out' : 'across every cluster', ready < wanted ? 'warn' : ''),
        stat('Backups, last 24h', String(completed), failed ? `${failed} failed` : 'none failed', '', failed ? 'error' : ''),
        stat('Poolers', poolers.length ? `${poolersOk} / ${poolers.length}` : '—', poolers.length ? 'serving' : 'no PgBouncer in front of any cluster', poolersOk < poolers.length ? 'warn' : ''),
    );
}

/** One cluster: its shape, its state, and whether it could be restored. */
function card(facts: ClusterFacts, now: number): HTMLElement {
    const { topology, backups } = facts;
    const view = topology.view;
    // The edge says the worst about the cluster, its backups included: a
    // database that is up but could not be restored is not fine.
    const backupTone: Tone = backups.failures.length > 0 || backups.archiving === false ? 'error' : backups.freshness.tone === 'ok' ? '' : backups.freshness.tone;
    const tone: Tone = view.state === 'hibernated' ? 'info' : worst(topology.tone, backupTone);
    const open = () => void openOn('topology', view.namespace, view.name);

    const glyph = el('div', { class: 'card-glyph', title: 'Open the topology' }, miniGlyph(topology));
    clickable(glyph, open, `Open the topology of ${view.name}`);

    const title = el('button', { type: 'button', class: 'card-name', title: 'Open the topology' }, view.name);
    title.addEventListener('click', open);

    const reach = windowWords(backups, now);
    const lastTone = backups.freshness.tone;
    const nextRun = backups.next !== undefined ? ` · next in ${span(backups.next - now)}` : '';

    const storage = view.storage ? size(view.storage) + (view.walStorage ? ` + ${size(view.walStorage)} WAL` : '') : '—';
    const instances = view.state === 'hibernated' ? `${count(view.instances, 'instance')}, asleep` : `${view.ready} of ${view.instances} ready`;

    const node = el(
        'article',
        { class: 'card' },
        el(
            'div',
            { class: 'card-top' },
            glyph,
            el(
                'div',
                { class: 'card-id' },
                el('div', { class: 'card-title' }, title, el('span', { class: 'card-ns' }, view.namespace)),
                el('div', { class: 'card-state' }, pill(view.words, view.tone), view.version ? el('span', { class: 'faint' }, `Postgres ${view.version}`) : null),
            ),
        ),
        el('p', { class: 'card-sentence' }, sentence(view)),
        el(
            'dl',
            { class: 'card-facts' },
            el('dt', {}, 'Instances'),
            el('dd', {}, instances),
            el('dt', {}, 'Storage'),
            el('dd', {}, storage),
            el('dt', {}, 'Last backup'),
            el('dd', { title: backups.freshness.why }, el('span', { class: `dot dot-${lastTone || 'none'}` }), el('span', { class: `tone-${lastTone || 'none'}` }, backups.freshness.words), el('span', { class: 'faint' }, nextRun)),
            el('dt', {}, 'Can restore'),
            el('dd', {}, windowBar(backups.firstPoint, now, reach.tone, view.cluster.spec?.backup?.retentionPolicy), el('span', { class: `tone-${reach.tone || 'none'}` }, reach.words)),
        ),
        el(
            'div',
            { class: 'card-foot' },
            footLink('Topology', open),
            footLink('Backups', () => void openOn('backups', view.namespace, view.name)),
            topology.entries.some((e) => e.kind === 'pooler') ? el('span', { class: 'faint' }, count(topology.entries.filter((e) => e.kind === 'pooler').length, 'pooler')) : null,
        ),
    );
    node.style.borderLeftColor = toneVar(tone);
    return node;
}

/**
 * The recovery window as a short bar: full at the retention policy when the
 * cluster has one ("7d"), at thirty days otherwise. The words beside it say
 * the number; the bar is for comparing cards at a glance.
 */
function windowBar(first: number | undefined, now: number, tone: Tone, retention: string | undefined): HTMLElement {
    const bar = el('span', { class: 'mini-bar', 'aria-hidden': 'true' });
    const fill = el('span', { class: `mini-fill fill-${first === undefined ? 'none' : tone || 'none'}` });
    const match = /^(\d+)([dwm])$/.exec(retention ?? '');
    const whole = match ? Number(match[1]) * (match[2] === 'd' ? 1 : match[2] === 'w' ? 7 : 30) * DAY : 30 * DAY;
    fill.style.width = `${first === undefined ? 0 : Math.max(4, percent(now - first, whole))}%`;
    bar.append(fill);
    return bar;
}

function footLink(label: string, onClick: () => void): HTMLElement {
    const node = el('button', { type: 'button', class: 'foot-link' }, label);
    node.addEventListener('click', onClick);
    return node;
}

function linkButton(label: string, url: string): HTMLElement {
    const node = el('button', { type: 'button' }, label);
    node.addEventListener('click', () => void k8sdockside.openUrl(url));
    return node;
}

function attention(problems: Issue[]): HTMLElement {
    if (problems.length === 0) {
        return block('Needs attention', '', nothing('Nothing. Every cluster is up, every standby is streaming, and every backup is on time.'));
    }
    const list = el('ul', { class: 'issues' });
    for (const issue of problems.slice(0, 25)) {
        const row = el(
            'li',
            { class: 'issue' },
            el('span', { class: `dot dot-${issue.tone || 'none'}` }),
            el('span', { class: 'issue-title' }, issue.title),
            el('span', { class: 'issue-detail' }, issue.detail),
        );
        clickable(row, () => void k8sdockside.open(issue.ref));
        list.append(row);
    }
    const errors = problems.filter((p) => p.tone === 'error').length;
    const note = `${errors ? `${count(errors, 'problem')} to fix, worst first.` : 'Nothing is broken; these are worth knowing.'} Each row opens the object it is about.`;
    return block('Needs attention', problems.length > 25 ? `The worst 25 of ${problems.length}. ${note}` : note, list);
}

/** The exporter's numbers, as small multiples. */
function charts(panel: K8sDockside.ChartsPanel | null): HTMLElement | null {
    if (!panel || !panel.attached) return null;
    if (!panel.source.available) {
        return block(
            'From Prometheus',
            'CloudNativePG exports replication lag, connections, commits and archiving failures for Prometheus. No Prometheus was found for this cluster, so the charts are empty and replication lag is left off the topology.',
            el('p', { class: 'faint' }, panel.source.error || 'Set one in the cluster’s settings in the sidebar to fill them in.'),
        );
    }
    const tiles = el('div', { class: 'chart-tiles' });
    for (const chart of panel.charts) {
        const ranked = [...chart.series].sort((a, b) => (latest(b.points) ?? -Infinity) - (latest(a.points) ?? -Infinity));
        const top = ranked.slice(0, 3);
        const peak = latest(top[0]?.points ?? []);
        const legend = el('ul', { class: 'chart-legend' });
        top.forEach((series, index) => {
            legend.append(
                el('li', {}, el('span', { class: `swatch series-${index + 1}` }), el('span', { class: 'legend-name' }, seriesLabel(series.name)), el('span', { class: 'legend-value' }, formatValue(chart.unit, latest(series.points)))),
            );
        });
        const empty = chart.series.length === 0;
        tiles.append(
            el(
                'div',
                { class: 'chart-tile', title: chart.description },
                el('div', { class: 'chart-head' }, el('span', { class: 'chart-label' }, chart.label), el('span', { class: 'chart-value' }, empty ? '—' : formatValue(chart.unit, peak))),
                empty ? el('p', { class: 'chart-empty' }, chart.error || 'No data: the exporter has not reported this yet.') : sparkline(top),
                empty ? null : legend,
                ranked.length > 3 ? el('p', { class: 'chart-more' }, `and ${ranked.length - 3} more`) : null,
            ),
        );
    }
    return block('From Prometheus', `The last hour, through ${panel.source.describe}. Highest first.`, tiles);
}

function notInstalled(ctx: K8sDockside.Context): HTMLElement {
    return block(
        'CloudNativePG is not installed here',
        `${ctx.contextName} does not serve the postgresql.cnpg.io API, so there are no Postgres clusters for this plugin to show. It stays out of the way until the operator is installed.`,
        el('p', { class: 'links' }, linkButton('Installing CloudNativePG', 'https://cloudnative-pg.io/documentation/current/installation_upgrade/')),
    );
}
