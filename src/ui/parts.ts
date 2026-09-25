// The pieces the CloudNativePG pages are drawn from: pills, tiles, blocks,
// facts, sparklines.
//
// They are built from CSS classes and SVG rather than colour values, so the
// app's theme tokens colour them and a switch from light to dark needs no
// JavaScript at all.

import { size, type Tone } from '../model/units.js';
import { el, replace, svgEl } from './dom.js';

/** A small coloured label: a state, a method, a role. */
export function pill(text: string, tone: Tone = '', title = ''): HTMLElement {
    return el('span', { class: `pill pill-${tone || 'none'}`, ...(title ? { title } : {}) }, text);
}

/** A labelled number, the tile the dashboard's top row is built from. */
export function stat(label: string, value: string, note = '', tone: Tone = '', noteTone: Tone = ''): HTMLElement {
    return el(
        'div',
        { class: 'stat' },
        el('div', { class: `stat-value tone-${tone || 'none'}` }, value),
        el('div', { class: 'stat-label' }, label),
        note ? el('div', { class: `stat-note${noteTone ? ` tone-${noteTone}` : ''}` }, note) : null,
    );
}

/** A section with a heading, an optional sentence, and whatever follows. */
export function block(title: string, note: string, ...children: (Node | null)[]): HTMLElement {
    return el('section', { class: 'block' }, el('h2', {}, title), note ? el('p', { class: 'note' }, note) : null, ...children.filter((c): c is Node => c !== null));
}

/** Terms and values in two columns. */
export function facts(pairs: [string, Node | string][]): HTMLElement {
    const list = el('dl', { class: 'facts' });
    for (const [term, value] of pairs) {
        list.append(el('dt', {}, term), el('dd', {}, typeof value === 'string' ? value || '—' : value));
    }
    return list;
}

/** An empty state that says what would have been here. */
export function nothing(message: string): HTMLElement {
    return el('p', { class: 'empty' }, message);
}

/** A page's own heading, with the plugin's mark beside it and room on the right. */
export function heading(title: string, note: string, ...right: (Node | null)[]): HTMLElement {
    return el(
        'header',
        { class: 'page-head' },
        el('img', { class: 'mark', src: 'logo.svg', alt: '', width: 26, height: 26 }),
        el('div', { class: 'page-title' }, el('h1', {}, title), note ? el('p', { class: 'note' }, note) : null),
        ...right,
    );
}

/** Replaces a host's contents with a single "still reading" line. */
export function loading(host: HTMLElement, message: string): void {
    replace(host, el('p', { class: 'loading' }, message));
}

/**
 * Makes a node behave like a button: clickable, focusable, and answering the
 * keys a button answers. A <div> that opens something and cannot be reached
 * with a keyboard is a page half the people cannot use.
 */
export function clickable<T extends Element>(node: T, onPick: () => void, label = ''): T {
    node.classList.add('pick');
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', (event) => {
        event.stopPropagation();
        onPick();
    });
    node.addEventListener('keydown', (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') {
            event.preventDefault();
            onPick();
        }
    });
    return node;
}

/** A button that opens an object in the app, drawn as the name of the thing. */
export function openName(label: string, ref: K8sDockside.ObjectRef, className = 'link-name'): HTMLElement {
    const node = el('button', { type: 'button', class: className, title: `Open ${label}` }, label);
    node.addEventListener('click', () => void k8sdockside.open(ref));
    return node;
}

/** A small line chart of one or more series, coloured --chart-1, --chart-2 ... in order. */
export function sparkline(series: K8sDockside.ChartSeries[], width = 220, height = 40): SVGElement {
    const drawing = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'spark', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const points = series.flatMap((s) => s.points);
    if (points.length < 2) return drawing;
    const first = Math.min(...points.map((p) => p.t));
    const last = Math.max(...points.map((p) => p.t));
    const top = Math.max(...points.map((p) => p.v), 0);
    const spanT = Math.max(1, last - first);
    drawing.append(svgEl('line', { x1: 0, x2: width, y1: height - 0.5, y2: height - 0.5, class: 'spark-base' }));
    series.slice(0, 8).forEach((s, index) => {
        if (s.points.length < 2) return;
        const path = s.points
            .map((p) => `${(((p.t - first) / spanT) * width).toFixed(1)},${(height - 2 - (top > 0 ? (p.v / top) * (height - 4) : 0)).toFixed(1)}`)
            .join(' ');
        drawing.append(svgEl('polyline', { points: path, class: `spark-line series-${index + 1}`, fill: 'none', 'vector-effect': 'non-scaling-stroke' }));
    });
    return drawing;
}

/** A chart value written the way its unit asks for. */
export function formatValue(unit: string, value: number | undefined): string {
    if (value === undefined || !Number.isFinite(value)) return '—';
    switch (unit) {
        case 'percent':
            return `${(value * 100).toFixed(0)}%`;
        case 'bytes':
            return size(value);
        case 'bytes/s':
            return `${size(value)}/s`;
        case 'seconds':
            if (value < 1) return value === 0 ? '0 s' : `${(value * 1000).toFixed(0)} ms`;
            if (value < 120) return `${value.toFixed(value < 10 ? 1 : 0)} s`;
            return `${Math.round(value / 60)} min`;
        case 'ops/s':
            return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}/s`;
        default:
            return value >= 100 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
    }
}

/** The theme token behind a tone, for the few borders that are set by hand. */
export function toneVar(tone: Tone): string {
    return tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'error' ? 'var(--error)' : tone === 'info' ? 'var(--accent)' : 'var(--border)';
}

export { el, replace };
