// Reading the plugin's Prometheus charts back as numbers.
//
// The overview charts in plugin.json are aggregated `by (namespace, pod)` and
// deliberately name no `legend` label. The app then names each series after
// its whole label set, sorted -- "namespace=shop, pod=shop-2" (see
// seriesName in the app's internal/metrics/metrics.go) -- which is the only
// way to keep two pods called `db-1` in two namespaces apart. This file turns
// that back into a namespace and a pod, so the topology can put a replica's
// lag on the edge that leads to it.
//
// Every metric named here is one the CloudNativePG exporter publishes with
// its default queries (config/manager/default-monitoring.yaml, and the
// cnpg_collector_* ones in docs/src/monitoring.md): cnpg_pg_replication_lag,
// cnpg_backends_total, cnpg_pg_database_size_bytes,
// cnpg_pg_stat_archiver_failed_count, cnpg_pg_stat_database_xact_commit and
// cnpg_collector_up. The `namespace` and `pod` labels are the ones a
// PodMonitor adds; a Prometheus scraping some other way may not have them,
// and then the charts still draw -- they just cannot be tied to a replica.

import { key } from './cnpg.js';

/** A series name as the app writes it, back into labels. */
export function labels(name: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of name.split(', ')) {
        const eq = part.indexOf('=');
        if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
    }
    return out;
}

/** A series named for a person: "cnpg-demo/shop-2" rather than a label set. */
export function seriesLabel(name: string): string {
    const l = labels(name);
    const who = l.pod ?? l.cluster ?? l.datname ?? '';
    if (who) return l.namespace ? `${l.namespace}/${who}` : who;
    return name || 'all';
}

/** The last value of a series, or undefined when it has none. */
export function latest(points: K8sDockside.ChartPoint[]): number | undefined {
    for (let i = points.length - 1; i >= 0; i--) {
        const v = points[i]?.v;
        if (v !== undefined && Number.isFinite(v)) return v;
    }
    return undefined;
}

/**
 * The latest value of one chart, per `namespace/pod`. Series that do not
 * carry both labels are left out -- they cannot be put on a pod.
 */
export function byPod(chart: K8sDockside.Chart | undefined): Map<string, number> {
    const out = new Map<string, number>();
    for (const series of chart?.series ?? []) {
        const l = labels(series.name);
        if (!l.pod || !l.namespace) continue;
        const value = latest(series.points);
        if (value !== undefined) out.set(key(l.namespace, l.pod), value);
    }
    return out;
}

/** Replication lag, in seconds, worth a warning and worth an alarm. */
export const LAG_WARN = 30;
export const LAG_ERROR = 300;
